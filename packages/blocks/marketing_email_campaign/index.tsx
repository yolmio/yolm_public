import {
  CampaignDeliveryReport,
  CampaignsPage,
  DeliveryResultsPage,
  SelectedRowsDialog,
} from "./ui";
export type {
  MarketingCampaignAccess,
  MarketingCampaignDeliveryResultsPageProps,
  MarketingCampaignSelectedRows,
  MarketingCampaignSelectedRowsDialogProps,
  MarketingCampaignsPageProps,
} from "./ui";
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
import { prepareEmailTestRecipients } from "blocks/email_test_recipients";
import { storedScheduledProc } from "std/scheduled_utils";
import { checkString, sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type {
  EndpointStatementsOrFn,
  IServerBaseStatements,
} from "std/statements";
import { getCapabilities } from "std/yolm_gen_api";
import {
  withHtmlUnsubscribeFooter,
  withTextUnsubscribeFooter,
} from "blocks/bulk_email_delivery";
import type { Block, TableBuilder } from "std/system";
import { system } from "std/system";

const RESERVED_VARIABLE_NAMES = new Set(["email"]);
const DUE_CAMPAIGNS_PER_RUN = 1;
const CAMPAIGN_BATCH_SIZE = 500;
const MAX_CAMPAIGN_RECIPIENTS = 10_000;

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

export type MarketingEmailCampaignSender = {
  fromAddress: string;
  replyTo?: string;
  resolve?: never;
  variables?: never;
  legacyVariables?: never;
} | {
  /** SQL JSON with from_address, reply_to, variables; optional error rejects the sender, is_fallback annotates previews. Null rejects the audience. */
  resolve: (recipient: Sql, campaign: Sql) => Sql;
  /** Template variables supplied by the resolved identity, frozen with the sender. */
  variables?: Record<string, string>;
  /** Fill missing sender variables in pre-resolver held snapshots at release. Existing values win. */
  legacyVariables?: Record<string, string>;
  fromAddress?: never;
  replyTo?: never;
};

export interface MarketingEmailCampaignAudience {
  recipientTableName: string;
  /** Contact label and correction route used in sender previews and validation. */
  recipientLabel?: (recipient: Sql) => Sql;
  recipientHref?: (recipient: Sql) => Sql;
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
  /** Isolated preview/test transport; never used in production. */
  testEmailMockProcedure?: EndpointStatementsOrFn;
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
 * Template-based marketing campaign scheduling over platform bulk
 * delivery. User-owned Gmail/Outlook mailboxes intentionally do not enter this
 * state machine; bounded CRM mail merge uses ConnectedAccountEmailDelivery.
 */
export class MarketingEmailCampaignBlock implements Block {
  static CampaignsPage = CampaignsPage;
  static CampaignDeliveryReport = CampaignDeliveryReport;
  static DeliveryResultsPage = DeliveryResultsPage;
  static SelectedRowsDialog = SelectedRowsDialog;
  blockName = "MarketingEmailCampaignBlock";
  blockDisplayName = "Marketing Email Campaigns";
  description = "Template-based platform marketing campaign management";
  externalServiceOptions = [
    { optionKey: "send_test_emails", optionLabel: "Send campaign test emails" },
  ];
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
      if (
        !sender.resolve &&
        (!sender.fromAddress || sender.fromAddress.length > 500)
      ) {
        throw new Error(`Invalid marketing campaign sender address: ${key}`);
      }
      if (sender.replyTo && sender.replyTo.length > 500) {
        throw new Error(`Invalid marketing campaign reply-to address: ${key}`);
      }
      for (const name of Object.keys(sender.legacyVariables ?? {})) {
        if (!Object.hasOwn(sender.variables ?? {}, name)) {
          throw new Error(
            `Undeclared legacy campaign sender variable: ${key}.${name}`,
          );
        }
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
          from (
            select id as campaign_id, delivery_id from marketing_email_campaigns
              where delivery_id is not null
            union all
            select campaign.id as campaign_id, batch.delivery_id
            from marketing_email_campaign_delivery_batches batch
            join marketing_email_campaigns campaign
              on campaign.delivery_id = batch.first_delivery_id
          ) eligibility_delivery
          join marketing_email_campaigns eligibility_campaign
            on eligibility_campaign.id = eligibility_delivery.campaign_id
          join ${sql.ref(this.opts.audience.recipientTableName)}
            eligibility_recipient
            on eligibility_recipient.id =
              try_cast(${recipient}.source_recipient_key as bigint)
          where eligibility_delivery.delivery_id = ${recipient}.delivery_id
            and coalesce((${
          this.opts.audience.isRecipientEligible(campaignRecipient, campaign)
        }), false)
        )`;
      },
      onSubmissionTerminal: (s, ctx) => {
        s.modify(sql`update marketing_email_campaigns
          set status = case when exists (select 1 from bulk_email_deliveries batch
                where batch.id in (${
          this.deliveryIdsQuery(sql`marketing_email_campaigns.delivery_id`)
        }) and batch.status = 'failed')
              then 'failed'::enums.marketing_email_campaign_status
              else 'submitted'::enums.marketing_email_campaign_status end,
            error = (select min(batch.error) from bulk_email_deliveries batch
              where batch.id in (${
          this.deliveryIdsQuery(sql`marketing_email_campaigns.delivery_id`)
        }) and batch.status = 'failed')
          where ${ctx.deliveryId} in (${
          this.deliveryIdsQuery(sql`marketing_email_campaigns.delivery_id`)
        })
            and status = 'submitting'
            and not exists(select 1 from bulk_email_deliveries batch
              where batch.id in (${
          this.deliveryIdsQuery(sql`marketing_email_campaigns.delivery_id`)
        })
                and batch.status in ('held', 'prepared', 'submitting'))`);
      },
      onRecipientEvent: opts.onRecipientEvent
        ? (s, ctx) =>
          opts.onRecipientEvent!(s, {
            ...ctx,
            sourceRecordKey:
              sql`(select campaign.id::string from marketing_email_campaigns campaign
            where ${ctx.deliveryId} in (${
                this.deliveryIdsQuery(sql`campaign.delivery_id`)
              }))`,
          })
        : undefined,
    });
  }

  /** The first delivery also fences scheduling; extra batches link to that snapshot. */
  deliveryIdsQuery(firstDeliveryId: Sql) {
    return sql`select ${firstDeliveryId} as id
      union all select delivery_id as id from marketing_email_campaign_delivery_batches
      where first_delivery_id = ${firstDeliveryId}`;
  }

  /** Scheduled/history labels use frozen delivery identities, never today's resolver. */
  senderLabel(campaign: Sql, configuredLabel: Sql) {
    return sql`case when ${campaign}.delivery_id is null then ${configuredLabel}
      else coalesce((select string_agg(identity.label, ', ') from (
        select distinct delivery.from_email ||
        case when delivery.reply_to_email is not null and delivery.reply_to_email != delivery.from_email
          then ' (Reply-To: ' || delivery.reply_to_email || ')' else '' end as label
        from bulk_email_deliveries delivery where delivery.id in (${
      this.deliveryIdsQuery(sql`${campaign}.delivery_id`)
    }) order by label) identity), 'No delivery sender') end`;
  }

  /** Campaign totals across every provider batch, including legacy single deliveries. */
  summaryQuery(campaignId?: Sql) {
    const engagement = this.opts.delivery.opts.engagementTracking !== false;
    return sql`select campaign.id, campaign.name, campaign.status, campaign.error,
      count(distinct delivery.id) as batch_count, count(recipient.id) as recipient_count,
      count(case when recipient.status = 'submitted' then 1 end) as submitted_count,
      count(case when recipient.delivered_at is not null then 1 end) as delivered_count,
      count(case when recipient.status = 'excluded' then 1 end) as excluded_count,
      count(case when recipient.status = 'failed' then 1 end) as failed_count,
      count(case when recipient.status = 'send_unknown' then 1 end) as send_unknown_count,
      count(case when recipient.hard_bounced_at is not null then 1 end) as hard_bounced_count
      ${
      engagement
        ? sql`, count(case when recipient.first_opened_at is not null then 1 end) as opened_count,
        count(case when recipient.first_clicked_at is not null then 1 end) as clicked_count`
        : sql``
    }
      from marketing_email_campaigns campaign
      left join (
        select id as campaign_id, delivery_id from marketing_email_campaigns where delivery_id is not null
        union all
        select owner.id as campaign_id, batch.delivery_id
        from marketing_email_campaigns owner
        join marketing_email_campaign_delivery_batches batch on batch.first_delivery_id = owner.delivery_id
      ) campaign_delivery on campaign_delivery.campaign_id = campaign.id
      left join bulk_email_deliveries delivery on delivery.id = campaign_delivery.delivery_id
      left join bulk_email_delivery_recipients recipient on recipient.delivery_id = delivery.id
      where ${campaignId ? sql`campaign.id = ${campaignId}` : sql`true`}
      group by campaign.id, campaign.name, campaign.status, campaign.error`;
  }

  private discardDeliveries<T extends IServerBaseStatements>(
    s: T,
    firstDeliveryId: Sql,
  ) {
    const prefix = `campaign_discard_${this.scheduleSequence++}`;
    s.defTable(prefix, this.deliveryIdsQuery(firstDeliveryId));
    s.modify(
      sql`delete from marketing_email_campaign_delivery_batches where first_delivery_id = ${firstDeliveryId}`,
    );
    s.forEachTable(prefix, `${prefix}_row`, (s) => {
      this.deliverySource.discardHeld(s, sql`${sql.ref(`${prefix}_row`)}.id`);
    });
  }

  private validateVariables() {
    const names = new Set<string>();
    for (
      const [scope, variables] of [
        ["campaign", this.opts.audience.campaignVariables ?? {}],
        ["recipient", this.opts.audience.recipientVariables ?? {}],
        ["sender", this.senderVariables()],
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
    for (const [name, variable] of Object.entries(this.senderVariables())) {
      variables[name] = `${variable.description} (sender)`;
    }
    return variables;
  }

  initialize() {
    system.enum_({
      name: "marketing_email_campaign_status",
      values: [
        { name: "cancelled", renameFrom: "draft" },
        "scheduled",
        "submitting",
        "submitted",
        "failed",
      ],
    });
    registerEmailDeliveryTemplateRenderer();
    system.db.table("marketing_email_campaigns", (table) => {
      table.description(
        "A scheduled or terminal campaign linked to its frozen platform delivery batches.",
      );
      table.sampleData({ skipSampleData: true });
      table.string("name", 200).notNull();
      table.fk("email_template_id", "email_templates").notNull().onDelete(
        "Restrict",
      );
      table.string("sender_key", 100).notNull();
      table.enum("status", "marketing_email_campaign_status").notNull()
        .default(sql.lit`scheduled`);
      table.string("error", 2000);
      table.timestampTz("scheduled_at").default(sql`now()`);
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
    system.db.table("marketing_email_campaign_delivery_batches", (table) => {
      table.description(
        "Additional provider batches belonging to the campaign's original frozen delivery.",
      );
      table.fk("first_delivery_id", "bulk_email_deliveries").notNull().onDelete(
        "Restrict",
      );
      table.fk("delivery_id", "bulk_email_deliveries").notNull().unique()
        .onDelete("Restrict");
      table.skipAutoApi();
    });
    system.storedProcedure({
      name: "marketing_email_campaign_send_test",
      transaction: "standalone",
      inputScalars: [
        { name: "p_campaign_id", type: "BigInt" },
        { name: "p_template_id", type: "BigInt" },
        { name: "p_sender_key", type: "String" },
        { name: "p_test_to", type: "String" },
        { name: "p_sample_key", type: "String" },
      ],
      inputTables: [{
        name: "p_test_recipients",
        fields: [
          { name: "source_recipient_key", type: "String" },
          { name: "email", type: "String" },
        ],
      }],
      procedure: (s) => {
        const testRecipients = prepareEmailTestRecipients(s, sql`p_test_to`);
        s.defRecord(
          "test_campaign",
          sql`select coalesce(saved.id, 0) as id, ${
            Object.keys(system.db.tables.marketing_email_campaigns.fields)
              .filter((field) => field !== "id").map(
                (field) => {
                  const fallback = field === "email_template_id"
                    ? sql`p_template_id`
                    : field === "sender_key"
                    ? sql`p_sender_key`
                    : field === "name"
                    ? sql.lit`Test email`
                    : undefined;
                  return fallback
                    ? sql`coalesce(saved.${sql.ref(field)}, ${fallback}) as ${
                      sql.ref(field)
                    }`
                    : sql`saved.${sql.ref(field)}`;
                },
              )
          } from (select 1 as one) input
          left join marketing_email_campaigns saved on saved.id = p_campaign_id`,
        );
        s.throwErrorIf(
          sql`p_campaign_id is not null and not exists(select 1 from marketing_email_campaigns where id = p_campaign_id and status = 'scheduled')`,
          sql.lit`Only scheduled campaigns can send a test.`,
        );
        s.throwErrorUnless(
          sql`exists(select 1 from email_templates template
          where template.id = test_campaign.email_template_id
          and ${isMarketingEmailTemplateReady(sql`template`)})`,
          sql
            .lit`Save an active template with a subject and body before sending a test.`,
        );
        s.defRecord("test_sample", {
          fields: [
            ...[
              "source_recipient_key",
              "email",
              "recipient_label",
              "from_address",
              "reply_to",
              "sender_error",
            ].map((name) => ({ name, type: "String" as const })),
            { name: "sender_valid", type: "Bool" },
            { name: "variables", type: "Json" },
          ],
        });
        const sampleColumns =
          sql`source_recipient_key, email, recipient_label, from_address, reply_to, sender_error, sender_valid, variables`;
        s.if(sql`p_campaign_id is not null`, (s) => {
          s.modify(sql`insert into test_sample select ${sampleColumns}
            from (${
            this.scheduledTestRecipientsQuery(sql`test_campaign`)
          }) sample_recipient
            where source_recipient_key = p_sample_key limit 1`);
        }).else((s) => {
          s.modify(sql`insert into test_sample select ${sampleColumns}
            from (${
            this.buildAudienceQuery(
              sql`test_campaign`,
              sql`select source_recipient_key, email from p_test_recipients`,
            )
          }) sample_recipient
            where source_recipient_key = p_sample_key limit 1`);
        });
        s.throwErrorIf(
          sql`test_sample.source_recipient_key is null`,
          sql.lit`Choose an eligible sample contact for personalization.`,
        );
        s.throwErrorUnless(
          this.validSender(sql`test_sample`),
          sql`coalesce(test_sample.recipient_label, test_sample.email) || ': ' ||
            coalesce(test_sample.sender_error, 'Sender unavailable or invalid. Review the contact owner.')`,
        );
        const content = this.renderCampaign(
          s,
          sql`test_campaign`,
          "test_render",
        );
        s.defScalar(
          "test_variables",
          sql`test_sample.variables || json_build_object(
          'email', test_sample.email, 'unsubscribe_url', '#', 'one_click_unsubscribe_url', '#')`,
        );
        s.sendEmail({
          from: sql`test_sample.from_address`,
          replyTo: sql`test_sample.reply_to`,
          to: testRecipients,
          subject: sql`'[TEST] ' || ${
            renderEmailDeliveryTemplate(
              content.subject,
              sql`test_variables`,
              false,
            )
          }`,
          htmlBody: renderEmailDeliveryTemplate(
            withHtmlUnsubscribeFooter(content.html),
            sql`test_variables`,
            true,
          ),
          textBody: renderEmailDeliveryTemplate(
            withTextUnsubscribeFooter(content.text),
            sql`test_variables`,
            false,
          ),
          optIn: !!getCapabilities()?.blocks?.MarketingEmailCampaignBlock
            ?.send_test_emails,
          mockProcedure: this.opts.testEmailMockProcedure,
          resultJsonScalar: "test_send_result",
          errorJsonScalar: "test_send_error",
        });
        s.throwErrorIf(
          sql`test_send_error is not null or test_send_result->'mockError' is not null`,
          sql`coalesce(test_send_error->>'message', test_send_result->'mockError'->>'message', 'The test email could not be sent.')`,
        );
        s.throwErrorIf(
          sql`test_send_result is null`,
          sql
            .lit`The email service did not confirm the test send. Check the destination inbox before retrying.`,
        );
      },
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
            for (const [key, sender] of Object.entries(this.opts.senders)) {
              const legacy = sender.legacyVariables ?? {};
              const names = Object.keys(legacy);
              if (names.length === 0) continue;
              s.if(
                sql`(select sender_key from marketing_email_campaigns
                where id = claimed_campaign_id) = ${sql.lit(key)}`,
                (s) => {
                  // Compatibility for held snapshots made before sender variables
                  // existed. Never replace frozen values or change a released request.
                  s.modify(sql`update bulk_email_delivery_recipients recipient
                  set variables = ${
                    sql.jsonBuildObject(legacy)
                  } || recipient.variables
                  where recipient.delivery_id in (${
                    this.deliveryIdsQuery(sql`p_delivery_id`)
                  })
                    and exists (select 1 from bulk_email_deliveries delivery
                      where delivery.id = recipient.delivery_id and delivery.status = 'held')
                    and ${
                    sql.or(...names.map((name) =>
                      sql`json_typeof(recipient.variables->${
                        sql.lit(name)
                      }) is null`
                    ))
                  }`);
                },
              );
            }
            s.forEachQuery(
              this.deliveryIdsQuery(sql`p_delivery_id`),
              "release_batch",
              (s) => {
                this.deliverySource.releaseHeld(s, {
                  deliveryId: sql`release_batch.id`,
                  subjectTemplate: sql`p_subject`,
                  htmlTemplate: sql`p_html`,
                  textTemplate: sql`p_text`,
                  releasedDeliveryIdScalar: "released_delivery_id",
                });
                s.throwErrorIf(
                  sql`released_delivery_id is null`,
                  sql.lit`Campaign delivery is no longer held`,
                );
              },
            );
          }).else((s) => this.discardDeliveries(s, sql`p_delivery_id`));
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
        where status = 'scheduled' and delivery_id is not null and scheduled_at <= now()
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

  /** Create and schedule atomically in the caller's transaction. */
  createAndSchedule<T extends IServerBaseStatements>(s: T, opts: {
    name: AnyExpr;
    templateId: AnyExpr;
    senderKey: Sql;
    scheduledAt?: AnyExpr;
    recipientsQuery?: Sql;
    campaignIdScalar: string;
  }) {
    s.throwErrorUnless(
      sql`nullif(trim(${opts.name}), '') is not null and length(trim(${opts.name})) <= 200`,
      sql.lit`Campaign name is required and must be at most 200 characters.`,
    );
    s.defScalar(opts.campaignIdScalar, { type: "BigInt" });
    s.modify(
      sql`insert into marketing_email_campaigns(name, email_template_id, sender_key, status, scheduled_at)
      values (trim(${opts.name}), ${opts.templateId}, ${opts.senderKey}, 'scheduled', coalesce(${
        opts.scheduledAt ?? sql`null::timestamptz`
      }, now()))
      returning id into ${sql.ref(opts.campaignIdScalar)}`,
    );
    this.schedule(s, {
      campaignId: sql.ref(opts.campaignIdScalar),
      scheduledAt: opts.scheduledAt,
      recipientsQuery: opts.recipientsQuery,
    });
  }

  /** Freeze a newly inserted campaign in the same transaction as its creation. */
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
          where campaign.id = ${opts.campaignId} and campaign.status = 'scheduled' and campaign.delivery_id is null
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
          where id = ${opts.campaignId} and status = 'scheduled' and delivery_id is null`,
    );
    const audience = `${prefix}_audience`;
    s.defTable(
      audience,
      sql`select source_recipient_key, email, variables, from_address, reply_to, sender_valid, sender_error, recipient_label,
      row_number() over(partition by from_address, reply_to order by email, source_recipient_key) as recipient_number
      from (${
        this.buildAudienceQuery(sql.ref(campaign), opts.recipientsQuery)
      }) recipient`,
    );
    s.throwErrorUnless(
      sql`(select count(*) from ${
        sql.ref(audience)
      }) between 1 and ${MAX_CAMPAIGN_RECIPIENTS}`,
      sql
        .lit`A campaign requires between 1 and 10,000 unique eligible recipients.`,
    );
    s.throwErrorIf(
      sql`exists (select 1 from ${sql.ref(audience)} recipient where not ${
        this.validSender(sql`recipient`)
      })`,
      sql`'Cannot schedule: ' || (select count(*)::string from ${
        sql.ref(audience)
      } recipient
        where not ${
        this.validSender(sql`recipient`)
      }) || ' contact(s) need sender corrections. ' ||
        (select string_agg(problem, '; ') from (
          select coalesce(recipient_label, email) || ' (' || email || '): ' ||
            coalesce(sender_error, 'Sender unavailable or invalid. Review the contact owner.') as problem
          from ${sql.ref(audience)} recipient where not ${
        this.validSender(sql`recipient`)
      }
          order by email limit 5) problems) || ' Review the sender preview for correction links.'`,
    );
    s.defScalar(deliveryId, { type: "BigInt" });
    s.forEachQuery(
      sql`select from_address, reply_to, batch_index,
        row_number() over(order by from_address, reply_to, batch_index) as batch_number
      from (select from_address, reply_to,
        floor((recipient_number - 1) / ${CAMPAIGN_BATCH_SIZE}.0)::bigint as batch_index
        from ${sql.ref(audience)}) numbered
      group by from_address, reply_to, batch_index
      order by batch_number`,
      `${prefix}_batch`,
      (s) => {
        const batch = sql.ref(`${prefix}_batch`);
        this.deliverySource.createHeld(s, {
          sourceRecordKey: sql`${
            sql.ref(campaign)
          }.id::string || case when ${batch}.batch_number = 1 then '' else ':batch:' || ${batch}.batch_number::string end`,
          from: sql`${batch}.from_address`,
          replyTo: sql`${batch}.reply_to`,
          recipientsQuery:
            sql`select source_recipient_key, email, variables from ${
              sql.ref(audience)
            }
          where from_address = ${batch}.from_address
            and (reply_to is not distinct from ${batch}.reply_to)
            and recipient_number between ${batch}.batch_index * ${CAMPAIGN_BATCH_SIZE} + 1
              and (${batch}.batch_index + 1) * ${CAMPAIGN_BATCH_SIZE}`,
          deliveryIdScalar: `${prefix}_batch_delivery_id`,
        });
        s.if(
          sql`${batch}.batch_number = 1`,
          (s) =>
            s.setScalar(deliveryId, sql.ref(`${prefix}_batch_delivery_id`)),
        )
          .else((s) =>
            s.modify(
              sql`insert into marketing_email_campaign_delivery_batches(first_delivery_id, delivery_id)
          values (${sql.ref(deliveryId)}, ${
                sql.ref(`${prefix}_batch_delivery_id`)
              })`,
            )
          );
      },
    );
    s.defScalar(scheduledCampaignId, { type: "BigInt" });
    s.modify(sql`update marketing_email_campaigns
      set scheduled_at = coalesce(${
      opts.scheduledAt ?? sql`null::timestamptz`
    }, now()), status = 'scheduled', delivery_id = ${sql.ref(deliveryId)}
      where id = ${opts.campaignId} and status = 'scheduled' and delivery_id is null
      returning id into ${sql.ref(scheduledCampaignId)}`);
    s.throwErrorIf(
      sql`${sql.ref(scheduledCampaignId)} is null`,
      sql.lit`Campaign has already been scheduled or cancelled`,
    );
  }

  /** Cancel only while every batch is held; retain the audience and sender history. */
  cancel<T extends IServerBaseStatements>(s: T, campaignId: AnyExpr) {
    const cancelledId = `marketing_campaign_cancelled_${this
      .scheduleSequence++}`;
    s.defScalar(cancelledId, { type: "BigInt" });
    s.modify(
      sql`update marketing_email_campaigns campaign set status = 'cancelled'
      where campaign.id = ${campaignId} and campaign.status = 'scheduled'
        and campaign.delivery_id is not null
        and not exists (select 1 from bulk_email_deliveries delivery
          where delivery.id in (${
        this.deliveryIdsQuery(sql`campaign.delivery_id`)
      })
            and (delivery.status != 'held' or delivery.source != 'marketing_campaign'))
      returning id into ${sql.ref(cancelledId)}`,
    );
    s.throwErrorIf(
      sql`${sql.ref(cancelledId)} is null`,
      sql
        .lit`Only scheduled campaigns whose delivery has not started can be cancelled.`,
    );
  }

  private processDueCampaigns<T extends IServerBaseStatements>(s: T) {
    s.forEachQuery(
      sql`select id from marketing_email_campaigns
          where status = 'scheduled' and delivery_id is not null and scheduled_at <= now()
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

  /** Send template content to up to 10 comma-separated test addresses without creating a campaign. Authorize first; call outside a transaction.
   * Uses a sample audience member for variables without changing campaign/delivery state.
   */
  sendTest<T extends IServerBaseStatements>(s: T, opts: {
    campaignId?: AnyExpr;
    templateId?: AnyExpr;
    senderKey?: Sql;
    to: AnyExpr;
    sampleRecipientKey: AnyExpr;
    /** Required for unsaved tests; authorized selected audience used to schedule. */
    recipientsQuery?: Sql;
  }) {
    if (opts.campaignId === undefined && opts.recipientsQuery === undefined) {
      throw new Error("Unsaved campaign tests require a selected audience.");
    }
    const recipients = `marketing_test_recipients_${this.scheduleSequence++}`;
    s.defTable(recipients, {
      fields: [
        { name: "source_recipient_key", type: "String" },
        { name: "email", type: "String" },
      ],
    });
    if (opts.recipientsQuery) {
      s.modify(
        sql`insert into ${sql.ref(recipients)} (source_recipient_key, email)
        select source_recipient_key, email from (${opts.recipientsQuery}) selected
        where source_recipient_key = ${opts.sampleRecipientKey}`,
      );
    }
    s.callStoredProcedure("marketing_email_campaign_send_test", {
      inputScalars: {
        p_campaign_id: opts.campaignId ?? sql`null`,
        p_template_id: opts.templateId ?? sql`null`,
        p_sender_key: opts.senderKey ?? sql`null`,
        p_test_to: opts.to,
        p_sample_key: opts.sampleRecipientKey,
      },
      inputTables: { p_test_recipients: recipients },
    });
  }

  /** Frozen samples across every batch; shared by the scheduled test picker and sender. */
  scheduledTestRecipientsQuery(campaign: Sql) {
    const legacyVariables = sql.caseWhen({
      operand: sql`${campaign}.sender_key`,
      conditions: Object.entries(this.opts.senders).map(([key, sender]) => ({
        condition: sql.lit(key),
        expr: sql.jsonBuildObject(sender.legacyVariables ?? {}),
      })),
      default: sql`json_build_object()`,
    });
    return sql`select recipient.source_recipient_key, recipient.email,
      recipient.email as recipient_label, null::string as recipient_href,
      delivery.from_email as from_address, delivery.reply_to_email as reply_to,
      null::string as sender_error, true as sender_valid,
      ${legacyVariables} || recipient.variables as variables
      from bulk_email_delivery_recipients recipient
      join bulk_email_deliveries delivery on delivery.id = recipient.delivery_id
      where recipient.delivery_id in (${
      this.deliveryIdsQuery(sql`${campaign}.delivery_id`)
    })
        and ${campaign}.status = 'scheduled' and delivery.source = 'marketing_campaign'`;
  }

  /** Audience snapshot query shared by scheduling and Spark previews. */
  buildAudienceQuery(campaign: Sql, selectedRecipients?: Sql) {
    const variables = Object.fromEntries(
      Object.entries(this.opts.audience.recipientVariables ?? {}).map(
        ([name, variable]) => [
          name,
          variable.expr(sql.ref("campaign_recipient"), campaign),
        ],
      ),
    );
    return sql`select source_recipient_key, email, recipient_label, recipient_href,
      variables || coalesce(sender->'variables', json_build_object()) as variables,
      sender->>'from_address' as from_address, sender->>'reply_to' as reply_to,
      sender->>'error' as sender_error,
      coalesce(try_cast(sender->>'is_fallback' as boolean), false) as sender_is_fallback,
      coalesce(json_typeof(sender) = 'object' and sender->>'error' is null
        and json_typeof(sender->'variables') = 'object', false) as sender_valid
      from (
      select cast(audience.source_recipient_key as string) as source_recipient_key,
        lower(trim(audience.email)) as email,
        ${
      this.opts.audience.recipientLabel?.(sql`campaign_recipient`) ??
        sql`lower(trim(audience.email))`
    } as recipient_label,
        ${
      this.opts.audience.recipientHref?.(sql`campaign_recipient`) ??
        sql`cast(null as string)`
    } as recipient_href,
        ${sql.jsonBuildObject(variables)} as variables,
        ${this.senderExpr(sql`campaign_recipient`, campaign)} as sender,
        row_number() over(partition by lower(trim(audience.email))
          order by cast(audience.source_recipient_key as string)) as email_rank
      from (${
      selectedRecipients ?? this.opts.audience.recipientsQuery(campaign)
    }) audience
      join ${sql.ref(this.opts.audience.recipientTableName)} campaign_recipient
        on campaign_recipient.id = try_cast(audience.source_recipient_key as bigint)
      where ${campaign}.id is not null
        and not exists (select 1 from bulk_email_suppressions suppression
          where suppression.email = lower(trim(audience.email)))
      ) ranked where email_rank = 1`;
  }

  private senderVariables() {
    const variables: Record<string, { description: string }> = {};
    for (const sender of Object.values(this.opts.senders)) {
      for (
        const [name, description] of Object.entries(sender.variables ?? {})
      ) {
        variables[name] = { description };
      }
    }
    return variables;
  }

  private senderExpr(recipient: Sql, campaign: Sql) {
    return sql.caseWhen({
      operand: sql`${campaign}.sender_key`,
      conditions: Object.entries(this.opts.senders).map(([key, sender]) => ({
        condition: sql.lit(key),
        expr: sender.resolve
          ? sender.resolve(recipient, campaign)
          : sql.jsonBuildObject({
            from_address: sender.fromAddress,
            reply_to: sender.replyTo ? sql.lit(sender.replyTo) : sql`null`,
            variables: sql`json_build_object()`,
          }),
      })),
      default: sql`null`,
    });
  }

  validSender(recipient: Sql) {
    return sql`coalesce(${recipient}.sender_valid
      and length(trim(${recipient}.from_address)) between 1 and 500
      and not regex.is_match(${recipient}.from_address, ${sql.lit`[\r\n]`})
      and (${recipient}.reply_to is null or (
        length(trim(${recipient}.reply_to)) between 1 and 500
        and not regex.is_match(${recipient}.reply_to, ${sql.lit`[\r\n]`})
      )), false)`;
  }

  /** Render campaign content without scheduling or delivering it. */
  renderCampaign<T extends IServerBaseStatements>(
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
