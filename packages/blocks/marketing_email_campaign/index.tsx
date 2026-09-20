import type {
  BulkEmailDeliveryBlock,
  BulkEmailDeliverySource,
  BulkEmailDeliverySourceConfig,
} from "blocks/bulk_email_delivery";
import {
  registerEmailDeliveryTemplateRenderer,
  renderEmailDeliveryTemplate,
} from "blocks/email_delivery_template";
import { generateAdvancedTemplateBody } from "blocks/email_templates/index";
import { storedScheduledProc } from "std/scheduled_utils";
import { checkString, sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type { Block, TableBuilder } from "std/system";
import { system } from "std/system";

const RESERVED_VARIABLE_NAMES = new Set(["email"]);
const DUE_CAMPAIGNS_PER_RUN = 1;

/** Parse the minute-precision datetime-local form value in the system timezone. */
export function marketingCampaignScheduleTime(value: Sql): Sql {
  return sql`date.parse_timestamp_naive(nullif(trim(${value}), ''), '%Y-%m-%dT%H:%M')
    at time zone ${sql.lit(system.timezone)}`;
}

export interface MarketingEmailCampaignVariable {
  description: string;
  expr: (campaign: Sql) => AnyExpr;
}

export interface MarketingEmailRecipientVariable {
  description: string;
  expr: (recipient: Sql, campaign: Sql) => AnyExpr;
}

export interface MarketingEmailCampaignSender {
  fromAddress: string;
  replyTo?: string;
}

export interface MarketingEmailCampaignAudience {
  recipientTableName: string;
  defineCampaignFields?: (table: TableBuilder) => void;
  /** Returns source_recipient_key and email. */
  recipientsQuery: (campaign: Sql) => Sql;
  /** Rechecks consent/suppression without changing the frozen audience. */
  isRecipientEligible: (recipient: Sql, campaign: Sql) => AnyExpr;
  campaignVariables?: Record<string, MarketingEmailCampaignVariable>;
  recipientVariables?: Record<string, MarketingEmailRecipientVariable>;
}

export interface MarketingEmailCampaignBlockOptions {
  delivery: BulkEmailDeliveryBlock;
  senders: Record<string, MarketingEmailCampaignSender>;
  audience: MarketingEmailCampaignAudience;
  onRecipientEvent?: BulkEmailDeliverySourceConfig["onRecipientEvent"];
}

// Check rendered text, not Lexical JSON or its HTML wrapper. Image-only
// messages are authored content too, but an image without a source is not.
function hasBasicBodyContent(text: Sql, html: Sql) {
  return sql`(regex.is_match(coalesce(${text}, ''), ${sql.lit(String.raw`\S`)})
    or regex.is_match(coalesce(${html}, ''), ${
    sql.lit(String.raw`<img\s[^>]*\bsrc="[^"\s][^"]*"`)
  }))`;
}

/** Whether an active template has the minimum authored content for a campaign. */
export function isMarketingEmailTemplateReady(template: Sql) {
  return sql`${template}.is_active
    and trim(coalesce(${template}.subject, '')) != ''
    and case ${template}.type
      when 'basic' then ${
    hasBasicBodyContent(
      sql`lexical_rich_text_to_plain_text(${template}.body)`,
      sql`lexical_rich_text_to_html_email(${template}.body)`,
    )
  }
      when 'advanced' then exists (
        select 1
        from email_sections ready_section
        join email_columns ready_column
          on ready_column.email_section_id = ready_section.id
        join email_blocks ready_block
          on ready_block.email_column_id = ready_column.id
        where ready_section.email_template_id = ${template}.id
      )
      else false
    end`;
}

/**
 * Template-based marketing campaign drafts and scheduling over platform bulk
 * delivery. User-owned Gmail/Outlook mailboxes intentionally do not enter this
 * state machine; bounded CRM mail merge uses ConnectedAccountEmailDelivery.
 */
export class MarketingEmailCampaignBlock implements Block {
  blockName = "MarketingEmailCampaignBlock";
  blockDisplayName = "Marketing Email Campaigns";
  description = "Template-based platform marketing campaign management";
  readonly deliverySource: BulkEmailDeliverySource;
  private scheduleSequence = 0;

  constructor(readonly opts: MarketingEmailCampaignBlockOptions) {
    if (Object.keys(opts.senders).length === 0) {
      throw new Error("MarketingEmailCampaignBlock requires a platform sender");
    }
    for (const [key, sender] of Object.entries(opts.senders)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key) || key.length > 100) {
        throw new Error(`Invalid marketing campaign sender key: ${key}`);
      }
      if (!sender.fromAddress || sender.fromAddress.length > 500) {
        throw new Error(`Invalid marketing campaign sender address: ${key}`);
      }
      if (sender.replyTo && sender.replyTo.length > 500) {
        throw new Error(`Invalid marketing campaign reply-to address: ${key}`);
      }
    }
    this.validateVariables();
    this.deliverySource = opts.delivery.registerSource({
      key: "marketing_campaign",
      isRecipientEligible: (recipient) => {
        const campaign = sql.ref("eligibility_campaign");
        const campaignRecipient = sql.ref("eligibility_recipient");
        return sql`exists (
          select 1
          from marketing_email_campaigns eligibility_campaign
          join ${sql.ref(this.opts.audience.recipientTableName)}
            eligibility_recipient
            on eligibility_recipient.id =
              try_cast(${recipient}.source_recipient_key as bigint)
          where eligibility_campaign.delivery_id = ${recipient}.delivery_id
            and coalesce((${
          this.opts.audience.isRecipientEligible(campaignRecipient, campaign)
        }), false)
        )`;
      },
      onSubmissionTerminal: (s, ctx) => {
        s.modify(sql`update marketing_email_campaigns
          set status = case when ${ctx.succeeded}
                then 'submitted'::enums.marketing_email_campaign_status
                else 'failed'::enums.marketing_email_campaign_status end,
              error = case when ${ctx.succeeded} then null else (
                select error from bulk_email_deliveries
                where id = ${ctx.deliveryId}
              ) end
          where id = try_cast(${ctx.sourceRecordKey} as bigint)
            and delivery_id = ${ctx.deliveryId} and status = 'submitting'`);
      },
      onRecipientEvent: opts.onRecipientEvent,
    });
  }

  private validateVariables() {
    const names = new Set<string>();
    for (
      const [scope, variables] of [
        ["campaign", this.opts.audience.campaignVariables ?? {}],
        ["recipient", this.opts.audience.recipientVariables ?? {}],
      ] as const
    ) {
      for (const name of Object.keys(variables)) {
        if (
          name.length === 0 || name.length > 200 ||
          !/^[a-z][a-z0-9_]*$/.test(name) ||
          RESERVED_VARIABLE_NAMES.has(name)
        ) {
          throw new Error(`Invalid ${scope} campaign variable: ${name}`);
        }
        if (names.has(name)) {
          throw new Error(`Duplicate campaign variable across scopes: ${name}`);
        }
        names.add(name);
      }
    }
  }

  getTemplateVariables() {
    const variables: Record<string, string> = {
      email: "Recipient email address",
    };
    for (
      const [name, variable] of Object.entries(
        this.opts.audience.campaignVariables ?? {},
      )
    ) {
      variables[name] = `${variable.description} (campaign)`;
    }
    for (
      const [name, variable] of Object.entries(
        this.opts.audience.recipientVariables ?? {},
      )
    ) {
      variables[name] = `${variable.description} (recipient)`;
    }
    return variables;
  }

  initialize() {
    system.enum_({
      name: "marketing_email_campaign_status",
      values: ["draft", "scheduled", "submitting", "submitted", "failed"],
    });
    registerEmailDeliveryTemplateRenderer();
    system.db.table("marketing_email_campaigns", (table) => {
      table.description(
        "An editable template-based campaign linked to one immutable platform bulk delivery.",
      );
      table.sampleData({ skipSampleData: true });
      table.string("name", 200).notNull();
      table.fk("email_template_id", "email_templates").notNull().onDelete(
        "Restrict",
      );
      table.string("sender_key", 100).notNull();
      table.enum("status", "marketing_email_campaign_status").notNull()
        .default(sql.lit`draft`);
      table.string("error", 2000);
      table.timestampTz("scheduled_at");
      table.fk("delivery_id", "bulk_email_deliveries").unique().onDelete(
        "Restrict",
      );
      this.opts.audience.defineCampaignFields?.(table);
      table.check({
        fields: ["status", "scheduled_at"],
        check: ([status, scheduledAt]) =>
          sql`${status} not in (${checkString("scheduled")}, ${
            checkString("submitting")
          }) or ${scheduledAt} is not null`,
        errorMessage: () =>
          sql.lit`A campaign in a queued state requires a schedule time`,
      });
      table.skipAutoApi();
    });
    system.storedProcedure({
      name: "marketing_email_campaign_finalize_generation",
      transaction: "standalone",
      inputScalars: [
        { name: "p_campaign_id", type: "BigInt" },
        { name: "p_delivery_id", type: "BigInt" },
        { name: "p_scheduled_at", type: "Timestamp" },
        { name: "p_release", type: "Bool", notNull: true },
        { name: "p_subject", type: "String" },
        { name: "p_html", type: "String" },
        { name: "p_text", type: "String" },
      ],
      procedure: (s) => {
        s.defScalar("claimed_campaign_id", { type: "BigInt" });
        s.startTransaction();
        s.modify(sql`update marketing_email_campaigns
          set status = case when p_release
                then 'submitting'::enums.marketing_email_campaign_status
                else 'failed'::enums.marketing_email_campaign_status end,
              delivery_id = case when p_release then delivery_id else null end,
              error = case when p_release then null
                else 'Campaign rendering failed; inspect marketing_email_campaign_due logs.' end
          where id = p_campaign_id and status = 'scheduled'
            and delivery_id = p_delivery_id
            and scheduled_at = p_scheduled_at and scheduled_at <= now()
            and exists (select 1 from bulk_email_deliveries delivery
              where delivery.id = p_delivery_id and delivery.status = 'held'
                and delivery.source = 'marketing_campaign')
          returning id into claimed_campaign_id`);
        s.if(sql`claimed_campaign_id is not null`, (s) => {
          s.if(sql`p_release`, (s) => {
            this.deliverySource.releaseHeld(s, {
              deliveryId: sql`p_delivery_id`,
              subjectTemplate: sql`p_subject`,
              htmlTemplate: sql`p_html`,
              textTemplate: sql`p_text`,
              releasedDeliveryIdScalar: "released_delivery_id",
            });
            s.throwErrorIf(
              sql`released_delivery_id is null`,
              sql.lit`Campaign delivery is no longer held`,
            );
          }).else((s) =>
            this.deliverySource.discardHeld(s, sql`p_delivery_id`)
          );
        });
        s.commitTransaction();
      },
    });
    storedScheduledProc({
      name: "marketing_email_campaign_due",
      schedule: "0 */15 * * * *",
      procedure: (s) => this.processDueCampaigns(s),
    });
    system.addReactor({
      name: "marketing_email_campaign_ready",
      query: sql`select id from marketing_email_campaigns
        where status = 'scheduled' and scheduled_at <= now()
          and not exists (select 1 from bulk_email_deliveries
            where status = 'submitting' or (status = 'prepared'
              and (next_attempt_at is null or next_attempt_at <= now())))
        order by scheduled_at, id limit 1`,
      recordName: "ready_campaign",
      maxConcurrent: 1,
      procedure: (s) =>
        s.if(
          sql`exists (select 1 from marketing_email_campaigns
        where id = ready_campaign.id and status = 'scheduled' and scheduled_at <= now())`,
          (s) => {
            s.callStoredProcedure("marketing_email_campaign_due_impl");
          },
        ),
    });
  }

  /** Create and schedule a campaign in the caller's transaction. */
  createAndSchedule<T extends IServerBaseStatements>(s: T, opts: {
    name: AnyExpr;
    templateId: AnyExpr;
    senderKey: Sql;
    scheduledAt?: AnyExpr;
    recipientsQuery?: Sql;
    campaignIdScalar: string;
  }) {
    if (
      !system.storedProcedures.some((p) =>
        p.name === "marketing_email_campaign_create_draft"
      )
    ) {
      system.storedProcedure({
        name: "marketing_email_campaign_create_draft",
        transaction: "caller",
        inputScalars: [
          { name: "p_name", type: "String" },
          { name: "p_template_id", type: "BigInt" },
          { name: "p_sender_key", type: "String" },
        ],
        outputScalars: [{ name: "o_campaign_id", type: "BigInt" }],
        procedure: (s) => {
          s.throwErrorIf(
            sql`trim(p_name) = '' or length(trim(p_name)) > 200`,
            sql
              .lit`Campaign name is required and must be at most 200 characters.`,
          );
          s.modify(sql`insert into marketing_email_campaigns (
            name, email_template_id, sender_key, status
          ) select trim(p_name), template.id, p_sender_key,
              'draft'::enums.marketing_email_campaign_status
            from email_templates template
            where template.id = p_template_id and template.is_active
            returning id into o_campaign_id`);
          s.throwErrorIf(
            sql`o_campaign_id is null`,
            sql.lit`Select an active email template.`,
          );
        },
      });
    }
    s.defScalar(opts.campaignIdScalar, { type: "BigInt" });
    s.callStoredProcedure("marketing_email_campaign_create_draft", {
      inputScalars: {
        p_name: opts.name,
        p_template_id: opts.templateId,
        p_sender_key: opts.senderKey,
      },
      outputScalars: { o_campaign_id: opts.campaignIdScalar },
    });
    this.schedule(s, {
      campaignId: sql.ref(opts.campaignIdScalar),
      scheduledAt: opts.scheduledAt,
      recipientsQuery: opts.recipientsQuery,
    });
  }

  /** Copy a terminal campaign to a draft, rejecting uncertain/already-sent retries. */
  copyToDraft<T extends IServerBaseStatements>(s: T, opts: {
    campaignId: AnyExpr;
    campaignIdScalar: string;
  }) {
    if (
      !system.storedProcedures.some((p) =>
        p.name === "marketing_email_campaign_copy_to_draft"
      )
    ) {
      system.storedProcedure({
        name: "marketing_email_campaign_copy_to_draft",
        transaction: "caller",
        inputScalars: [{ name: "p_campaign_id", type: "BigInt" }],
        outputScalars: [{ name: "o_campaign_id", type: "BigInt" }],
        procedure: (s) => {
          s.throwErrorIf(
            sql`exists (
              select 1 from marketing_email_campaigns campaign
              join bulk_email_delivery_recipients recipient on recipient.delivery_id = campaign.delivery_id
              where campaign.id = p_campaign_id and campaign.status = 'failed'
                and recipient.status in ('send_unknown', 'submitted')
            )`,
            sql
              .lit`This failed campaign contains uncertain or already-sent recipients. Reconcile delivery results and prepare a new campaign only for recipients proven not sent.`,
          );
          s.modify(sql`insert into marketing_email_campaigns (
            name, email_template_id, sender_key, status
          ) select left(name, 193) || ' (copy)', email_template_id, sender_key,
              'draft'::enums.marketing_email_campaign_status
            from marketing_email_campaigns
            where id = p_campaign_id and status in ('submitted', 'failed')
            returning id into o_campaign_id`);
          s.throwErrorIf(
            sql`o_campaign_id is null`,
            sql.lit`Only terminal campaigns can be copied to a draft.`,
          );
        },
      });
    }
    s.defScalar(opts.campaignIdScalar, { type: "BigInt" });
    s.callStoredProcedure("marketing_email_campaign_copy_to_draft", {
      inputScalars: { p_campaign_id: opts.campaignId },
      outputScalars: { o_campaign_id: opts.campaignIdScalar },
    });
  }

  /** Schedule inside the caller's transaction with any related draft updates. */
  schedule<T extends IServerBaseStatements>(
    s: T,
    opts: {
      campaignId: AnyExpr;
      scheduledAt?: AnyExpr;
      /** Optional selected subset returning source_recipient_key and email. */
      recipientsQuery?: Sql;
    },
  ) {
    const prefix = `marketing_campaign_schedule_${this.scheduleSequence++}`;
    const campaign = `${prefix}_campaign`;
    const scheduledCampaignId = `${prefix}_scheduled_campaign_id`;
    const deliveryId = `${prefix}_delivery_id`;
    s.throwErrorIf(
      sql`not exists (select 1 from marketing_email_campaigns campaign
          join email_templates template on template.id = campaign.email_template_id
          where campaign.id = ${opts.campaignId} and campaign.status = 'draft'
            and (${isMarketingEmailTemplateReady(sql`template`)}))`,
      sql.lit`Campaign requires an active template with a subject and body.`,
    );
    const senderValid = Object.keys(this.opts.senders).map((key) =>
      sql`sender_key = ${sql.lit(key)}`
    );
    s.throwErrorIf(
      sql`not exists (select 1 from marketing_email_campaigns
          where id = ${opts.campaignId} and ${sql.or(...senderValid)})`,
      sql.lit`Campaign sender is not a configured platform identity`,
    );
    s.defRecord(
      campaign,
      sql`select * from marketing_email_campaigns
          where id = ${opts.campaignId} and status = 'draft'`,
    );
    this.deliverySource.createHeld(s, {
      sourceRecordKey: sql`${sql.ref(campaign)}.id::text`,
      from: this.senderFromExpr(sql`${sql.ref(campaign)}.sender_key`),
      replyTo: this.senderReplyToExpr(sql`${sql.ref(campaign)}.sender_key`),
      recipientsQuery: this.buildAudienceQuery(
        sql.ref(campaign),
        opts.recipientsQuery,
      ),
      deliveryIdScalar: deliveryId,
    });
    s.defScalar(scheduledCampaignId, { type: "BigInt" });
    s.modify(sql`update marketing_email_campaigns
      set scheduled_at = coalesce(${
      opts.scheduledAt ?? sql`null::timestamptz`
    }, now()), status = 'scheduled', delivery_id = ${sql.ref(deliveryId)}
      where id = ${opts.campaignId} and status = 'draft'
      returning id into ${sql.ref(scheduledCampaignId)}`);
    s.throwErrorIf(
      sql`${sql.ref(scheduledCampaignId)} is null`,
      sql.lit`Campaign is no longer a draft`,
    );
  }

  /** Unschedule inside the caller's transaction so its held delivery is removed atomically. */
  unschedule<T extends IServerBaseStatements>(s: T, campaignId: AnyExpr) {
    const target = `marketing_campaign_unschedule_target_${this
      .scheduleSequence++}`;
    const unscheduledCampaignId = `marketing_campaign_unscheduled_${this
      .scheduleSequence++}`;
    s.defRecord(
      target,
      sql`select campaign.id, campaign.delivery_id
        from marketing_email_campaigns campaign
        join bulk_email_deliveries delivery
          on delivery.id = campaign.delivery_id
        where campaign.id = ${campaignId}
          and campaign.status = 'scheduled'
          and delivery.status = 'held'
          and delivery.source = 'marketing_campaign'`,
    );
    s.defScalar(unscheduledCampaignId, { type: "BigInt" });
    s.modify(sql`update marketing_email_campaigns
      set status = 'draft', scheduled_at = null, delivery_id = null
      where id = ${sql.ref(target)}.id and status = 'scheduled'
      returning id into ${sql.ref(unscheduledCampaignId)}`);
    s.throwErrorIf(
      sql`${sql.ref(unscheduledCampaignId)} is null`,
      sql.lit`Campaign is no longer scheduled with a held delivery`,
    );
    this.deliverySource.discardHeld(
      s,
      sql`${sql.ref(target)}.delivery_id`,
    );
  }

  private processDueCampaigns<T extends IServerBaseStatements>(s: T) {
    s.forEachQuery(
      sql`select id from marketing_email_campaigns
          where status = 'scheduled' and scheduled_at <= now()
            and not exists (
              select 1 from bulk_email_deliveries active_delivery
              where active_delivery.status = 'submitting'
                or (active_delivery.status = 'prepared' and
                  (active_delivery.next_attempt_at is null or active_delivery.next_attempt_at <= now()))
            )
          order by scheduled_at, id
          limit ${DUE_CAMPAIGNS_PER_RUN}`,
      "campaign_candidate",
      (s) => {
        s.startTransaction();
        s.defRecord(
          "due_campaign",
          sql`select * from marketing_email_campaigns
              where id = campaign_candidate.id`,
        );
        s.commitTransaction();
        s.returnIf(sql`due_campaign.id is null`);
        s.try({
          body: (s) => {
            const content = this.renderCampaign(
              s,
              sql.ref("due_campaign"),
              "due_campaign",
            );
            s.callStoredProcedure(
              "marketing_email_campaign_finalize_generation",
              {
                inputScalars: {
                  p_campaign_id: sql`due_campaign.id`,
                  p_delivery_id: sql`due_campaign.delivery_id`,
                  p_scheduled_at: sql`due_campaign.scheduled_at`,
                  p_release: sql`true`,
                  p_subject: content.subject,
                  p_html: content.html,
                  p_text: content.text,
                },
              },
            );
          },
          errorName: "campaign_due_error",
          catch: (s) => {
            s.logError(
              sql`json_build_object(
              'campaign_id', due_campaign.id,
              'delivery_id', due_campaign.delivery_id,
              'scheduled_at', due_campaign.scheduled_at,
              'observed_at', now(),
              'error', left(campaign_due_error.message, 2000)
            )::string`,
              sql.lit`marketing_email_campaign_due`,
            );
            s.rollbackIfInTransaction();
            s.callStoredProcedure(
              "marketing_email_campaign_finalize_generation",
              {
                inputScalars: {
                  p_campaign_id: sql`due_campaign.id`,
                  p_delivery_id: sql`due_campaign.delivery_id`,
                  p_scheduled_at: sql`due_campaign.scheduled_at`,
                  p_release: sql`false`,
                  p_subject: sql`null`,
                  p_html: sql`null`,
                  p_text: sql`null`,
                },
              },
            );
          },
        });
      },
    );
  }

  private buildAudienceQuery(campaign: Sql, selectedRecipients?: Sql) {
    const variables = Object.fromEntries(
      Object.entries(this.opts.audience.recipientVariables ?? {}).map(
        ([name, variable]) => [
          name,
          variable.expr(sql.ref("campaign_recipient"), campaign),
        ],
      ),
    );
    return sql`select cast(audience.source_recipient_key as string) as source_recipient_key,
        lower(trim(audience.email)) as email,
        ${sql.jsonBuildObject(variables)} as variables
      from (${
      selectedRecipients ?? this.opts.audience.recipientsQuery(campaign)
    }) audience
      join ${sql.ref(this.opts.audience.recipientTableName)} campaign_recipient
        on campaign_recipient.id = try_cast(audience.source_recipient_key as bigint)
      where ${campaign}.id is not null`;
  }

  private senderFromExpr(senderKey: Sql) {
    return sql.caseWhen({
      operand: senderKey,
      conditions: Object.entries(this.opts.senders).map(([key, sender]) => ({
        condition: sql.lit(key),
        expr: sql.lit(sender.fromAddress),
      })),
      default: sql`null`,
    });
  }

  private senderReplyToExpr(senderKey: Sql) {
    return sql.caseWhen({
      operand: senderKey,
      conditions: Object.entries(this.opts.senders).map(([key, sender]) => ({
        condition: sql.lit(key),
        expr: sender.replyTo ? sql.lit(sender.replyTo) : sql`null`,
      })),
      default: sql`null`,
    });
  }

  private renderCampaign<T extends IServerBaseStatements>(
    s: T,
    campaign: Sql,
    prefix: string,
  ) {
    const templateName = `${prefix}_template`;
    const subjectName = `${prefix}_subject`;
    const htmlName = `${prefix}_html`;
    const textName = `${prefix}_text`;
    const template = sql.ref(templateName);
    s.defRecord(
      templateName,
      sql`select * from email_templates where id = ${campaign}.email_template_id`,
    );
    s.defScalar(subjectName, {
      type: { type: "String", maxLength: 1000 },
      expr: sql`coalesce(${template}.subject, '')`,
    });
    s.defScalar(htmlName, {
      type: { type: "String", maxLength: 10_000_000 },
    });
    s.defScalar(textName, {
      type: { type: "String", maxLength: 10_000_000 },
    });
    s.if(sql`${template}.type = 'basic'`, (s) => {
      s.setScalar(
        htmlName,
        sql`lexical_rich_text_to_html_email(${template}.body)`,
      );
      s.setScalar(
        textName,
        sql`lexical_rich_text_to_plain_text(${template}.body)`,
      );
    }).else((s) => {
      const mergedBodyName = `${prefix}_merged_body`;
      s.defScalar(mergedBodyName, {
        type: { type: "String", maxLength: 10_000_000 },
      });
      generateAdvancedTemplateBody(s, sql`${template}.id`, {
        prefix: `${prefix}_advanced_`,
        outputScalar: mergedBodyName,
      });
      s.setScalar(htmlName, sql.ref(mergedBodyName));
      s.setScalar(textName, sql`null`);
    });
    const variables: Record<string, Sql> = {};
    for (
      const [name, variable] of Object.entries(
        this.opts.audience.campaignVariables ?? {},
      )
    ) {
      const value = `${prefix}_variable_${name}`;
      s.defScalar(value, variable.expr(campaign));
      variables[name] = sql.ref(value);
    }
    const campaignVariables = sql.jsonBuildObject(variables);
    s.setScalar(
      subjectName,
      renderEmailDeliveryTemplate(
        sql.ref(subjectName),
        campaignVariables,
        false,
      ),
    );
    s.setScalar(
      htmlName,
      renderEmailDeliveryTemplate(
        sql.ref(htmlName),
        campaignVariables,
        true,
      ),
    );
    s.setScalar(
      textName,
      renderEmailDeliveryTemplate(
        sql.ref(textName),
        campaignVariables,
        false,
      ),
    );
    s.throwErrorIf(
      sql`trim(coalesce(${sql.ref(subjectName)}, '')) = ''
        or (${template}.type = 'basic' and not ${
        hasBasicBodyContent(sql.ref(textName), sql.ref(htmlName))
      })
        or (trim(coalesce(${sql.ref(htmlName)}, '')) = ''
          and trim(coalesce(${sql.ref(textName)}, '')) = '')`,
      sql.lit`Campaign template must render a non-empty subject and body.`,
    );
    return {
      subject: sql.ref(subjectName),
      html: sql.ref(htmlName),
      text: sql.ref(textName),
    };
  }
}
