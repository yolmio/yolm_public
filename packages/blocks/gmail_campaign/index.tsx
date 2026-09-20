import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { GmailIcon } from "components/icons/gmail";
import {
  List,
  ListItem,
  ListItemContent,
  ListItemDecorator,
} from "components/list";
import { Typography } from "components/typography";
import type { Oauth2TokenOpts } from "services/google/auth";
import { Gmail } from "services/google/gmail";
import { GoogleUserInfo } from "services/google/user_info";
import { Data } from "std/data";
import {
  isLocalhostHost,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
import type { AnyExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  IServerBaseStatements,
} from "std/statements";
import type { App } from "std/system";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import type { QueryParam } from "std/yom";
import { getCapabilities } from "std/yolm_gen_api";
import type { EmailCampaignProvider } from "blocks/email_campaign_provider";

/**
 * Email provider integration that sends bulk campaign emails through a
 * user's Gmail account. Implements {@link EmailCampaignProvider} for a
 * system-owned campaign workflow:
 *
 * ```ts
 * const providers: EmailCampaignProvider[] = [new GmailProvider()];
 * ```
 */
export class GmailProvider implements EmailCampaignProvider {
  name = "gmail";
  #gmail = new Gmail();
  #caps = getCapabilities()?.blocks?.GmailProvider;

  #getOauthOpts = (
    accountId: AnyExpr,
    optIn?: boolean,
  ): Oauth2TokenOpts => {
    return {
      managedOauthCredentialId:
        sql`(select credential_id from email_campaign_accounts where id = ${accountId})`,
      onReauthRequired: (s) => {
        s.startTransaction();
        s.modify(
          sql`update email_campaign_accounts set refresh_token_status = 'failed' where id = ${accountId}`,
        );
        s.commitTransaction();
      },
      optIn,
    };
  };

  sendEmail<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: Sql;
      to: Sql;
      cc?: Sql;
      bcc?: Sql;
      subject: Sql;
      body: Sql;
      previewText?: Sql;
      from: Sql;
      replyTo?: Sql;
      headers?: { name: Sql; value: Sql }[];
      responseScalar?: string;
    },
  ): void {
    // Don't wrap in try/catch - let errors propagate to the caller
    const oauthOpts = this.#getOauthOpts(
      params.accountId,
      !!this.#caps?.send_emails,
    );

    this.#gmail.messages.send(s, {
      ...oauthOpts,
      accountId: params.accountId,
      toTable: params.to,
      ccTable: params.cc || sql.lit``,
      bccTable: params.bcc || sql.lit``,
      subject: params.subject,
      body: params.body,
      previewText: params.previewText,
      from: params.from,
      replyTo: params.replyTo,
      responseScalar: params.responseScalar,
    });
  }

  checkBounces<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: Sql;
      afterDate: Sql;
      emailsTable: string;
      recipientsTable: string;
      attachmentsTable: string;
      maxResults?: AnyExpr;
    },
  ): void {
    const oauthOpts = this.#getOauthOpts(
      params.accountId,
      !!this.#caps?.check_responses,
    );

    this.#gmail.messages.list(s, {
      ...oauthOpts,
      accountId: params.accountId,
      emailsTable: params.emailsTable,
      recipientsTable: params.recipientsTable,
      maxResults: params.maxResults || sql`100`,
      query:
        sql`'in:inbox after:' || format.date(${params.afterDate}, '%Y/%m/%d')`,
      attachmentsTable: params.attachmentsTable,
    });
  }

  checkResponses<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: Sql;
      afterDate: Sql;
      threadIds: string;
      responsesTable: string;
      maxResults?: AnyExpr;
    },
  ): void {
    const oauthOpts = this.#getOauthOpts(
      params.accountId,
      !!this.#caps?.check_responses,
    );

    s.defTable("tracked_thread_ids", {
      fields: [
        { name: "thread_id", type: "String" },
      ],
    });

    s.modify(
      sql`insert into tracked_thread_ids (thread_id)
        select distinct thread_id from ${
        sql.ref(params.threadIds)
      } where thread_id is not null`,
    );

    s.defTable("response_emails", {
      fields: [
        { name: "message_id", type: "String" },
        { name: "thread_id", type: "String" },
        { name: "snippet", type: "String" },
        { name: "from", type: "String" },
        { name: "subject", type: "String" },
        { name: "date", type: "Timestamp" },
      ],
    });

    s.defTable("response_email_recipients", {
      fields: [
        { name: "message_id", type: "String" },
        { name: "email", type: "String" },
        { name: "recipient_type", type: "String" },
      ],
    });

    s.defTable("response_email_attachments", {
      fields: [
        { name: "message_id", type: "String" },
        { name: "attachment_id", type: "String" },
        { name: "filename", type: "String" },
        { name: "content_type", type: "String" },
        { name: "ccid", type: "String" },
        { name: "data", type: "String" },
      ],
    });

    this.#gmail.messages.list(s, {
      ...oauthOpts,
      accountId: params.accountId,
      emailsTable: "response_emails",
      recipientsTable: "response_email_recipients",
      maxResults: params.maxResults || sql`500`,
      query:
        sql`'in:inbox after:' || format.date(${params.afterDate}, '%Y/%m/%d')`,
      attachmentsTable: "response_email_attachments",
    });

    s.forEachQuery(
      sql`select re.*
        from response_emails re
        inner join tracked_thread_ids tti on tti.thread_id = re.thread_id
        where re.date > ${params.afterDate}`,
      "response",
      (s) => {
        s.modify(
          sql`insert into ${sql.ref(params.responsesTable)}
            (thread_id, message_id, from_email, subject, received_date)
          values (response.thread_id, response.message_id, response.from, response.subject, response.date)
         `,
        );
      },
    );
  }

  navigateToOauth(s: DomStatements) {
    s.defScalar("oauth_start_error", {
      type: "String",
    });
    s.defScalar("authorize_url", {
      type: "String",
    });
    s.tryServer({
      body: (s) => {
        s.getHeader(sql.lit`yolm-origin-domain`, "oauth_origin_domain");
        s.defScalar(
          "oauth_origin_domain_lower",
          sql`lower(coalesce(oauth_origin_domain, ''))`,
        );
        s.defScalar(
          "oauth_redirect_uri",
          sql`case when ${
            isLocalhostHost(sql`oauth_origin_domain_lower`)
          } then 'http://localhost:3000/can-write/gmail-campaign-oauth-redirect' else 'https://yolmglobalapi.com/can-write/gmail-campaign-oauth-redirect' end`,
        );
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`start_flow`,
          requestJson: sql`json_build_object(
            'provider', 'google_gmail_campaign',
            'scopes', json_build_array(
              'https://www.googleapis.com/auth/gmail.send',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/userinfo.profile'
            ),
            'redirect_uri', oauth_redirect_uri
          )`,
          resultJsonScalar: "start_flow_result",
          errorJsonScalar: "start_flow_error",
        });
        s.if(sql`start_flow_error is not null`, (s) => {
          s.setScalar(
            "oauth_start_error",
            sql`coalesce(start_flow_error->>'message', 'Failed to start OAuth flow')`,
          );
          s.return();
        });
        s.setScalar("authorize_url", sql`start_flow_result->>'authorize_url'`);
      },
      errorName: "start_flow_proc_error",
      catch: (s) => {
        s.setScalar(
          "oauth_start_error",
          sql`coalesce(start_flow_proc_error.message, 'Failed to start OAuth flow')`,
        );
      },
    });
    s.if(sql`oauth_start_error is not null`, (s) => {
      s.location.assign(
        sql.concat(
          "/oauth-error?error_msg=",
          sql`uri.encode_component(oauth_start_error)`,
        ),
      );
    }, (s) => {
      s.location.assign(sql`authorize_url`);
    });
  }

  addOauthRedirect(app: App): void {
    if (!app || typeof app.domain !== "string") {
      console.warn(
        "GmailProvider.addOauthRedirect: Invalid app object or missing domain",
      );
      return;
    }

    const callbackQueryParams = [
      { name: "code", type: { type: "String", maxLength: 8_000 } },
      { name: "state", type: { type: "String", maxLength: 8_000 } },
      { name: "error", type: { type: "String", maxLength: 8_000 } },
      { name: "error_description", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];
    const redirectQueryParams = [
      ...callbackQueryParams,
      { name: "scope", type: { type: "String", maxLength: 8_000 } },
      { name: "error_uri", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];

    system.globalApi.get("/can-write/gmail-campaign-oauth-redirect", {
      query: redirectQueryParams,
      procedure: (s) => {
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`resolve_callback_target`,
          requestJson: sql`json_build_object(
            'provider', 'google_gmail_campaign',
            'state', state
          )`,
          resultJsonScalar: "callback_target_result",
          errorJsonScalar: "callback_target_error",
        });
        s.if(sql`callback_target_error is not null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/oauth-email-error?error_msg=",
              sql`uri.encode_component(coalesce(callback_target_error->>'message', 'OAuth redirect callback resolution failed'))`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.defScalar(
          "original_host",
          sql`callback_target_result->>'original_host'`,
        );
        const queryParamValues = queryParamsString({
          code: sql`code`,
          state: sql`state`,
          scope: sql`scope`,
          error: sql`error`,
          error_description: sql`error_description`,
          error_uri: sql`error_uri`,
        });
        s.if(sql`original_host is null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.lit`/oauth-email-error?error_msg=no_original_host`,
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            localhostAwareScheme(sql`lower(original_host)`),
            sql`original_host`,
            "/api/can-write/gmail-campaign-oauth-callback?",
            queryParamValues,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });

    const body = (s: EndpointStatements) => {
      s.if(sql`error is not null and error != ''`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-email-error?error_msg=",
            sql`uri.encode_component(coalesce(error_description, error))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });

      s.if(sql`code is null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-email-error?error_msg=",
            sql`uri.encode_component('No auth code found when integrating Gmail')`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });

      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`complete_callback`,
        requestJson: sql`json_build_object(
          'provider', 'google_gmail_campaign',
          'code', code,
          'state', state
        )`,
        resultJsonScalar: "callback_result",
        errorJsonScalar: "callback_error",
      });
      s.if(sql`callback_error is not null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-email-error?error_msg=",
            sql`uri.encode_component(coalesce(callback_error->>'message', 'OAuth callback failed'))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });

      const userInfo = new GoogleUserInfo();
      userInfo.getUserEmailNameInfo(s, {
        managedOauthCredentialId:
          sql`(callback_result->>'credential_id')::bigint`,
        userEmailNameInfoRecord: "gmail_user_info",
        optIn: !!this.#caps?.oauth,
      });

      s.startTransaction();
      s.modify(
        sql`merge into email_campaign_accounts as target
          using (select
            (callback_result->>'credential_id')::bigint as credential_id,
            callback_result->>'provider_email' as email,
            gmail_user_info.given_name as first_name,
            gmail_user_info.family_name as last_name,
            'active' as status
          ) as source
          on target.provider = 'gmail' and target.email = source.email
          when matched then
            update set
              credential_id = source.credential_id,
              status = source.status,
              first_name = source.first_name,
              last_name = source.last_name,
              refresh_token_status = 'active'
          when not matched then
            insert (provider, email, credential_id, status, first_name, last_name, refresh_token_status)
            values ('gmail', source.email, source.credential_id, source.status, source.first_name, source.last_name, 'active')`,
      );

      s.if(
        sql`not exists(select 1 from email_campaign_settings where singleton = true)`,
        (s) => {
          s.modify(
            sql`insert into email_campaign_settings (singleton) values (true)`,
          );
        },
      );
      s.commitTransaction();

      s.setHeader(
        sql.lit`Location`,
        sql.lit`/email-campaign-integration?success=true`,
      );
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };

    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/gmail-campaign-oauth-callback",
      {
        query: callbackQueryParams,
        procedure: body,
      },
    );

    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/gmail-campaign-oauth-callback",
        {
          query: callbackQueryParams,
          procedure: body,
        },
      );
    }
  }
}

/**
 * Card-style integration UI for connecting / disconnecting a user's
 * Gmail account to a bulk email campaign. Pair with a {@link GmailProvider}
 * instance registered on the bulk email campaign block.
 */
export function GmailIntegrationCard(props: { provider: GmailProvider }) {
  return (
    <Card variant="outlined">
      <div
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          px: 4,
          py: 8,
        }}
      >
        <GmailIcon sx={{ width: 40, height: 40 }} />
        <div sx={{ flex: 1 }}>
          <Typography level="title-lg">Gmail</Typography>
          <Typography level="body-sm">
            Connect your Gmail account to send bulk email campaigns
          </Typography>
        </div>

        <Button
          variant="solid"
          color="primary"
          startIcon="Add"
          size="sm"
          onClick={(s) => {
            props.provider.navigateToOauth(s);
          }}
        >
          Add Gmail Account
        </Button>
      </div>

      <Data
        procedure={(s) => {
          s.defTable(
            "gmail_accounts",
            sql`select * from db.email_campaign_accounts where provider = 'gmail' and credential_id is not null`,
          );
          s.defScalar(
            "has_gmail_accounts",
            sql`(select count(*) from gmail_accounts) > 0`,
          );
        }}
      >
        <Show when={sql`has_gmail_accounts`}>
          <Divider />
          <List>
            <Each table="gmail_accounts" recordName="account">
              <ListItem>
                <ListItemDecorator>
                  <GmailIcon sx={{ width: 20, height: 20 }} />
                </ListItemDecorator>
                <ListItemContent>
                  {sql`account.email`}
                </ListItemContent>
                <Show when={sql`account.status = 'auth_failed'`}>
                  <Chip size="sm" variant="soft" color="danger">
                    Auth Failed
                  </Chip>
                </Show>
                <DeleteRecordButton
                  table="email_campaign_accounts"
                  recordId={sql`account.id`}
                  size="sm"
                  variant="soft"
                  color="danger"
                  description="Are you sure you want to remove this Gmail account? This will stop all email campaigns using this account."
                  globalUndoSnackbarKey="gmail_campaign_account_remove"
                  afterTransactionCommit={(s) => {
                    s.refetch();
                  }}
                >
                  Remove
                </DeleteRecordButton>
              </ListItem>
            </Each>
          </List>
        </Show>
      </Data>
    </Card>
  );
}
