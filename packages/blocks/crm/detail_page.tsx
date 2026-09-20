import { AllEmailsList } from "blocks/email_integrations/common";
import { CommentRecordRail, CommentsPanel } from "blocks/comments";
import { AutoInsertButton } from "components/auto_insert_dialog";

import { Card } from "components/card";
import { Chip } from "components/chip";
import {
  DeleteRecordButton,
  DeleteRecordIconButton,
} from "components/delete_record_dialog";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { PageHeader } from "components/page_header";
import { Typography } from "components/typography";
import type { FieldGroup } from "field_groups/crm_field_group";
import {
  RecordWithTabsAndDetailContent,
} from "pages/record_with_tabs_and_detail";
import { RecordPage } from "pages/record_page";
import { CurrentTableICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import type { StateStatements } from "std/statements";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { system } from "std/system";
import type { Field, Table } from "std/system";
import { Each, Show, useICtx } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { AddressTableBlock } from "table_blocks/address";
import { AddressText } from "table_blocks/address/address_text";
import { CrmBlock } from "./index";
import { Form } from "std/form";
import type { WriteProcExtensions } from "std/form";

interface DetailsWithCommentsProps {
  block: CrmBlock;
  tableName: string;
  detailsTitle: string;
  details: Node;
}

function DetailsWithComments(props: DetailsWithCommentsProps) {
  return (
    <CommentRecordRail
      detailsTitle={props.detailsTitle}
      details={<div className="p-3">{props.details}</div>}
      comments={
        <CommentsPanel
          foreignKey={`${singularize(props.tableName)}_id`}
          recordId={sql`record_id`}
          compact
        />
      }
    />
  );
}

function DetailTabLabel(props: { icon?: IconName; label: Node }) {
  return (
    <span className="inline-flex items-center gap-2">
      {props.icon && (
        <MaterialIcon icon={props.icon} className="text-[17px] text-icon" />
      )}
      <span>{props.label}</span>
    </span>
  );
}

function DetailFieldWrapper(props: {
  startIcon?: IconName;
  startDecorator?: Node;
  label: Node;
  children: Node;
}) {
  return (
    <div
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(92px, 38%) minmax(0, 1fr)",
        alignItems: "start",
        minHeight: "26px",
        columnGap: "10px",
      }}
      className="py-0.5"
    >
      <Typography
        startDecorator={props.startDecorator}
        startIcon={props.startIcon}
        level="body-sm"
        className="text-secondary"
      >
        {props.label}
      </Typography>
      <div className="min-w-0 break-words" sx={{ overflowWrap: "anywhere" }}>
        {props.children}
      </div>
    </div>
  );
}

export function DetailFieldDisplayOnly(props: {
  startIcon?: IconName;
  startDecorator?: Node;
  label: Node;
  children: Node;
}) {
  return (
    <DetailFieldWrapper
      startIcon={props.startIcon}
      startDecorator={props.startDecorator}
      label={props.label}
    >
      {props.children}
    </DetailFieldWrapper>
  );
}

/**
 * Inline editable detail field for the current CRM record. Resolves the
 * field from the surrounding `CurrentTable` ICtx and renders the right
 * editor based on the field type.
 */
export function EditSimpleField(
  props: { field: string; icon?: IconName; label?: Node },
) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const field = currentTable.fields[props.field];
  if (!field) {
    throw new Error(`Field ${props.field} not found`);
  }
  const isLinkField = field.type === "String" &&
    (field.usage?.type === "Email" || field.usage?.type === "URL");
  return (
    <DetailFieldWrapper
      label={props.label ?? field.displayName}
      startIcon={props.icon}
    >
      <Form.InlineEdit
        field={props.field}
        sx={{
          px: 1,
          py: 0.5,
          borderRadius: "md",
          cursor: isLinkField ? "default" : "pointer",
          position: "relative",
          minWidth: 0,
          maxWidth: "100%",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          "& a": {
            display: "block",
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          },
          "&:hover": {
            backgroundColor: "background-level1",
          },
          "&:focus-within": {
            outline: "1px solid",
            outlineColor: "primary-500",
          },
          fontSize: "sm",
          minHeight: "22px",
        }}
        editTrigger={isLinkField ? "icon" : undefined}
      />
    </DetailFieldWrapper>
  );
}

function EditableStatusChip(
  props: {
    field: string;
    table: Table;
    writeHooks?: Pick<
      WriteProcExtensions,
      "afterTransactionStart" | "beforeTransactionCommit"
    >;
  },
) {
  const field = props.table.fields[props.field];
  if (!field) {
    throw new Error(`Field ${props.field} not found`);
  }
  if (field.type !== "Enum") {
    throw new Error(`Field ${props.field} is not an enum`);
  }
  const enum_ = system.enums[field.enum];
  if (!enum_) {
    throw new Error(`Enum ${field.enum} not found`);
  }
  return (
    <Form.InlineEdit
      field={props.field}
      {...props.writeHooks}
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: "999px",
        minHeight: "28px",
        fontSize: "sm",
        fontWeight: 600,
        cursor: "pointer",
        backgroundColor: "background-level1",
        "&:hover": {
          backgroundColor: "background-level2",
        },
        "&:focus-within": {
          outline: "1px solid",
          outlineColor: "primary-500",
        },
      }}
    />
  );
}

function PeopleTab() {
  const block = system.block(CrmBlock);
  const table = system.db.tables[block.peopleTableName];
  const fkColumn = `${singularize(block.organizationsTableName)}_id`;
  const hasPhone = !!table.fields.phone;
  return (
    <div>
      <Data
        procedure={(s) => {
          s.defTable(
            "people",
            sql`select * from db.${sql.ref(table.name)} where ${
              sql.ref(fkColumn)
            } = record_id`,
          );
          s.defScalar(
            "people_count",
            sql`(select count(*) from people)`,
          );
        }}
      >
        <div className="flex justify-between items-center mb-4">
          <Typography level="title-lg">{table.displayName}</Typography>
          <AutoInsertButton
            table={table.name}
            parentRecordId={sql`ui.record_id`}
            parentField={fkColumn}
            variant="solid"
            color="neutral"
            startIcon="Add"
            size="sm"
          >
            Add {singularize(table.displayName)}
          </AutoInsertButton>
        </div>
        <Show
          when={sql`people_count > 0`}
          fallback={
            <div className="py-8 text-center">
              <MaterialIcon
                icon="PersonOff"
                className="text-tertiary text-4xl"
              />
              <Typography level="body-md" className="text-tertiary mt-2">
                No {table.displayName.toLowerCase()} yet
              </Typography>
            </div>
          }
        >
          <div className="flex flex-col gap-2">
            <Each table="people" recordName="person">
              <Card variant="outlined" className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary-soft">
                    <MaterialIcon
                      icon="Person"
                      className="text-primary-soft text-lg"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={block.personHref(sql`person.id`)}
                        className="font-medium text-sm"
                      >
                        {table.getRecordDisplayNameExpr(sql`person`)}
                      </Link>
                      <Chip
                        variant="soft"
                        color="neutral"
                        size="sm"
                      >
                        {sql`coalesce(person.title, 'No Title')`}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <Show when={sql`person.email is not null`}>
                        <Link
                          href={sql.concat("mailto:", sql`person.email`)}
                          className="text-xs text-secondary flex items-center gap-1"
                        >
                          <MaterialIcon icon="Email" fontSize="sm" />
                          {sql`person.email`}
                        </Link>
                      </Show>
                      {hasPhone && (
                        <Show when={sql`person.phone is not null`}>
                          <Link
                            href={sql.concat("tel:", sql`person.phone`)}
                            className="text-xs text-secondary flex items-center gap-1"
                          >
                            <MaterialIcon icon="Phone" fontSize="sm" />
                            {sql`person.phone`}
                          </Link>
                        </Show>
                      )}
                    </div>
                  </div>
                  <DeleteRecordIconButton
                    table={table.name}
                    recordId={sql`person.id`}
                    icon="Delete"
                    variant="plain"
                    color="danger"
                    size="sm"
                    aria-label={`Delete ${singularize(table.displayName)}`}
                  />
                </div>
              </Card>
            </Each>
          </div>
        </Show>
      </Data>
    </div>
  );
}

export interface OrganizationDetailContentProps {
  /** Hide the generated people tab when supplying one through custom tabs. */
  hidePeopleTab?: boolean;
  appendTabs?: {
    value?: string;
    header: {
      icon: IconName;
      label: string;
    };
    content: Node;
  }[];
  prependTabs?: {
    value?: string;
    header: {
      icon: IconName;
      label: string;
    };
    content: Node;
  }[];
  leftSideHeader?: Node;
  rightSideHeader?: Node;
  /** Hooks for the generated organization-status inline editor. */
  statusWriteHooks?: Pick<
    WriteProcExtensions,
    "afterTransactionStart" | "beforeTransactionCommit"
  >;
  /**
   * Replace the auto-generated details panel content with custom JSX. Use
   * `CrmBlock.DetailField` / `CrmBlock.DetailDisplayField` to compose your
   * own rows. The surrounding "Details" title and comment-section wrapper
   * are preserved.
   */
  details?: Node;
  /**
   * Replace specific auto-generated detail rows while preserving the rest of
   * the generated details panel.
   */
  detailFieldOverrides?: Record<string, Node>;
  /**
   * Field names to omit from the auto-generated details panel. Ignored when
   * `details` is provided.
   */
  excludeFields?: string[];
  /**
   * Pass-through to the auto-generated Emails tab. Use to wire per-row
   * actions and the modals/scalars they share.
   */
  emailsTab?: {
    enableCompose?: boolean;
    composeTo?: Sql;
    extraStatements?: (s: StateStatements) => void;
    extraActions?: Node;
    extraDialogs?: Node;
  };
  hideComments?: boolean;
  hideDetailsHeader?: boolean;
  hideDefaultEmails?: boolean;
}

export interface OrganizationDetailPageProps
  extends OrganizationDetailContentProps {
  path?: string;
}

// Helper to render field group fields in details
function renderFieldGroupDetails(
  table: Table,
  fieldGroup: FieldGroup,
  prefix?: string,
): Node | null {
  const groupName = `${prefix || ""}${fieldGroup.name}`;

  // If the field group has custom details content, use it
  if (fieldGroup.getDetailsContent) {
    return fieldGroup.getDetailsContent();
  }

  // Collect fields from the group
  const fields: Node[] = [];
  for (const field of Object.values(table.fields)) {
    if (field.group === groupName) {
      let icon = fieldGroup.icon || "Info";
      // Override icon based on field name patterns
      if (field.name.includes("email")) icon = "Email";
      else if (field.name.includes("url") || field.name.includes("website")) {
        icon = "Web";
      } else if (field.name.includes("phone")) icon = "Phone";

      fields.push(
        <EditSimpleField field={field.name} icon={icon as IconName} />,
      );
    }
  }

  // Only render if there are fields
  if (fields.length === 0) {
    return null;
  }

  const displayName = fieldGroup.getDisplayName();

  // Return a grouped section with heading
  return (
    <div className="mt-4">
      <Typography level="title-sm" className="mb-2">
        {displayName}
      </Typography>
      <div className="flex flex-col gap-1">
        {fields}
      </div>
    </div>
  );
}

// Helper to create field group tabs
function createFieldGroupTab(
  table: Table,
  fieldGroup: FieldGroup,
  prefix?: string,
): { value: string; header: Node; content: Node } | null {
  if (fieldGroup.displayLocation !== "tab") {
    return null;
  }

  // Use custom tab content if provided
  if (fieldGroup.getTabContent) {
    return {
      value: fieldGroup.name,
      header: (
        <DetailTabLabel
          icon={fieldGroup.icon || "Info"}
          label={fieldGroup.displayName}
        />
      ),
      content: fieldGroup.getTabContent(),
    };
  }

  // Otherwise, create a standard tab with fields
  const groupName = `${prefix || ""}${fieldGroup.name}`;
  const fields: Node[] = [];

  for (const field of Object.values(table.fields)) {
    if (field.group === groupName) {
      fields.push(
        <div>
          <EditSimpleField field={field.name} />
        </div>,
      );
    }
  }

  const displayName = fieldGroup.getDisplayName();

  return {
    value: fieldGroup.name,
    header: (
      <DetailTabLabel icon={fieldGroup.icon || "Info"} label={displayName} />
    ),
    content: (
      <div className="flex flex-col gap-2">
        <Typography level="title-lg">{displayName}</Typography>
        <div className="flex flex-col gap-1">
          {fields}
        </div>
      </div>
    ),
  };
}

/**
 * Detail page for an organization (B2B mode only). Auto-generates tabs
 * for the organization's people, pipelines, projects, and knowledge hub
 * based on what the {@link CrmBlock} was configured with.
 *
 * Currently runs in "auto" mode driven by the table/database; future
 * variants may accept explicit `tabs` and detail definitions.
 */
export function OrganizationDetailContent(
  props: OrganizationDetailContentProps,
) {
  const block = system.block(CrmBlock);

  // Only render this component if we're in B2B mode
  if (block.crmType !== "b2b") {
    return null;
  }

  const table = system.db.tables[block.organizationsTableName];
  const peopleTable = system.db.tables[block.peopleTableName];
  const details: Node[] = [];
  const addressGroups: string[] = [];
  const fieldGroupNames: string[] = [];

  // Collect field group names for exclusion
  for (const fieldGroup of block.organizationFieldGroups) {
    const groupName = `${
      block.opts.organizations?.fieldGroupPrefix || ""
    }${fieldGroup.name}`;
    fieldGroupNames.push(groupName);
  }

  for (const block of table.blocks(AddressTableBlock)) {
    addressGroups.push(block.opts.name ?? "address");
    details.push(
      <DetailFieldDisplayOnly label={block.displayName} startIcon="LocationOn">
        <AddressText
          size="sm"
          group={block.opts.name ?? "address"}
          placement="left-start"
        />
      </DetailFieldDisplayOnly>,
    );
  }

  const excludeFields = new Set(props.excludeFields ?? []);
  for (const field of Object.values(table.fields)) {
    if (table.recordDisplayName?.fields.includes(field.name)) {
      continue;
    }
    if (
      field.group &&
      (addressGroups.includes(field.group) ||
        fieldGroupNames.includes(field.group))
    ) {
      continue;
    }
    if (field.name === "source") {
      continue;
    }
    if (field.name === "created_at" || field.name === "last_modified_at") {
      continue;
    }
    if (excludeFields.has(field.name)) {
      continue;
    }
    const detailFieldOverride = props.detailFieldOverrides?.[field.name];
    if (detailFieldOverride !== undefined) {
      details.push(detailFieldOverride);
      continue;
    }
    let icon: IconName | undefined;
    if (field.name.includes("email")) {
      icon = "Email";
    } else if (field.name.includes("website") || field.name.includes("url")) {
      icon = "Web";
    } else if (field.name.includes("phone")) {
      icon = "Phone";
    } else if (field.name.includes("fax")) {
      icon = "Fax";
    } else if (field.name.includes("industry")) {
      icon = "CategoryOutlined";
    } else if (field.name.includes("legal_name")) {
      icon = "Business";
    } else {
      icon = "Info";
    }
    details.push(<EditSimpleField field={field.name} icon={icon} />);
  }
  // Add field group fields to details (only those marked for details)
  for (const fieldGroup of block.organizationFieldGroups) {
    if (fieldGroup.displayLocation === "details") {
      const fieldGroupDetails = renderFieldGroupDetails(
        table,
        fieldGroup,
        block.opts.organizations?.fieldGroupPrefix,
      );
      if (fieldGroupDetails) {
        details.push(fieldGroupDetails);
      }
    }
  }
  const tabs: {
    value?: string;
    header: Node;
    content: Node;
  }[] = [];

  if (props.prependTabs) {
    for (const prependTab of props.prependTabs) {
      tabs.push({
        value: prependTab.value,
        header: (
          <DetailTabLabel
            icon={prependTab.header.icon}
            label={prependTab.header.label}
          />
        ),
        content: prependTab.content,
      });
    }
  }

  if (!props.hidePeopleTab) {
    tabs.push({
      value: "contacts",
      header: <DetailTabLabel icon="Person" label={peopleTable.displayName} />,
      content: <PeopleTab />,
    });
  }

  for (const fieldGroup of block.organizationFieldGroups) {
    const tab = createFieldGroupTab(
      table,
      fieldGroup,
      block.opts.organizations?.fieldGroupPrefix,
    );
    if (tab) {
      tabs.push(tab);
    }
  }

  for (const block of table.allBlocks()) {
    const tab = block.getDetailTab(table);
    if (tab !== undefined) {
      tabs.push(tab);
    }
  }
  if (block.opts.emailIntegrations && !props.hideDefaultEmails) {
    const orgFkColumn = `${singularize(block.organizationsTableName)}_id`;
    const contactEmails = sql`(
      select email
      from ${sql(block.peopleTableName)}
      where ${sql.ref(orgFkColumn)} = record_id and email is not null
    )`;
    const whereClause: Sql = sql`from_email in ${contactEmails} or id in (
      select r.user_all_email_id
      from user_email_recipients r
      where (
        case
          when r.email like '%<%>%'
          then substring(r.email from position('<' in r.email) + 1 for position('>' in r.email) - position('<' in r.email) - 1)
          else r.email
        end
      ) in ${contactEmails}
    )`;
    tabs.push({
      value: "emails",
      header: <DetailTabLabel icon="Mail" label="Emails" />,
      content: (
        <AllEmailsList
          where={whereClause}
          hideHeader
          enableCompose={props.emailsTab?.enableCompose ?? false}
          composeTo={props.emailsTab?.composeTo}
          extraStatements={props.emailsTab?.extraStatements}
          extraActions={props.emailsTab?.extraActions}
          extraDialogs={props.emailsTab?.extraDialogs}
        />
      ),
    });
  }
  if (props.appendTabs) {
    for (const appendTab of props.appendTabs) {
      tabs.push({
        value: appendTab.value,
        header: (
          <DetailTabLabel
            icon={appendTab.header.icon}
            label={appendTab.header.label}
          />
        ),
        content: appendTab.content,
      });
    }
  }
  return (
    <RecordWithTabsAndDetailContent
      header={
        <>
          {props.leftSideHeader ?? (
            <Data
              procedure={(s) => {
                s.defRecord("rec", {
                  query: sql`select * from db.${
                    sql.ref(block.organizationsTableName)
                  } where id = record_id`,
                  allowNoRead: true,
                });
              }}
            >
              <Typography level="h4">
                <Form.InlineEdit
                  sx={{
                    pl: 2,
                    pr: 5,
                    borderRadius: "md",
                    cursor: "pointer",
                    position: "relative",
                    "&:hover": {
                      backgroundColor: "background-level1",
                    },
                    "&:focus-within": {
                      outline: "1px solid",
                      outlineColor: "primary-500",
                    },
                  }}
                  field="name"
                />
              </Typography>
              {table.fields.status && table.fields.status.type === "Enum" && (
                <EditableStatusChip
                  field="status"
                  table={table}
                  writeHooks={props.statusWriteHooks}
                />
              )}
            </Data>
          )}
          <PageHeader.Grow />
          <PageHeader.Actions>
            {props.rightSideHeader ?? (
              <DeleteRecordButton
                size="sm"
                globalUndoSnackbarKey={`${table.name}_undo`}
                afterTransactionCommit={(s) =>
                  s.navigate(sql.lit(block.routes.organizationsListPath))}
              >
                Delete
              </DeleteRecordButton>
            )}
          </PageHeader.Actions>
        </>
      }
      tabs={tabs}
      details={block.opts.organizations?.commentSection && !props.hideComments
        ? (
          <DetailsWithComments
            block={block}
            tableName={block.organizationsTableName}
            detailsTitle="Details"
            details={props.details ?? details}
          />
        )
        : (
          <div className="h-full flex flex-col">
            {!props.hideDetailsHeader && (
              <Typography
                level="title-sm"
                className="px-4 py-2 border-b border-divider"
              >
                Details
              </Typography>
            )}
            <div className="p-3 flex-1 overflow-auto">
              {props.details ?? details}
            </div>
          </div>
        )}
    />
  );
}

export function OrganizationDetailPage(props: OrganizationDetailPageProps) {
  const block = system.block(CrmBlock);
  if (block.crmType !== "b2b") {
    return null;
  }
  const { path, ...contentProps } = props;
  return (
    <RecordPage table={block.organizationsTableName} path={path}>
      <OrganizationDetailContent {...contentProps} />
    </RecordPage>
  );
}

// currently this is in "auto" mode, going off the table and database, eventually we want to support
// a mode where we can pass in tabs and details
export interface PersonDetailContentProps {
  appendTabs?: {
    value?: string;
    header: {
      icon?: IconName;
      label: Node;
    };
    content: Node;
  }[];
  prependTabs?: {
    value?: string;
    header: {
      icon?: IconName;
      label: Node;
    };
    content: Node;
  }[];
  leftSideHeader?: Node;
  rightSideHeader?: Node;
  /**
   * Replace the auto-generated details panel content with custom JSX. Use
   * `CrmBlock.DetailField` / `CrmBlock.DetailDisplayField` to compose your
   * own rows. The surrounding "Details" title and comment-section wrapper
   * are preserved.
   */
  details?: Node;
  /**
   * Field names to omit from the auto-generated details panel. Ignored when
   * `details` is provided.
   */
  excludeFields?: string[];
  /**
   * Pass-through to the auto-generated Emails tab. Use to wire per-row
   * actions and the modals/scalars they share.
   */
  emailsTab?: {
    enableCompose?: boolean;
    composeTo?: Sql;
    extraStatements?: (s: StateStatements) => void;
    extraActions?: Node;
    extraDialogs?: Node;
  };
  hideComments?: boolean;
  hideDefaultEmails?: boolean;
}

export interface PersonDetailPageProps extends PersonDetailContentProps {
  path?: string;
}

/**
 * Detail page for a person/contact. Auto-generates tabs for the
 * person's organization (in B2B mode), pipelines, projects, and
 * activity based on {@link CrmBlock} configuration.
 */
export function PersonDetailContent(props: PersonDetailContentProps) {
  const block = system.block(CrmBlock);
  const table = system.db.tables[block.peopleTableName];
  const details: Node[] = [];
  const addressGroups: string[] = [];
  const fieldGroupNames: string[] = [];

  // Collect field group names for exclusion
  for (const fieldGroup of block.peopleFieldGroups) {
    const groupName = `${
      block.opts.people?.fieldGroupPrefix || ""
    }${fieldGroup.name}`;
    fieldGroupNames.push(groupName);
  }

  for (const block of table.blocks(AddressTableBlock)) {
    addressGroups.push(block.opts.name ?? "address");
    details.push(
      <DetailFieldDisplayOnly label={block.displayName} startIcon="LocationOn">
        <AddressText
          group={block.opts.name ?? "address"}
          placement="left-start"
        />
      </DetailFieldDisplayOnly>,
    );
  }

  const excludeFields = new Set(props.excludeFields ?? []);
  let orgField: Field | undefined;
  for (const field of Object.values(table.fields)) {
    if (table.recordDisplayName?.fields.includes(field.name)) {
      continue;
    }
    if (
      field.group &&
      (addressGroups.includes(field.group) ||
        fieldGroupNames.includes(field.group))
    ) {
      continue;
    }
    if (
      block.crmType === "b2b" &&
      field.type === "ForeignKey" &&
      field.table === block.organizationsTableName
    ) {
      orgField = field;
      if (excludeFields.has(field.name)) {
        continue;
      }
      details.push(<EditSimpleField field={field.name} icon="Business" />);
      continue;
    }
    if (field.name === "phone" || field.type === "PhoneNumber") {
      if (field.type !== "PhoneNumber" && !excludeFields.has(field.name)) {
        details.push(<EditSimpleField field={field.name} icon="Phone" />);
      }
      continue;
    }
    if (field.name === "created_at" || field.name === "last_modified_at") {
      continue;
    }
    if (excludeFields.has(field.name)) {
      continue;
    }

    if (field.name.includes("email")) {
      details.push(<EditSimpleField field={field.name} icon="Email" />);
    } else if (field.name.includes("website")) {
      details.push(<EditSimpleField field={field.name} icon="Web" />);
    } else if (
      field.name.includes("birth_date") ||
      field.name.includes("dob")
    ) {
      details.push(<EditSimpleField field={field.name} icon="Cake" />);
    } else if (field.name.includes("gender")) {
      details.push(<EditSimpleField field={field.name} icon="Person" />);
    } else if (
      field.name.includes("marketing") ||
      field.name.includes("opt_in")
    ) {
      details.push(<EditSimpleField field={field.name} icon="Campaign" />);
    } else if (field.name.includes("loyalty")) {
      details.push(<EditSimpleField field={field.name} icon="Stars" />);
    } else {
      details.push(<EditSimpleField field={field.name} icon="Info" />);
    }
  }
  // Add field group fields to details (only those marked for details)
  for (const fieldGroup of block.peopleFieldGroups) {
    if (fieldGroup.displayLocation === "details") {
      const fieldGroupDetails = renderFieldGroupDetails(
        table,
        fieldGroup,
        block.opts.people?.fieldGroupPrefix,
      );
      if (fieldGroupDetails) {
        details.push(fieldGroupDetails);
      }
    }
  }
  const tabs: {
    value?: string;
    header: Node;
    content: Node;
  }[] = [];

  if (props.prependTabs) {
    for (const prependTab of props.prependTabs) {
      tabs.push({
        value: prependTab.value,
        header: (
          <DetailTabLabel
            icon={prependTab.header.icon}
            label={prependTab.header.label}
          />
        ),
        content: prependTab.content,
      });
    }
  }

  // Add field group tabs
  for (const fieldGroup of block.peopleFieldGroups) {
    const tab = createFieldGroupTab(
      table,
      fieldGroup,
      block.opts.people?.fieldGroupPrefix,
    );
    if (tab) {
      tabs.push(tab);
    }
  }

  for (const block of table.allBlocks()) {
    const tab = block.getDetailTab(table);
    if (tab !== undefined) {
      tabs.push(tab);
    }
  }

  if (block.opts.emailIntegrations && !props.hideDefaultEmails) {
    const contactEmail = sql`(select email from ${
      sql(block.peopleTableName)
    } where id = record_id)`;
    const whereClause: Sql = sql`from_email = ${contactEmail} or id in (
      select r.user_all_email_id
      from user_email_recipients r
      where (
        case
          when r.email like '%<%>%'
          then substring(r.email from position('<' in r.email) + 1 for position('>' in r.email) - position('<' in r.email) - 1)
          else r.email
        end = ${contactEmail}
      )
    )`;
    tabs.push({
      value: "emails",
      header: <DetailTabLabel icon="Mail" label="Emails" />,
      content: (
        <AllEmailsList
          where={whereClause}
          hideHeader
          enableCompose={props.emailsTab?.enableCompose ?? false}
          composeTo={props.emailsTab?.composeTo}
          extraStatements={props.emailsTab?.extraStatements}
          extraActions={props.emailsTab?.extraActions}
          extraDialogs={props.emailsTab?.extraDialogs}
        />
      ),
    });
  }
  if (props.appendTabs) {
    for (const appendTab of props.appendTabs) {
      tabs.push({
        value: appendTab.value,
        header: (
          <DetailTabLabel
            icon={appendTab.header.icon}
            label={appendTab.header.label}
          />
        ),
        content: appendTab.content,
      });
    }
  }
  return (
    <RecordWithTabsAndDetailContent
      header={
        <>
          {props.leftSideHeader ?? (
            <Data
              procedure={(s) => {
                s.defRecord(
                  "rec",
                  sql`select * from db.${
                    sql.ref(table.name)
                  } where id = record_id`,
                );
              }}
            >
              <Typography level="h4">
                {table.recordDisplayName &&
                    table.recordDisplayName.fields.length > 1
                  ? (
                    <Form.InlineEditMulti
                      sx={{
                        pl: 2,
                        pr: 5,
                        borderRadius: "md",
                        cursor: "pointer",
                        position: "relative",
                        "&:hover": {
                          backgroundColor: "background-level1",
                        },
                        "&:focus-within": {
                          outline: "1px solid",
                          outlineColor: "primary-500",
                        },
                      }}
                      fields={table.recordDisplayName.fields}
                      display={table.recordDisplayName.expr}
                    />
                  )
                  : (
                    <Form.InlineEdit
                      sx={{
                        pl: 2,
                        pr: 5,
                        borderRadius: "md",
                        cursor: "pointer",
                        position: "relative",
                        "&:hover": {
                          backgroundColor: "background-level1",
                        },
                        "&:focus-within": {
                          outline: "1px solid",
                          outlineColor: "primary-500",
                        },
                      }}
                      field={table.recordDisplayName?.fields[0] ?? "name"}
                    />
                  )}
              </Typography>

              {/* Only show organization reference in B2B mode */}
              {block.crmType === "b2b" && orgField && (
                <div className="flex items-center gap-2">
                  <MaterialIcon icon="Business" />
                  <InlineRecordDisplay
                    tableName={block.organizationsTableName}
                    id={sql`rec.${sql.ref(orgField.name)}`}
                  />
                </div>
              )}

              {/* Show B2C-specific chips if available */}
              {block.crmType === "b2c" && table.fields.loyalty_tier &&
                table.fields.loyalty_tier.type === "Enum" && (
                <Chip variant="soft" color="primary" startIcon="Stars">
                  {sql`fn.display_${
                    sql(table.fields.loyalty_tier.enum)
                  }(rec.loyalty_tier)`}
                </Chip>
              )}
            </Data>
          )}
          <PageHeader.Grow />
          <PageHeader.Actions>
            {props.rightSideHeader ?? (
              <>
                <DeleteRecordButton
                  size="sm"
                  globalUndoSnackbarKey={`${block.peopleTableName}_undo`}
                  afterTransactionCommit={(s) =>
                    s.navigate(sql.lit(`/${table.getBaseUrl()}`))}
                >
                  Delete
                </DeleteRecordButton>
              </>
            )}
          </PageHeader.Actions>
        </>
      }
      tabs={tabs}
      details={block.opts.people?.commentSection && !props.hideComments
        ? (
          <DetailsWithComments
            block={block}
            tableName={block.peopleTableName}
            detailsTitle="Details"
            details={props.details ?? details}
          />
        )
        : (
          <div className="h-full flex flex-col">
            <Typography
              level="title-sm"
              className="px-4 py-2 border-b border-divider"
            >
              Details
            </Typography>
            <div className="p-3 flex-1 overflow-auto">
              {props.details ?? details}
            </div>
          </div>
        )}
    />
  );
}

export function PersonDetailPage(props: PersonDetailPageProps) {
  const block = system.block(CrmBlock);
  const { path, ...contentProps } = props;
  return (
    <RecordPage table={block.peopleTableName} path={path}>
      <PersonDetailContent {...contentProps} />
    </RecordPage>
  );
}
