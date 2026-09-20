import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { PostmarkIcon } from "components/icons/postmark";
import { List, ListItem, ListItemContent } from "components/list";
import { Typography } from "components/typography";
import { Postmark } from "services/postmark";
import { Data } from "std/data";
import type { AnyExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { Each, Show } from "std/ui";
import type { EmailCampaignProvider } from "blocks/email_campaign_provider";
import { IconButton } from "components/icon_button";

const ENCRYPTION_KEY = "email_campaign_integration";

// Postmark-specific provider implementation
export class PostmarkProvider implements EmailCampaignProvider {
  name = "postmark";

  constructor(
    _opts: {
      serverToken?: Sql;
    } = {},
  ) {}

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
    s.defRecord(
      "postmark_account",
      sql`select * from email_campaign_accounts where id = ${params.accountId}`,
    );

    s.defScalar(
      "decrypted_server_token",
      sql`crypto.decrypt(postmark_account.server_token, ${
        sql.lit(ENCRYPTION_KEY)
      })`,
    );

    const accountPostmark = new Postmark({
      serverToken: sql`decrypted_server_token`,
    });

    accountPostmark.sendEmail(s, {
      from: params.from,
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      htmlBody: params.body,
      textBody: params.previewText,
      replyTo: params.replyTo,
      tag: sql.lit`email-campaign`,
      trackOpens: true,
      trackLinks: "HtmlAndText",
      messageStream: sql.lit`broadcast`,
      emailIsCritical: sql`true`,
      headers: params.headers,
    });

    // The Postmark service sets the response in the 'body' variable
    if (params.responseScalar) {
      s.modify(sql`
        insert into ${sql.ref(params.responseScalar)}
        select
          body->>'MessageID' as message_id,
          body->>'MessageID' as thread_id
      `);
    }
  }

  checkBounces?<T extends IServerBaseStatements>(
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
    // Postmark uses webhooks for real-time bounce notifications
    // This method populates the temporary tables used by bulk email campaign system

    // First, get bounce events from Postmark that match campaign recipients
    s.forEachQuery(
      sql`
        select distinct
          be.email,
          be.bounce_type,
          be.bounced_at,
          be.bounce_description,
          be.message_id,
          ecr.id as recipient_id,
          ecr.provider_message_id,
          ecr.provider_thread_id
        from postmark_bounce_events be
        join email_campaign_recipients ecr on ecr.recipient_email = be.email
        where be.bounced_at > ${params.afterDate}
          and ecr.email_campaign_account_id = ${params.accountId}
          and ecr.status = 'sent'
        ${params.maxResults ? sql`limit ${params.maxResults}` : sql``}
      `,
      "bounce",
      (s) => {
        s.modify(
          sql`
            insert into ${sql.ref(params.emailsTable)} (
              message_id,
              thread_id,
              subject,
              "from",
              date,
              body_text,
              snippet,
              is_read,
              message_reply_id
            ) values (
              bounce.message_id,
              bounce.message_id,
              'Bounce: ' || bounce.bounce_type,
              'postmaster@postmarkapp.com',
              bounce.bounced_at,
              bounce.bounce_description,
              substring(bounce.bounce_description, 1, 200),
              true,
              null
            )
          `,
        );

        s.modify(
          sql`
            insert into ${sql.ref(params.recipientsTable)} (
              message_id,
              email,
              recipient_type
            ) values (
              bounce.message_id,
              bounce.email,
              'to'
            )
          `,
        );
      },
    );
  }

  getAccountStatus?(_accountId: AnyExpr): Sql {
    //is there a way to check if the account is active?
    return sql`'active'`;
  }
}
// Postmark Integration Card Component
export function PostmarkIntegrationCard() {
  return (
    <Card variant="outlined">
      <Data
        local
        procedure={(s) => {
          s.defScalar("show_form", sql`false`);
          s.defScalar("server_token", sql.lit``);
          s.defScalar("email", sql.lit``);
          s.defScalar("display_name", sql.lit``);
          s.defScalar("error_message", sql.lit``);
          s.defScalar("success_message", sql.lit``);
          s.defScalar("show_token", sql`false`);
        }}
      >
        <div className="flex items-center gap-6 px-4 py-8">
          <PostmarkIcon className="w-10 h-10" />
          <div className="flex-1">
            <Typography level="title-lg">Postmark</Typography>
            <Typography level="body-sm">
              Connect your Postmark account to send transactional emails
            </Typography>
          </div>

          <Show when={sql`not show_form`}>
            <Button
              variant="solid"
              color="primary"
              startIcon="Add"
              size="sm"
              onClick={(s) => {
                s.setScalar("show_form", sql`true`);
                s.setScalar("error_message", sql.lit``);
                s.setScalar("success_message", sql.lit``);
              }}
            >
              Add Postmark Account
            </Button>
          </Show>
        </div>

        {/* Add Account Form */}
        <Show
          when={sql`show_form`}
        >
          <Divider />
          <div className="p-3">
            <Typography level="body-sm" className="mb-2">
              Enter your Postmark server token and account details:
            </Typography>

            <div className="flex flex-col gap-2 mb-3">
              <div>
                <Typography level="body-xs" className="mb-0.5">
                  Server Token *
                </Typography>
                <div className="relative flex items-center gap-2 w-[50%]">
                  <input
                    type={sql`case when show_token then 'text' else 'password' end`}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={sql`server_token`}
                    onInput={(s) =>
                      s.setScalar("server_token", sql`target_value`)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                  <Show
                    when={sql`show_token`}
                    fallback={
                      <IconButton
                        variant="plain"
                        size="sm"
                        icon="Visibility"
                        onClick={(s) => s.toggle("show_token")}
                        className="min-w-auto p-1"
                      />
                    }
                  >
                    <IconButton
                      variant="plain"
                      size="sm"
                      icon="VisibilityOff"
                      onClick={(s) => s.toggle("show_token")}
                      className="min-w-auto p-1"
                    />
                  </Show>
                </div>
              </div>

              <div>
                <Typography level="body-xs" className="mb-0.5">
                  Email Address *
                </Typography>
                <input
                  type="email"
                  placeholder="noreply@yourdomain.com"
                  value={sql`email`}
                  onInput={(s) => s.setScalar("email", sql`target_value`)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm w-[50%]"
                />
              </div>

              <div>
                <Typography level="body-xs" className="mb-0.5">
                  Display Name (optional)
                </Typography>
                <input
                  type="text"
                  placeholder="Your Company Name"
                  value={sql`display_name`}
                  onInput={(s) =>
                    s.setScalar("display_name", sql`target_value`)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm w-[50%]"
                />
              </div>
            </div>

            <Show when={sql`error_message != ''`}>
              <Chip variant="soft" color="danger" className="mb-2">
                {sql`error_message`}
              </Chip>
            </Show>

            <div className="flex gap-2">
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => {
                  s.if(sql`server_token = '' or email = ''`, (s) => {
                    s.setScalar(
                      "error_message",
                      sql.lit`Please fill in all required fields`,
                    );
                  }).else((s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();

                        s.if(
                          sql`exists(select 1 from email_campaign_accounts where provider = 'postmark' and email = ui.email)`,
                          (s) => {
                            s.modify(sql`update email_campaign_accounts
                                set server_token = crypto.encrypt(ui.server_token, ${
                              sql.lit(ENCRYPTION_KEY)
                            }),
                                    display_name = case when ui.display_name = '' then null else ui.display_name end,
                                    status = 'active',
                                    last_sync_at = now()
                                where provider = 'postmark' and email = ui.email`);
                          },
                        ).else((s) => {
                          s.modify(sql`insert into email_campaign_accounts
                              (provider, email, display_name, server_token, status)
                              values ('postmark', ui.email,
                                      case when ui.display_name = '' then null else ui.display_name end,
                                      crypto.encrypt(ui.server_token, ${
                            sql.lit(ENCRYPTION_KEY)
                          }),
                                      'active')`);
                        });

                        s.if(
                          sql`not exists(select 1 from email_campaign_settings where singleton = true)`,
                          (s) => {
                            s.modify(
                              sql`insert into email_campaign_settings (singleton) values (true)`,
                            );
                          },
                        );

                        s.commitTransaction();

                        s.setScalar(
                          "success_message",
                          sql.lit`Postmark account added successfully!`,
                        );
                        s.setScalar("show_form", sql`false`);
                        s.setScalar("server_token", sql.lit``);
                        s.setScalar("email", sql.lit``);
                        s.setScalar("display_name", sql.lit``);
                        s.setScalar("show_token", sql`false`);
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "error_message",
                          sql
                            .lit`Failed to add Postmark account. Please check your server token.`,
                        );
                      },
                    });
                  });
                }}
              >
                Add Account
              </Button>
              <Button
                variant="plain"
                color="neutral"
                onClick={(s) => {
                  s.setScalar("show_form", sql`false`);
                  s.setScalar("server_token", sql.lit``);
                  s.setScalar("email", sql.lit``);
                  s.setScalar("display_name", sql.lit``);
                  s.setScalar("error_message", sql.lit``);
                  s.setScalar("show_token", sql`false`);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Show>
        <Data
          procedure={(s) => {
            s.defTable(
              "postmark_accounts",
              sql`select * from db.email_campaign_accounts where provider = 'postmark' and server_token is not null`,
            );
            s.defScalar(
              "has_postmark_accounts",
              sql`(select count(*) from postmark_accounts) > 0`,
            );
          }}
        >
          <Show when={sql`has_postmark_accounts`}>
            <Divider />
            <List>
              <Each table="postmark_accounts" recordName="account">
                <ListItem>
                  <ListItemContent>
                    {sql`account.email`}
                    <Show when={sql`account.display_name is not null`}>
                      <Typography level="body-xs">
                        {sql`account.display_name`}
                      </Typography>
                    </Show>
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
                    description="Are you sure you want to remove this Postmark account? This will stop all email campaigns using this account."
                    globalUndoSnackbarKey="postmark_campaign_account_remove"
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

        {/* Success Message */}
        <Show when={sql`success_message != ''`}>
          <Divider />
          <div className="p-3">
            <Chip variant="soft" color="success">
              {sql`success_message`}
            </Chip>
          </div>
        </Show>

        {/* Help Text */}
        <Show when={sql`not show_form`}>
          <Divider />
          <div className="p-3">
            <Typography level="body-xs" className="text-neutral-600">
              <strong>Note:</strong>{" "}
              You can find your Server Token in your Postmark account under
              "Servers" → Select your server → "API Tokens" tab.
            </Typography>
          </div>
        </Show>
      </Data>
    </Card>
  );
}
