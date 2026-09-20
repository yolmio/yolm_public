import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { EachSelect } from "components/each_select";
import { EnumSelect } from "components/enum_select";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import type { Node } from "std/ui";
import { Each, Route, Show, useSharedContext } from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";
import { AuthBlock, currentUserHasPermission } from "blocks/auth";
import type { UiServerStatements } from "std/statements";
import { SidebarItemsSharedContext } from "std/shared_contexts";
import { AttachmentsCard } from "table_blocks/attachments/attachments_card";
import { CrmBlock } from "../index";

const editKnowledgeHubPermission = "edit_knowledge_hub";

function requireKnowledgeHubEditPermission(s: UiServerStatements) {
  s.throwErrorIf(
    sql`${
      currentUserHasPermission(sql.lit(editKnowledgeHubPermission))
    } is not true`,
    sql.lit`You do not have permission to edit the Knowledge Hub.`,
  );
}

interface KnowledgeHubPageProps {
  path?: string;
  organizationId?: NumericExpr;
  pipelineItemId?: NumericExpr;
  toolbarRight?: Node;
}

/**
 * Datagrid-based knowledge-hub listing page. Filterable by
 * organization and/or pipeline item. Requires {@link CrmBlock} to be
 * configured with `knowledgeHub: true`.
 */
export function KnowledgeHubPage(props: KnowledgeHubPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasKnowledgeHubEnabled()) {
    return null;
  }

  const knowledgeHubTable = block.knowledgeHubTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.knowledgeHubListPath;

  useSharedContext(SidebarItemsSharedContext).add({
    section: "Customer Success",
    icon: "TrendingUp",
    requiredPermission: "view_success_plans",
    order: 30,
    items: [
      {
        label: "Knowledge Hub",
        href: path,
        icon: "MenuBook",
        requiredPermission: "view_knowledge_hub",
      },
    ],
  });

  return (
    <Route path={path}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <MaterialIcon
              icon="MenuBook"
              className="text-2xl text-primary-500"
            />
            <Typography level="h3">Knowledge Hub</Typography>
          </div>
          <div className="flex items-center gap-2">
            {props.toolbarRight ? props.toolbarRight : null}
            <AuthBlock.PermissionCheck
              permission={editKnowledgeHubPermission}
            >
              <Button
                variant="soft"
                color="primary"
                startIcon="Add"
                href={block.routes.knowledgeHubNewPath}
              >
                Add Item
              </Button>
            </AuthBlock.PermissionCheck>
          </div>
        </div>

        <Data
          local
          procedure={(s) => {
            s.defScalar("filter_type", {
              type: { type: "Enum", enum: "crm_knowledge_item_type" },
            });
            s.defScalar("search_query", sql.lit``);
          }}
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1">
              <Input
                value={sql`search_query`}
                onInput={(s) => s.setScalar("search_query", sql`target_value`)}
                placeholder="Search knowledge items..."
                startDecorator={<MaterialIcon icon="Search" />}
              />
            </div>
            <EnumSelect
              enum="crm_knowledge_item_type"
              value={sql`filter_type`}
              onChange={(s) => s.setScalar("filter_type", sql`target_value`)}
              filterVariants={(name) =>
                block.knowledgeHubItemTypes.some((t) => t.name === name)}
              nullVariant="All Types"
              className="w-48"
            />
          </div>

          <Data
            procedure={(s) => {
              const orgIdFilter = props.organizationId
                ? sql`and kh.organization_id = ${props.organizationId}`
                : sql``;
              const pipelineItemFilter = props.pipelineItemId
                ? sql`and kh.pipeline_item_id = ${props.pipelineItemId}`
                : sql``;

              s.defTable(
                "items",
                sql`
                  select
                    kh.*,
                    o.name as organization_name,
                    u.display_name_virtual as created_by_name
                  from db.${sql.ref(knowledgeHubTable)} kh
                  left join db.${
                  sql.ref(orgsTable)
                } o on o.id = kh.organization_id
                  left join db.sys_users u on u.id = kh.created_by
                  where (
                    ui.filter_type is null
                    or kh.item_type = ui.filter_type
                  )
                    and (ui.search_query = '' or kh.title ilike '%' || ui.search_query || '%' or kh.content ilike '%' || ui.search_query || '%')
                    ${orgIdFilter}
                    ${pipelineItemFilter}
                  order by kh.created_at desc
                `,
              );
            }}
            watch={[sql`filter_type`, sql`search_query`]}
          >
            <div className="grid gap-4">
              <Each table="items" recordName="item">
                <Card
                  variant="outlined"
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={(s) =>
                    s.navigate(block.knowledgeHubItemHref(sql`item.id`))}
                >
                  <div className="flex items-start gap-4">
                    <KnowledgeItemIcon itemType={sql`item.item_type`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Typography level="title-md">
                          {sql`item.title`}
                        </Typography>
                        <KnowledgeItemTypeChip itemType={sql`item.item_type`} />
                      </div>
                      <Show when={sql`item.organization_name is not null`}>
                        <Typography
                          level="body-sm"
                          className="text-tertiary mb-1"
                        >
                          <MaterialIcon
                            icon="Business"
                            className="text-sm mr-1"
                          />
                          {sql`item.organization_name`}
                        </Typography>
                      </Show>
                      <Show
                        when={sql`item.content is not null and item.content != ''`}
                      >
                        <Typography
                          level="body-sm"
                          className="text-secondary line-clamp-2"
                        >
                          {sql`substring(item.content, 1, 200)`}
                        </Typography>
                      </Show>
                      <div className="flex items-center gap-4 mt-2 text-xs text-tertiary">
                        <span>
                          <MaterialIcon
                            icon="Person"
                            className="text-xs mr-1"
                          />
                          {sql`coalesce(item.created_by_name, 'Unknown')`}
                        </span>
                        <span>
                          <MaterialIcon
                            icon="Schedule"
                            className="text-xs mr-1"
                          />
                          {sql`format.date(item.created_at, '%b %d, %Y')`}
                        </span>
                      </div>
                    </div>
                    <IconButton
                      variant="plain"
                      color="neutral"
                      onClick={(s) => {
                        s.event.stopPropagation();
                        s.navigate(block.knowledgeHubItemHref(sql`item.id`));
                      }}
                    >
                      <MaterialIcon icon="ChevronRight" />
                    </IconButton>
                  </div>
                </Card>
              </Each>
            </div>
          </Data>
        </Data>
      </div>
    </Route>
  );
}

interface KnowledgeItemDetailPageProps {
  path?: string;
}

/**
 * Detail page for a single knowledge-hub item: title, body, related
 * organization / contacts, and attachments.
 */
export function KnowledgeItemDetailPage(props: KnowledgeItemDetailPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasKnowledgeHubEnabled()) {
    return null;
  }

  const knowledgeHubTable = block.knowledgeHubTableName;
  const path = props.path ?? block.routes.knowledgeHubDetailPath;

  return (
    <RecordPage table={knowledgeHubTable} path={path}>
      <div className="container mx-auto p-6 max-w-4xl">
        <KnowledgeItemDetailContent block={block} />
      </div>
    </RecordPage>
  );
}

function KnowledgeItemDetailContent(props: { block: CrmBlock }) {
  const { block } = props;
  const knowledgeHubTable = block.knowledgeHubTableName;
  const orgsTable = block.organizationsTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
        s.defScalar("edit_mode", false);
        s.defScalar(
          "can_edit_knowledge_hub",
          currentUserHasPermission(sql.lit(editKnowledgeHubPermission)),
        );
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "item",
            sql`
        select
          kh.*,
          o.name as organization_name,
          u.display_name_virtual as created_by_name
        from db.${sql.ref(knowledgeHubTable)} kh
        left join db.${sql.ref(orgsTable)} o on o.id = kh.organization_id
        left join db.sys_users u on u.id = kh.created_by
        where kh.id = ui.record_id
      `,
          );
        }}
        watch={[sql`refresh_key`]}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: sql.caseWhen({
                  conditions: block.knowledgeHubItemTypes.map((t) => ({
                    condition: sql`item.item_type = ${sql.lit(t.name)}`,
                    expr: sql.lit`${(t.color ?? "#6B7280")}20`,
                  })),
                  default: sql.lit`#6B728020`,
                }),
              }}
            >
              <MaterialIcon
                icon="Description"
                style={{
                  color: sql.caseWhen({
                    conditions: block.knowledgeHubItemTypes.map((t) => ({
                      condition: sql`item.item_type = ${sql.lit(t.name)}`,
                      expr: sql.lit`${t.color ?? "#6B7280"}`,
                    })),
                    default: sql.lit`#6B7280`,
                  }),
                }}
                className="text-2xl"
              />
            </div>
            <div>
              <Typography level="h3">{sql`item.title`}</Typography>
              <div className="flex items-center gap-2">
                <KnowledgeItemTypeChip itemType={sql`item.item_type`} />
                <Show when={sql`item.organization_name is not null`}>
                  <Typography level="body-sm" className="text-tertiary">
                    {sql`item.organization_name`}
                  </Typography>
                </Show>
              </div>
            </div>
          </div>
          <Show when={sql`can_edit_knowledge_hub`}>
            <div className="flex items-center gap-2">
              <Button
                variant="outlined"
                color="neutral"
                startIcon="Edit"
                onClick={(s) => {
                  s.setScalar("edit_mode", sql`not edit_mode`);
                }}
              >
                {sql`case when edit_mode then 'Cancel' else 'Edit' end`}
              </Button>
              <Button
                variant="outlined"
                color="danger"
                startIcon="Delete"
                onClick={(s) => {
                  s.tryServer({
                    body: (s) => {
                      requireKnowledgeHubEditPermission(s);
                      s.startTransaction();
                      s.modify(
                        sql`delete from db.${
                          sql.ref(knowledgeHubTable)
                        } where id = ui.record_id`,
                      );
                      s.commitTransaction();
                    },
                  });
                  s.navigate(sql.lit(block.routes.knowledgeHubListPath));
                }}
              >
                Delete
              </Button>
            </div>
          </Show>
        </div>

        <Card variant="soft" className="p-4 mb-6">
          <div className="flex items-center gap-6 text-sm text-tertiary">
            <span>
              <MaterialIcon icon="Person" className="text-sm mr-1" />
              Created by {sql`coalesce(item.created_by_name, 'Unknown')`}
            </span>
            <span>
              <MaterialIcon icon="Schedule" className="text-sm mr-1" />
              {sql`format.date(item.created_at, '%b %d, %Y at %H:%M')`}
            </span>
            <Show when={sql`item.last_modified_at > item.created_at`}>
              <span>
                <MaterialIcon icon="Update" className="text-sm mr-1" />
                Updated {sql`format.date(item.last_modified_at, '%b %d, %Y')`}
              </span>
            </Show>
          </div>
        </Card>

        <Show when={sql`edit_mode`}>
          <Card variant="outlined" className="p-6">
            <Form
              defaultFieldComponent={LabelOnTopFormField}
              beforeTransactionStart={requireKnowledgeHubEditPermission}
              afterTransactionCommit={(s) => {
                s.increment("refresh_key");
              }}
              afterSubmitClientSuccess={(s) => {
                s.setScalar("edit_mode", false);
              }}
            >
              <Form.Update
                table={knowledgeHubTable}
                where={sql`id = ui.record_id`}
                setFields={{ last_modified_at: sql`now()` }}
              >
                <div className="space-y-4">
                  <Form.Field field="title" />
                  <Form.Field field="item_type" />
                  <Form.Field field="content" />
                  <Form.ErrorAlert className="mt-3" mode="all" />
                  <div className="flex justify-end gap-2 pt-4">
                    <Form.SubmitButton>Save</Form.SubmitButton>
                  </div>
                </div>
              </Form.Update>
            </Form>
          </Card>
        </Show>

        <Show when={sql`not edit_mode`}>
          <Card variant="outlined" className="p-6">
            <Show
              when={sql`item.content is not null and item.content != ''`}
              fallback={
                <Typography level="body-md" className="text-tertiary italic">
                  No content added yet
                </Typography>
              }
            >
              <Typography level="body-md" className="whitespace-pre-wrap">
                {sql`item.content`}
              </Typography>
            </Show>
          </Card>

          <AttachmentsCard
            className="mt-4"
            editPermission={editKnowledgeHubPermission}
          />
        </Show>
      </Data>
    </Data>
  );
}

function KnowledgeItemIcon(props: { itemType: Sql }) {
  const block = system.block(CrmBlock);
  const itemTypes = block.knowledgeHubItemTypes;

  return (
    <div
      className="p-2 rounded-lg"
      style={{
        backgroundColor: sql.caseWhen({
          conditions: itemTypes.map((t) => ({
            condition: sql`${props.itemType} = ${sql.lit(t.name)}`,
            expr: sql.lit`${(t.color ?? "#6B7280")}20`,
          })),
          default: sql.lit`#6B728020`,
        }),
      }}
    >
      {itemTypes.map((t) => (
        <Show when={sql`${props.itemType} = ${sql.lit(t.name)}`}>
          <MaterialIcon
            icon={t.icon ?? "Article"}
            style={{ color: t.color ?? "#6B7280" }}
            className="text-xl"
          />
        </Show>
      ))}
      <Show
        when={sql.and(
          ...itemTypes.map((t) => sql`${props.itemType} != ${sql.lit(t.name)}`),
        )}
      >
        <MaterialIcon
          icon="Article"
          style={{ color: "#6B7280" }}
          className="text-xl"
        />
      </Show>
    </div>
  );
}

function KnowledgeItemTypeChip(props: { itemType: Sql }) {
  const block = system.block(CrmBlock);
  const itemTypes = block.knowledgeHubItemTypes;

  return (
    <Chip
      size="sm"
      variant="soft"
      style={{
        backgroundColor: sql.caseWhen({
          conditions: itemTypes.map((t) => ({
            condition: sql`${props.itemType} = ${sql.lit(t.name)}`,
            expr: sql.lit`${(t.color ?? "#6B7280")}30`,
          })),
          default: sql.lit`#6B728030`,
        }),
        color: sql.caseWhen({
          conditions: itemTypes.map((t) => ({
            condition: sql`${props.itemType} = ${sql.lit(t.name)}`,
            expr: sql.lit`${t.color ?? "#6B7280"}`,
          })),
          default: sql.lit`#6B7280`,
        }),
      }}
    >
      {sql`string.capitalize(replace(${props.itemType}, '_', ' '))`}
    </Chip>
  );
}

interface KnowledgeItemFormProps {
  path?: string;
}

/**
 * Create-knowledge-item page. Renders the knowledge-hub form pre-bound
 * to the `knowledge_items` table.
 */
export function KnowledgeItemNewPage(props: KnowledgeItemFormProps) {
  const block = system.block(CrmBlock);

  if (!block.hasKnowledgeHubEnabled()) {
    return null;
  }

  const knowledgeHubTable = block.knowledgeHubTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.knowledgeHubNewPath;

  return (
    <Route path={path}>
      <AuthBlock.PermissionCheck
        permission={editKnowledgeHubPermission}
        fallback={
          <div className="container mx-auto p-6 max-w-2xl">
            <Card variant="soft" className="p-6">
              <Typography level="body-md">
                You do not have permission to add Knowledge Hub items.
              </Typography>
            </Card>
          </div>
        }
      >
        <div className="container mx-auto p-6 max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <MaterialIcon icon="Add" className="text-3xl text-primary-500" />
            <Typography level="h3">Add Knowledge Item</Typography>
          </div>

          <Card variant="outlined" className="p-6">
            <Form
              defaultFieldComponent={LabelOnTopFormField}
              beforeTransactionStart={requireKnowledgeHubEditPermission}
              beforeTransactionCommit={(s) => {
                s.defScalar(
                  "new_id",
                  sql`last_record_id(${sql.ref(knowledgeHubTable)})`,
                );
              }}
              afterTransactionCommit={(s) => {
                s.navigate(block.knowledgeHubItemHref(sql`new_id`));
              }}
            >
              <Form.Insert
                table={knowledgeHubTable}
                values={{ created_by: sql`current_user` }}
              >
                <div className="space-y-4">
                  <Form.Field field="title" />
                  <Form.Field
                    field="item_type"
                    initialValue={sql.lit(block.knowledgeHubItemTypes[0].name)}
                  />
                  <Form.Field field="organization_id">
                    {(helper) => (
                      <Data
                        procedure={(s) => {
                          s.defTable(
                            "orgs",
                            sql`select id, name from db.${
                              sql.ref(orgsTable)
                            } order by name`,
                          );
                        }}
                      >
                        <EachSelect
                          table="orgs"
                          value={helper.value}
                          onChange={(s, recordId) =>
                            helper.setValue(s, recordId)}
                          placeholder="Select organization..."
                          size="md"
                          className="bg-neutral-100 "
                          optionLabel="name"
                          optionValue="id"
                        />
                      </Data>
                    )}
                  </Form.Field>
                  <Form.Field field="content" />
                  <Form.ErrorAlert className="mt-3" mode="all" />
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      variant="outlined"
                      color="neutral"
                      href={block.routes.knowledgeHubListPath}
                    >
                      Cancel
                    </Button>
                    <Form.SubmitButton
                      variant="solid"
                      color="primary"
                    >
                      Create Item
                    </Form.SubmitButton>
                  </div>
                </div>
              </Form.Insert>
            </Form>
          </Card>
        </div>
      </AuthBlock.PermissionCheck>
    </Route>
  );
}

// ==================== Organization Tab ====================

interface KnowledgeHubOrganizationTabProps {
  editPermission?: string;
  newItemHref?: string;
}

/**
 * Tab content rendered inside an organization detail page that lists
 * knowledge-hub items linked to that organization.
 */
export function KnowledgeHubOrganizationTab(
  props: KnowledgeHubOrganizationTabProps,
) {
  const block = system.block(CrmBlock);

  if (!block.hasKnowledgeHubEnabled()) {
    return null;
  }

  const knowledgeHubTable = block.knowledgeHubTableName;
  const editPermission = props.editPermission ?? "edit_knowledge_hub";
  const newItemHref = props.newItemHref ?? block.routes.knowledgeHubNewPath;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "can_edit_knowledge_hub",
          currentUserHasPermission(sql.lit(editPermission)),
        );
      }}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <Typography level="title-lg">Knowledge Hub</Typography>
          <Show when={sql`can_edit_knowledge_hub`}>
            <Button
              variant="soft"
              color="primary"
              startIcon="Add"
              href={newItemHref}
            >
              Add Item
            </Button>
          </Show>
        </div>

        <Data
          procedure={(s) => {
            s.defTable(
              "items",
              sql`
              select
                kh.*,
                u.display_name_virtual as created_by_name
              from db.${sql.ref(knowledgeHubTable)} kh
              left join db.sys_users u on u.id = kh.created_by
              where kh.organization_id = record_id
              order by kh.created_at desc
            `,
            );
          }}
        >
          <Show
            when={sql`(select count(*) from items) > 0`}
            fallback={
              <Card variant="soft" className="p-6 text-center">
                <MaterialIcon
                  icon="MenuBook"
                  className="text-4xl text-neutral-300 mb-2"
                />
                <Typography level="body-md" className="text-tertiary">
                  No knowledge items for this account yet
                </Typography>
              </Card>
            }
          >
            <div className="space-y-3">
              <Each table="items" recordName="item">
                <Card
                  variant="outlined"
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={(s) =>
                    s.navigate(block.knowledgeHubItemHref(sql`item.id`))}
                >
                  <div className="flex items-start gap-3">
                    <KnowledgeItemIcon itemType={sql`item.item_type`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Typography level="title-md">
                          {sql`item.title`}
                        </Typography>
                        <KnowledgeItemTypeChip itemType={sql`item.item_type`} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-tertiary">
                        <span>
                          <MaterialIcon
                            icon="Person"
                            className="text-xs mr-1"
                          />
                          {sql`coalesce(item.created_by_name, 'Unknown')`}
                        </span>
                        <span>
                          <MaterialIcon
                            icon="Schedule"
                            className="text-xs mr-1"
                          />
                          {sql`format.date(item.created_at, '%b %d, %Y')`}
                        </span>
                      </div>
                    </div>
                    <MaterialIcon
                      icon="ChevronRight"
                      className="text-neutral-400"
                    />
                  </div>
                </Card>
              </Each>
            </div>
          </Show>
        </Data>
      </div>
    </Data>
  );
}
