import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { SearchCardPage } from "pages/search_card_page";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Conditional, Show } from "std/ui";
import { Data } from "std/data";
import {
  OutgoingWebhooksBlock,
  type OutgoingWebhookType,
} from "./outgoing_webhooks_block";

const styles = createStyles({
  webhookCard: {
    p: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignSelf: "flex-start",
  },
  rootHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    mb: 6,
    gap: 8,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 4,
  },
});

function TestWebhookButton(props: { type: OutgoingWebhookType }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("is_failure", false);
        s.defScalar("result", {
          type: "String",
        });
      }}
    >
      <Button
        size="sm"
        startIcon="Send"
        variant="soft"
        onClick={(s) => {
          s.tryServer({
            body: (s) => {
              props.type.sendTestRequest!(s, { url: sql`webhook.url` });
              s.conditional({
                condition: sql`response.status in (200, 201, 204)`,
                then: (s) => {
                  s.setScalar(
                    "result",
                    sql.concat(
                      "Server responded with status ",
                      sql`response.status`,
                    ),
                  );
                  s.setScalar("is_failure", false);
                },
                else: (s) => {
                  s.setScalar(
                    "result",
                    sql.concat(
                      "Server responded with status ",
                      sql`response.status`,
                    ),
                  );
                  s.setScalar("is_failure", true);
                },
              });
            },
            errorName: "error",
            catch: (s) => {
              s.setScalar(
                "result",
                sql.concat(
                  "Failed to send test request: ",
                  sql`error.type`,
                  ": ",
                  sql`error.message`,
                ),
              );
              s.setScalar("is_failure", true);
            },
          });
          s.commitUiTreeChanges();
          s.sleep(3000);
          s.setScalar("result", sql.null);
        }}
      >
        Send Test
      </Button>
      <Show when={sql`result is not null`}>
        <Conditional
          when={sql`is_failure`}
          then={
            <Snackbar
              color="danger"
              variant="soft"
              startIcon="Error"
            >
              {sql`result`}
            </Snackbar>
          }
          else={
            <Snackbar
              color="success"
              variant="soft"
              startIcon="Check"
            >
              {sql`result`}
            </Snackbar>
          }
        />
      </Show>
    </Data>
  );
}

function WebhookCard() {
  const ougoingWebhookTypes = system.block(OutgoingWebhooksBlock).types;
  return (
    <Card variant="outlined" sx={styles.webhookCard}>
      <div sx={styles.header}>
        <Typography level="h4" color="primary">
          {sql`webhook.name`}
        </Typography>
      </div>
      <Show when={sql`webhook.description is not null`}>
        <Typography level="body-md">{sql`webhook.description`}</Typography>
      </Show>

      <Typography level="body-sm" startIcon="Link">
        <span className="text-ellipsis overflow-hidden">
          {sql`webhook.url`}
        </span>
      </Typography>

      <Typography level="body-sm" startIcon="Category">
        Type: {sql`webhook.type`}
      </Typography>

      <Typography
        level="body-sm"
        color="neutral"
        startIcon="Analytics"
        component="div"
      >
        Invocations:{" "}
        <Data
          procedure={(s) => {
            s.defScalar(
              "invocation_count",
              sql`(select count(*) from db.outgoing_webhook_invocations where outgoing_webhook_id = webhook.id)`,
            );
          }}
        >
          {sql`format.decimal(invocation_count)`}
        </Data>
      </Typography>

      <div
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          borderTop: "1px solid",
          borderColor: "divider",
          pt: 2,
          gap: 1,
        }}
      >
        {ougoingWebhookTypes.map((type) => {
          if (!type.sendTestRequest) {
            return null;
          }
          return (
            <Show when={sql`webhook.type = ${sql.lit(type.name)}`}>
              <TestWebhookButton type={type} />
            </Show>
          );
        })}

        <AutoUpdateButton
          table="outgoing_webhooks"
          recordId={sql`webhook.id`}
          size="sm"
          variant="plain"
          color="primary"
          startIcon="Edit"
        >
          Edit
        </AutoUpdateButton>
        <DeleteRecordIconButton
          table="outgoing_webhooks"
          recordId={sql`webhook.id`}
          size="sm"
          color="danger"
          variant="plain"
        />
      </div>
    </Card>
  );
}

interface WebhookManagementProps {
  path?: string;
}

/**
 Component that provides a page for managing outgoing webhooks, including creation,
 deletion, testing, and viewing webhook history.

 @category Page Component

 */
export function WebhookManagementPage({
  path = "/webhook-management",
}: WebhookManagementProps) {
  return (
    <SearchCardPage
      table="outgoing_webhooks"
      path={path}
      search
      display="grid"
      header={
        <div sx={styles.rootHeader}>
          <Typography level="h2">Manage Webhooks</Typography>
          <AutoInsertButton
            table="outgoing_webhooks"
            startIcon="Add"
            variant="solid"
            color="primary"
          >
            Add Webhook
          </AutoInsertButton>
        </div>
      }
      recordName="webhook"
      card={<WebhookCard />}
    />
  );
}
