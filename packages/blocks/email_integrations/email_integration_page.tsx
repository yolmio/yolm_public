import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { Divider } from "components/divider";
import {
  List,
  ListItem,
  ListItemContent,
  ListItemDecorator,
} from "components/list";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import { system, useBlock } from "std/system";
import {
  Each,
  Route,
  Show,
  useApp,
  useOptionalICtx,
  useSharedContext,
} from "std/ui";
import type { Node } from "std/ui";
import { SidebarItemsSharedContext } from "std/shared_contexts";
import { SidebarPresenceICtxKey } from "std/ictx";
import { Sidebar } from "components/sidebar";
import type { EmailIntegration, EmailIntegrationConstructor } from "./index";

/** Names one email integration block class to surface on the page. */
export interface EmailIntegrationConfig {
  integration: EmailIntegrationConstructor;
}

interface EmailIntegrationsPageOpts {
  integrations: EmailIntegrationConfig[];
  skipSidebarItem?: boolean;
  path?: string;
  contentAfterAccounts?: Node;
}

/**
 * Self-routing page where users connect/disconnect their Gmail and Outlook
 * email accounts via OAuth. Wires up each integration's OAuth redirect, adds a
 * sidebar item (unless `skipSidebarItem`), and lists connected accounts with
 * their sync status. Mount it directly; do not wrap it in a `<Route>`.
 *
 * @param opts.path - Route path; defaults to `"/email-integrations"`.
 *
 * @category Page Component
 */
export function EmailIntegrationsPage(opts: EmailIntegrationsPageOpts) {
  const path = opts.path ?? "/email-integrations";
  for (const emailIntegration of opts.integrations) {
    const block = useBlock(emailIntegration.integration);
    const app = useApp();
    block.addOauthRedirect(app);
  }
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);

  if (!opts.skipSidebarItem) {
    useSharedContext(SidebarItemsSharedContext).add({
      section: "Email",
      icon: "Email",
      order: 40,
      items: [
        {
          label: "Email Integrations",
          href: path,
          icon: "Settings",
        },
      ],
    });
  }

  return (
    <Route path={path} title="Email Integrations">
      <Data
        local
        procedure={(s) => {
          s.defScalar("refresh_key", sql`0`);
        }}
      >
        <div className="p-8">
          <div className="flex items-center gap-2 mb-4">
            {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
            <Typography level="h3">Email Integrations</Typography>
          </div>
          <Card variant="outlined">
            {opts.integrations.map((integration) => (
              <IntegrationCard
                integration={integration}
                refreshKey="refresh_key"
              />
            ))}
            <Divider />
            <ConnectedAccountsSection
              integrations={opts.integrations}
              refreshKey="refresh_key"
            />
            {opts.contentAfterAccounts}
          </Card>
        </div>
      </Data>
    </Route>
  );
}

function ConnectedAccountsSection({
  integrations,
  refreshKey,
}: {
  integrations: EmailIntegrationConfig[];
  refreshKey: string;
}) {
  return (
    <Data
      watch={[sql`${sql.ref(refreshKey)}`]}
      procedure={(s) => {
        s.defScalar(
          "has_connected_accounts",
          sql.or(
            ...integrations.map((integration) => {
              const block = system.block(integration.integration);
              return sql`exists(select 1 from db.${
                sql.ref(block.accountTable)
              } where sys_user_id = current_user and email is not null)`;
            }),
          ),
        );
      }}
    >
      <Show
        when={sql`has_connected_accounts`}
        fallback={
          <Typography level="body-sm" className="pt-4 px-4">
            No connected email accounts
          </Typography>
        }
      >
        <Divider />
        <ConnectedAccountsList
          integrations={integrations}
          refreshKey={refreshKey}
        />
      </Show>
    </Data>
  );
}

function ConnectedAccountsList({
  integrations,
  refreshKey,
}: {
  integrations: EmailIntegrationConfig[];
  refreshKey: string;
}) {
  return (
    <>
      {integrations.map((integration) => {
        const block = useBlock(integration.integration);
        return (
          <Data
            watch={[sql`${sql.ref(refreshKey)}`]}
            procedure={(s) => {
              s.defTable(
                `${block.accountTable}_account_list`,
                sql`select * from db.${
                  sql.ref(block.accountTable)
                } where sys_user_id = current_user and email is not null`,
              );
            }}
          >
            <List>
              <Each
                table={`${block.accountTable}_account_list`}
                recordName="account"
              >
                <ConnectedAccountItem
                  block={block}
                  refreshKey={refreshKey}
                />
              </Each>
            </List>
          </Data>
        );
      })}
    </>
  );
}

function ConnectedAccountItem({
  block,
  refreshKey,
}: {
  block: EmailIntegration;
  refreshKey: string;
}) {
  const hasSyncStatus = !!system.db.tables[block.accountTable]?.fields
    .sync_status;
  return (
    <ListItem>
      <ListItemDecorator>
        {block.icon({
          sx: { width: 30, height: 30 },
        })}
      </ListItemDecorator>
      <ListItemContent>
        {sql`account.email`}
      </ListItemContent>
      {block.adminStatus}
      <Show when={sql`account.status = 'reauth_required'`}>
        <Button
          size="sm"
          variant="solid"
          color="warning"
          startIcon="Refresh"
          onClick={(s) => {
            block.navigateToOauth(s);
          }}
        >
          Reconnect
        </Button>
      </Show>
      {hasSyncStatus
        ? (
          <Data
            procedure={(s) => {
              s.defScalar(
                "sync_status",
                sql`(select sync_status from db.${
                  sql.ref(block.accountTable)
                } where id = account.id)`,
              );
            }}
          >
            <Show
              when={sql`sync_status = 'pending' or sync_status = 'syncing'`}
            >
              <Typography level="body-sm">Syncing...</Typography>
            </Show>
            <Show when={sql`sync_status = 'failed'`}>
              <Chip size="sm" variant="soft" color="warning">
                Sync problem
              </Chip>
            </Show>
            <Show
              when={sql`sync_status = 'completed' and account.status = 'active'`}
            >
              <Chip size="sm" variant="soft" color="success" startIcon="Check">
                Connected
              </Chip>
            </Show>
          </Data>
        )
        : (
          <Show when={sql`account.status = 'active'`}>
            <Chip size="sm" variant="soft" color="success" startIcon="Check">
              Connected
            </Chip>
          </Show>
        )}
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("removing_email_account", false);
        }}
      >
        <ConfirmDangerDialog
          bindScalar="removing_email_account"
          description="Are you sure you want to remove the account from the system?"
          confirmButtonText="Remove"
          onConfirm={(s) => {
            s.setScalar("dialog_waiting", true);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                block.deleteAccount(s, {
                  accountId: sql`account.id`,
                });
                s.increment(refreshKey);
                s.setScalar("removing_email_account", false);
              },
              errorName: "remove_email_account_error",
              catch: (s) => {
                s.setScalar("dialog_waiting", false);
                s.setScalar(
                  "dialog_error",
                  sql`coalesce(
                    remove_email_account_error.message,
                    'Unable to remove the account'
                  )`,
                );
              },
            });
          }}
        />
        <Button
          size="sm"
          variant="soft"
          color="danger"
          startIcon="Delete"
          onClick={(s) => s.setScalar("removing_email_account", true)}
        >
          Remove
        </Button>
      </Data>
    </ListItem>
  );
}

function IntegrationCard({
  integration,
  refreshKey,
}: {
  integration: EmailIntegrationConfig;
  refreshKey: string;
}) {
  const block = useBlock(integration.integration);

  return (
    <div sx={{ display: "flex", alignItems: "center", gap: 6, px: 4, py: 8 }}>
      {block.icon({ sx: { width: 40, height: 40 } })}
      <div sx={{ flex: 1 }}>
        <Typography level="title-lg">{block.integrationName}</Typography>
        <Typography level="body-sm">
          Connect your {block.integrationName}{" "}
          account to send and receive email notifications
        </Typography>
      </div>
      <Data
        watch={[sql`${sql.ref(refreshKey)}`]}
        procedure={(s) => {
          s.defScalar(
            "has_active_account",
            sql`exists(select 1 from db.${
              sql.ref(block.accountTable)
            } where sys_user_id = current_user and ${block.isActiveAccount})`,
          );
          s.defScalar(
            "has_any_account",
            sql`exists(select 1 from db.${
              sql.ref(block.accountTable)
            } where sys_user_id = current_user and email is not null)`,
          );
        }}
      >
        <Show
          when={sql`has_active_account`}
          fallback={
            <Button
              variant="solid"
              color="primary"
              startIcon="Add"
              size="sm"
              onClick={(s) => {
                block.navigateToOauth(s);
              }}
            >
              {sql`case when has_any_account
                then ${sql.lit(`Reconnect ${block.integrationName}`)}
                else ${sql.lit(`Add ${block.integrationName} Account`)}
              end`}
            </Button>
          }
        >
          <Chip size="sm" variant="soft" color="success" startIcon="Check">
            Connected successfully
          </Chip>
        </Show>
      </Data>
    </div>
  );
}
