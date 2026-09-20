import { Alert } from "components/alert";
import { Button } from "components/button";
import { PageHeader } from "components/page_header";
import { Typography } from "components/typography";
import { sql } from "../std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import { staticWebhookUrl, system } from "std/system";
import type { StaticWebhook } from "std/system";
import { Conditional, Route, Show } from "std/ui";
import { Data } from "std/data";

const styles = createStyles({
  container: {
    padding: "24px",
    maxWidth: "1200px",
    my: 0,
    mx: "auto",
    width: "100%",
  },
  webhookList: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    marginTop: "24px",
    width: "100%",
  },
  webhookItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px",
    borderRadius: "md",
    backgroundColor: "background.level1",
    border: `1px solid ${cssVar("palette-neutral-outlined-border")}`,
    width: "100%",
  },
  webhookKey: {
    fontFamily: "monospace",
    color: "text.secondary",
  },
});

export function StaticWebhookManagementPageNode() {
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("error", {
          type: "String",
        });
        s.defScalar("refresh_key", 0);
      }}
    >
      <div sx={styles.container}>
        <PageHeader>
          <div>
            <Typography level="h2">Static Webhook Management</Typography>
            <Typography level="body-md" color="neutral">
              Manage your static webhook registrations
            </Typography>
          </div>
        </PageHeader>

        <ol sx={styles.webhookList}>
          {system.staticWebhooks.map(webhookItem)}
        </ol>

        <Show when={sql`error is not null`}>
          <Alert
            color="danger"
            sx={{ marginTop: "16px" }}
            startDecorator="Error"
          >
            {sql`error`}
          </Alert>
        </Show>
      </div>
    </Data>
  );
}

function webhookItem(webhook: StaticWebhook) {
  return (
    <Data
      pendingFallback={null}
      errorFallback={null}
      watch={[sql`refresh_key`]}
      procedure={(s) => {
        s.defScalar("registered", webhook.webhookRegistered);
      }}
    >
      <li sx={styles.webhookItem}>
        <Typography sx={styles.webhookKey}>{webhook.key}</Typography>

        <Conditional
          when={sql`registered`}
          then={
            <Button
              variant="soft"
              color="danger"
              startIcon="Delete"
              onClick={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.statements(webhook.deregister as any);
                    s.increment("refresh_key");
                  },
                  errorName: "service_error",
                  catch: (s) => {
                    s.setScalar(
                      "error",
                      sql.concat(
                        sql.lit`Error in webhook: `,
                        sql`service_error.type`,
                        " ",
                        sql`coalesce(service_error.message, '')`,
                        " ",
                        sql`coalesce(service_error.description, '')`,
                      ),
                    );
                  },
                });
              }}
            >
              De-register
            </Button>
          }
          else={
            <Button
              variant="soft"
              color="primary"
              startIcon="Add"
              onClick={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.statements(
                      webhook.register(
                        sql.lit(staticWebhookUrl(webhook)),
                      ) as any,
                    );
                    s.increment("refresh_key");
                  },
                  errorName: "service_error",
                  catch: (s) => {
                    s.setScalar(
                      "error",
                      sql.concat(
                        sql.lit`Error in webhook: `,
                        sql`service_error.type`,
                        " ",
                        sql`coalesce(service_error.message, '')`,
                        " ",
                        sql`coalesce(service_error.description, '')`,
                      ),
                    );
                  },
                });
              }}
            >
              Register
            </Button>
          }
        />
      </li>
    </Data>
  );
}

export function StaticWebhookManagementPage(props: { path?: string } = {}) {
  return (
    <>
      <Route path={props.path ?? "/static-webhooks"}>
        <StaticWebhookManagementPageNode />
      </Route>
    </>
  );
}
