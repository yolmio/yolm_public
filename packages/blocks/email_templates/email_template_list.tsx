import { Chip } from "components/chip";
import { DataTable } from "components/data_table";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Link } from "components/link";
import { Menu } from "components/menu";
import { Snackbar } from "components/snackbar";
import { SwitchControl } from "components/switch";
import { Typography } from "components/typography";
import { Sidebar } from "components/sidebar";
import { NavigationItemsSharedContext } from "std/shared_contexts";
import { sql } from "../../std/sql_utils";
import { Route, Show, useOptionalICtx, useSharedContext } from "std/ui";
import { Data } from "std/data";
import { SidebarPresenceICtxKey } from "std/ictx";
import type { Node } from "std/ui";

interface TemplateListPageProps {
  path: string;
  wrapper?: (children: Node) => Node;
}

function EmailTemplateList() {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("show_disabled", false);
        s.defScalar("did_disable", false);
        s.defScalar("did_enable", false);
        s.defScalar("error_message", {
          type: "String",
        });
      }}
    >
      <Show when={sql`did_disable`}>
        <Snackbar
          startIcon="CheckCircle"
          color="success"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          onMount={(s) => {
            s.sleep(3500);
            s.setScalar("did_disable", false);
          }}
        >
          Template disabled
        </Snackbar>
      </Show>
      <Show when={sql`did_enable`}>
        <Snackbar
          startIcon="CheckCircle"
          color="success"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          onMount={(s) => {
            s.sleep(3500);
            s.setScalar("did_enable", false);
          }}
        >
          Template enabled
        </Snackbar>
      </Show>
      <Show when={sql`error_message is not null`}>
        <Snackbar
          startIcon="Error"
          color="danger"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
        >
          {sql`error_message`}
        </Snackbar>
      </Show>
      <DataTable
        query={sql`select * from db.email_templates`}
        primaryTable="email_templates"
        className="h-[calc(100vh-70px)]"
        scrollable
        searchable
        pageSize={25}
        where={sql`show_disabled or is_active`}
        watch={[sql`show_disabled`]}
        header={
          <div className="p-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
                <Typography level="h2">Email Templates</Typography>
              </div>
              <Menu>
                <Menu.Button variant="soft" color="primary" startIcon="Add">
                  Add Template
                </Menu.Button>
                <Menu.Content>
                  <Menu.Item href="/email-templates/new-basic">
                    Basic
                  </Menu.Item>
                  <Menu.Item href="/email-templates/new-advanced">
                    Advanced
                  </Menu.Item>
                </Menu.Content>
              </Menu>
            </div>
            <div className="flex justify-start gap-4 flex-row mt-4 mb-4">
              <FormControl orientation="horizontal" sx={{ minWidth: 200 }}>
                <FormLabel>Show disabled</FormLabel>
                <SwitchControl
                  checked={sql`show_disabled`}
                  onCheckboxChange={(s) => s.toggle("show_disabled")}
                />
              </FormControl>
            </div>
          </div>
        }
        columns={(b) => {
          b.column(
            "Name",
            ({ record }) => (
              <>
                <Link
                  href={sql.concat(
                    "/email-templates/",
                    sql`${record}.id`,
                  )}
                >
                  {sql`${record}.name`}
                </Link>
                <Show when={sql`not ${record}.is_active`}>
                  <Chip color="danger" variant="plain" startIcon="Close">
                    Disabled
                  </Chip>
                </Show>
              </>
            ),
          );
          b.field("type");
          b.field("subject");
        }}
        actions={(b) => {
          b.delete();
          b.custom("Edit", { icon: "EditOutlined" }, (s) => {
            s.navigate(
              sql`'/email-templates/' || email_template.id`,
            );
          });
          b.custom("Toggle Active", { icon: "Archive" }, (s) => {
            s.defScalar("was_active", sql`email_template.is_active`);
            s.tryServer({
              body: (s) => {
                s.startTransaction();
                s.modify(
                  sql`update email_templates set is_active = not is_active where id = email_template.id`,
                );
                s.commitTransaction();
                s.refetch();
              },
              errorName: "error",
              catch: (s) => {
                s.debugExpr(sql`error.type`);
                s.debugExpr(sql`error.message`);
                s.debugExpr(sql`error.description`);
                s.setScalar(
                  "error_message",
                  sql.concat(
                    "Failed to ",
                    sql`case when was_active then 'disable' else 'enable' end`,
                    " template ",
                  ),
                );
                s.return();
              },
            });
            s.conditional({
              condition: sql`was_active`,
              then: (s) => {
                s.setScalar("did_disable", true);
              },
              else: (s) => {
                s.setScalar("did_enable", true);
              },
            });
          });
        }}
      />
    </Data>
  );
}

export function EmailTemplateListPage(props: TemplateListPageProps) {
  const { path } = props;
  useSharedContext(NavigationItemsSharedContext).add({
    label: "Email Templates",
    url: path,
  });
  const content = <EmailTemplateList />;
  return (
    <Route path={path}>
      {props.wrapper ? props.wrapper(content) : content}
    </Route>
  );
}
