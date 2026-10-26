import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { DataTable } from "components/data_table";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import { PageHeader } from "components/page_header";
import { Typography } from "components/typography";
import { sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import type { UiServerStatements } from "std/statements";
import { baseGridStyles, containerStyles } from "std/style_utils";
import type { Node } from "std/ui";
import { Each, Redirect, Route, Show } from "std/ui";
import { Form } from "std/form";
import { Data } from "std/data";
import { InsertPage } from "../../pages/insert_page";
import { RecordPage } from "pages/record_page";
import { UpdatePage } from "../../pages/update_page";
import { countRolePermissions, getRolePermissions } from "./index";
import {
  PermissionEntry,
  PermissionFormEntries,
  PermissionListCard,
} from "./permissions";
import { IconButton } from "components/icon_button";
import {
  assertAccessAdministrator,
  assertOriginalAccessActor,
} from "./access_policy";

export function RolePages(
  props: {
    backHomeButton?: boolean;
    backButtonRef?: string;
    rolePagePath?: string;
    /** Wraps each route's content. Useful for adding layout wrappers like sidebars. */
    wrapper?: (children: Node) => Node;
    /** Server-side authorization asserted before every role write. */
    beforeMutation?: (s: UiServerStatements) => void;
  },
) {
  const list = (
    <RolesList
      backHomeButton={props.backHomeButton}
      backButtonRef={props.backButtonRef}
    />
  );
  return (
    <>
      <Route path={props.rolePagePath || "/roles"} title="Roles">
        {props.wrapper ? props.wrapper(list) : list}
      </Route>
      {props.rolePagePath && props.rolePagePath !== "/roles" && (
        <Route path="/roles">
          <Redirect to={props.rolePagePath} />
        </Route>
      )}
      <InsertPage
        table="auth_roles"
        title="Add Role"
        navigateAfterSubmit
        path="/roles/add"
        wrapper={props.wrapper}
        afterTransactionStart={(s) => {
          assertOriginalAccessActor(s);
          assertAccessAdministrator(s);
          props.beforeMutation?.(s);
        }}
      >
        <RoleForm isNew />
      </InsertPage>
      <UpdatePage
        table="auth_roles"
        title="Edit Role"
        path="/roles/{record_id:id}/edit"
        wrapper={props.wrapper}
        afterTransactionStart={(s) => {
          assertOriginalAccessActor(s);
          assertAccessAdministrator(s);
          props.beforeMutation?.(s);
        }}
        afterTransactionCommit={(s) => {
          s.navigate(sql`'/roles/' || ui.record_id`);
        }}
      >
        <RoleForm />
      </UpdatePage>
      <RoleDetailPage wrapper={props.wrapper} />
    </>
  );
}

function RolesList(
  props: { backHomeButton?: boolean; backButtonRef?: string },
) {
  return (
    <DataTable
      query={sql`select
        r.*,
        (select count(distinct sys_user_id) from (
          select sys_user_id, auth_role_id from db.auth_user_roles
          union all
          select sys_user_id, auth_role_id from db.auth_user_role_sources
        ) membership where membership.auth_role_id = r.id) as user_count,
        ${countRolePermissions(sql`r.id`)} as permission_count,
        e.name as extends_name
      from db.auth_roles r
      left join db.auth_roles e on e.id = r.extends`}
      primaryTable="auth_roles"
      className="h-[calc(100vh-70px)]"
      scrollable
      searchable
      sortable
      pageSize={25}
      header={
        <div className="p-2">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              {props.backHomeButton && (
                <IconButton
                  icon="HomeOutlined"
                  variant="plain"
                  color="neutral"
                  href={props.backButtonRef || "/"}
                  aria-label="Home"
                />
              )}
              <Typography level="h2">Roles</Typography>
            </div>
            <Button startIcon="Add" href="/roles/add">
              Add Role
            </Button>
          </div>
        </div>
      }
      columns={(b) => {
        b.field("name", "Name");
        b.simpleColumn("description", "Description");
        b.column(
          "Users",
          ({ record }) => (
            <Typography level="body-sm" startIcon="People">
              {sql`${record}.user_count`}
            </Typography>
          ),
          { field: "user_count" },
        );
        b.column(
          "Permissions",
          ({ record }) => (
            <Link href={sql`'/roles/' || ${record}.id`}>
              {sql`${record}.permission_count`} permissions
              <MaterialIcon icon="ArrowOutward" />
            </Link>
          ),
          { field: "permission_count" },
        );
        b.column(
          "Inheritance",
          ({ record }) => (
            <Show
              when={sql`${record}.extends_name is not null`}
              fallback={<Typography level="body-sm">None</Typography>}
            >
              {sql`${record}.extends_name`}
            </Show>
          ),
          { field: "extends_name" },
        );
      }}
      actions={(b) => {
        b.custom("View", { icon: "InfoOutlined" }, (s) => {
          s.navigate(sql`'/roles/' || auth_role.id`);
        });
        b.custom("Edit", { icon: "EditOutlined" }, (s) => {
          s.navigate(sql`'/roles/' || auth_role.id || '/edit'`);
        });
      }}
    />
  );
}

function RoleDetailPage(
  props: { wrapper?: (children: Node) => Node },
) {
  return (
    <RecordPage
      table="auth_roles"
      path="/roles/{record_id:id}"
      wrapper={props.wrapper}
    >
      <Data
        pendingFallback={null}
        procedure={(s) => {
          s.defRecord(
            "role_detail",
            sql`select
              (select name from db.auth_roles where id = record.extends) as extends_name,
              (select count(distinct sys_user_id) from (
                select sys_user_id, auth_role_id from db.auth_user_roles
                union all
                select sys_user_id, auth_role_id from db.auth_user_role_sources
              ) membership where membership.auth_role_id = ui.record_id) as user_count,
              format.date(record.created_at, '%Y-%m-%d') as created_at_fmt`,
          );
          s.defScalar(
            "last_modified_fmt",
            sql`format.date(record.last_modified_at, '%Y-%m-%d')`,
          );
        }}
      >
        <div className="grid grid-cols-12 w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:px-12 xl:max-w-7xl py-4 gap-3">
          <PageHeader>
            <IconButton
              icon="ArrowBack"
              variant="plain"
              color="neutral"
              href="/roles"
              backLink
              aria-label="Back"
            />
            <Typography
              level="h3"
              startIcon="ShieldOutlined"
              slotProps={{ startDecorator: { sx: { color: "primary-500" } } }}
            >
              {sql`record.name`}
            </Typography>
            <PageHeader.Grow />
            <Button
              variant="solid"
              color="primary"
              startIcon="Edit"
              href={sql`'/roles/' || record.id || '/edit'`}
            >
              Edit Role
            </Button>
          </PageHeader>

          <div
            sx={{
              gridColumnSpan: { xs: 12, lg: 8 },
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <Card variant="outlined" size="lg">
              <CardHeader noDivider>
                <Typography level="title-lg">Role Information</Typography>
              </CardHeader>
              <div className="py-4 flex flex-col gap-8">
                <div>
                  <Typography level="body-sm">Role Name</Typography>
                  <Typography level="body-lg">
                    {sql`record.name`}
                  </Typography>
                </div>
                <div>
                  <Typography level="body-sm">Description</Typography>
                  <Typography level="body-lg">
                    {sql`record.description`}
                  </Typography>
                </div>
                <div>
                  <Typography level="body-sm">Inherits From</Typography>
                  <Show when={sql`record.extends is not null`}>
                    <Chip color="neutral" variant="soft">
                      {sql`role_detail.extends_name`}
                    </Chip>
                  </Show>
                </div>
              </div>
            </Card>
            <PermissionsCard sx={{ gridColumnSpan: 12 }} />
          </div>

          <Card
            variant="outlined"
            size="lg"
            sx={{ gridColumnSpan: { xs: 12, lg: 4 }, alignSelf: "flex-start" }}
          >
            <CardHeader noDivider>
              <Typography level="title-lg">Role Details</Typography>
            </CardHeader>
            <div className="py-2 flex flex-col gap-6">
              <div>
                <Typography level="body-sm">Users with this role</Typography>
                <Typography level="body-lg" startIcon="GroupOutlined">
                  {sql`role_detail.user_count`} users
                </Typography>
              </div>
              <div>
                <Typography level="body-sm">Created At</Typography>
                <Typography level="body-lg" startIcon="ScheduleOutlined">
                  {sql`role_detail.created_at_fmt`}
                </Typography>
              </div>
              <div>
                <Typography level="body-sm">Last Modified</Typography>
                <Typography level="body-lg" startIcon="ScheduleOutlined">
                  {sql`last_modified_fmt`}
                </Typography>
              </div>
            </div>
          </Card>
        </div>
      </Data>
    </RecordPage>
  );
}

function RoleForm(props: { isNew?: boolean }) {
  return (
    <div sx={[containerStyles(), baseGridStyles, { gap: 6 }]}>
      <PageHeader>
        <div>
          <Typography level="h3">
            {props.isNew ? "Create New Role" : "Edit Role"}
          </Typography>
          <Typography level="body-sm">
            {props.isNew
              ? "Define a new role and its permissions"
              : "Edit an existing role and its permissions"}
          </Typography>
        </div>
        <PageHeader.Grow />
        <PageHeader.Actions>
          <Button
            variant="outlined"
            color="neutral"
            startIcon="Close"
            href={props.isNew
              ? "/roles"
              : sql.concat("/roles/", sql`ui.record_id`)}
          >
            Cancel
          </Button>
          <Form.SubmitButton startIcon="Save">
            {props.isNew ? "Create Role" : "Save Role"}
          </Form.SubmitButton>
        </PageHeader.Actions>
      </PageHeader>

      <Form.ErrorAlert sx={{ gridColumnSpan: 12 }} />

      <Card variant="outlined" sx={{ gridColumnSpan: { xs: 12, lg: 4 } }}>
        <CardHeader>
          <Typography level="title-lg">Role Information</Typography>
        </CardHeader>
        <div className="p-6 flex flex-col gap-6">
          <Form.Field field="name">
            <LabelOnTopFormField label="Role Name" />
          </Form.Field>
          <Form.Field field="description">
            <LabelOnTopFormField label="Description" />
          </Form.Field>
          <Form.Field field="extends">
            <LabelOnTopFormField label="Inherit From" />
          </Form.Field>
        </div>
      </Card>
      <PermissionsFormCard
        isNew={props.isNew}
        sx={{ gridColumnSpan: { xs: 12, lg: 8 } }}
      />
    </div>
  );
}

function PermissionsFormCard(props: { isNew?: boolean; sx?: Style }) {
  return (
    <Card variant="outlined" sx={props.sx}>
      <CardHeader>
        <Typography level="title-lg">Permissions</Typography>
      </CardHeader>
      <div className="flex flex-col gap-3 py-4">
        <Form.Relation
          table="auth_role_permissions"
          fields={["permission", "is_allowed"]}
          dontInitialize={props.isNew}
        >
          <PermissionFormEntries />
        </Form.Relation>
        <Data
          watch={[sql`write_auth_role.extends`]}
          procedure={(s) => {
            s.defTable(
              "inherited_role_permissions",
              getRolePermissions(sql`write_auth_role.extends`),
            );
            s.defScalar(
              "inherited_role_name",
              sql`(select name from db.auth_roles where id = write_auth_role.extends)`,
            );
          }}
        >
          <Each
            table="inherited_role_permissions"
            recordName="inherited_permission"
          >
            <PermissionEntry permission={sql`inherited_permission.permission`}>
              <Typography level="body-sm" className="text-secondary">
                Inherited from {sql`inherited_role_name`}
              </Typography>
            </PermissionEntry>
          </Each>
        </Data>
      </div>
    </Card>
  );
}

function PermissionsCard({ sx }: { sx?: Style }) {
  return (
    <PermissionListCard
      title="Permissions"
      permissionsQuery={getRolePermissions(sql`ui.record_id`)}
      emptyMessage="This role grants no permissions."
      sx={sx}
    />
  );
}
