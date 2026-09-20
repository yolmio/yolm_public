import {
  AdminRelatedTable,
  type AdminRelatedTableProps,
} from "pages/admin_crud_page";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { Card, CardHeader } from "components/card";
import { InlineFieldDisplay } from "components/inline_field_display";
import { Sidebar } from "components/sidebar";
import { Tabs } from "components/tabs";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { SidebarPresenceICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import type { Field, Table } from "std/system";
import { useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";

type AdminDetailTitle = Node | ((record: Sql) => Node);

/**
 * One field shown in an {@link AdminDetailSection}: either the field name as a
 * string, or an object to override its label, span the full width (`wide`), or
 * render a custom value display.
 */
export type AdminDetailField =
  | string
  | {
    field: string;
    label?: Node;
    /** Render across both grid columns (used for long text / JSON). */
    wide?: boolean;
    /** Custom value renderer; receives the field's SQL value and definition. */
    display?: (value: AnyExpr, field: Field) => Node;
  };

/** A titled card of fields on an {@link AdminDetailPage}, optionally with extra children and its own Edit button. */
export interface AdminDetailSection {
  title: Node;
  /** Fields shown in the card; gates the section's Edit button. */
  fields?: AdminDetailField[];
  children?: Node;
  /** Set false to hide the section's Edit button even when the page is updatable. */
  editable?: boolean;
}

/** A custom tab on an {@link AdminDetailPage}, rendered alongside the auto Details and related tabs. */
export interface AdminDetailTab {
  /** Stable tab key (matched by `defaultTab`). */
  value: string;
  label: Node;
  children: Node;
}

/** Props for {@link AdminDetailPage}. */
export interface AdminDetailPageProps {
  /** Table whose record is shown (the page reads `ui.record_id`). */
  table: string;
  /** Route path. Defaults to the table's record route. */
  path?: string;
  /** Heading; a callback receives the record ref. Defaults to the record's primary key. */
  title?: AdminDetailTitle;
  /** Status chips/badges rendered next to the title. */
  chips?: Node;
  /** Enable record editing (Edit button). `false` disables; object form sets ignored fields. */
  update?: boolean | { ignoreFields?: string[] };
  /** Field sections shown under a "Details" tab. Defaults to one section of all fields. */
  sections?: AdminDetailSection[];
  /** Related tables, each rendered as its own tab. */
  related?: AdminRelatedTableProps[];
  /** Additional custom tabs. */
  tabs?: AdminDetailTab[];
  /** Initially selected tab value. Defaults to the first tab. */
  defaultTab?: string;
  containerClassName?: string;
}

/**
 * An admin-style record detail page: a header with title/chips and an Edit
 * button, plus tabbed field sections, related tables, and custom tabs. Built on
 * {@link RecordPage} (reads `ui.record_id`) and pairs with {@link AdminCrudPage}'s
 * routed detail mode.
 *
 * **Self-routing: do NOT wrap in a Route component.**
 *
 * @category Page Component
 */
export function AdminDetailPage(props: AdminDetailPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  return (
    <RecordPage table={props.table} path={props.path}>
      <AdminDetailPageContent {...props} tableModel={table} />
    </RecordPage>
  );
}

function AdminDetailPageContent(
  props: AdminDetailPageProps & { tableModel: Table },
) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  const title = props.title
    ? typeof props.title === "function" ? props.title(sql`record`) : props.title
    : sql`record.${props.tableModel.primaryKeyIdent}`;
  const updateConfig = typeof props.update === "object" ? props.update : {};
  const canUpdate = props.update !== false;
  const sectionTabs = props.sections?.length
    ? [{
      value: "details",
      label: "Details",
      children: (
        <AdminDetailSections
          table={props.tableModel}
          sections={props.sections}
          canUpdate={canUpdate}
          updateConfig={updateConfig}
        />
      ),
    }]
    : [];
  const relatedTabs = (props.related ?? []).map((related, index) => ({
    value: `related_${index}`,
    label: related.title,
    children: <AdminRelatedTable {...related} />,
  }));
  const tabs = [...sectionTabs, ...relatedTabs, ...(props.tabs ?? [])];
  const defaultTab = props.defaultTab ?? tabs[0]?.value;

  return (
    <div className={props.containerClassName ?? "h-full overflow-y-auto p-4"}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
          <Typography level="h3" className="truncate">{title}</Typography>
          {props.chips}
        </div>
        {canUpdate && (
          <AutoUpdateButton
            table={props.tableModel.name}
            recordId={sql`ui.record_id`}
            ignoreFields={updateConfig.ignoreFields}
            size="sm"
            variant="soft"
            startIcon="Edit"
          >
            Edit
          </AutoUpdateButton>
        )}
      </div>

      {tabs.length > 0
        ? (
          <Tabs defaultValue={defaultTab}>
            <div className="overflow-x-auto">
              <Tabs.List tabFlex="0 0 auto" className="min-w-max">
                {tabs.map((tab) => (
                  <Tabs.Tab value={tab.value} className="whitespace-nowrap">
                    {tab.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </div>
            {tabs.map((tab) => (
              <Tabs.Panel value={tab.value}>{tab.children}</Tabs.Panel>
            ))}
          </Tabs>
        )
        : (
          <AdminDetailSections
            table={props.tableModel}
            sections={props.sections ?? [defaultSection(props.tableModel)]}
            canUpdate={canUpdate}
            updateConfig={updateConfig}
          />
        )}
    </div>
  );
}

function AdminDetailSections(props: {
  table: Table;
  sections: AdminDetailSection[];
  canUpdate: boolean;
  updateConfig: { ignoreFields?: string[] };
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {props.sections.map((section) => (
        <Card variant="outlined">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 w-full">
              <span>{section.title}</span>
              {props.canUpdate && section.editable !== false &&
                  section.fields?.length
                ? (
                  <AutoUpdateButton
                    table={props.table.name}
                    recordId={sql`ui.record_id`}
                    fields={getSectionFieldNames(section)}
                    ignoreFields={props.updateConfig.ignoreFields}
                    size="sm"
                    variant="plain"
                    startIcon="Edit"
                  >
                    Edit
                  </AutoUpdateButton>
                )
                : null}
            </div>
          </CardHeader>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.fields?.map((field) => (
              <AdminDetailFieldRow table={props.table} config={field} />
            ))}
            {section.children}
          </div>
        </Card>
      ))}
    </div>
  );
}

function getSectionFieldNames(section: AdminDetailSection) {
  return section.fields?.map((field) =>
    typeof field === "string" ? field : field.field
  ) ?? [];
}

function AdminDetailFieldRow(props: {
  table: Table;
  config: AdminDetailField;
}) {
  const config = typeof props.config === "string"
    ? { field: props.config }
    : props.config;
  const field = props.table.fields[config.field];
  if (!field) {
    throw new Error(`Field ${config.field} not found on ${props.table.name}`);
  }
  const value = sql`record.${field.ident}`;
  const wide = config.wide ?? isLongDetailField(field);
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <Typography level="body-xs" className="text-tertiary mb-1">
        {config.label ?? field.displayName}
      </Typography>
      <div
        className={wide
          ? "rounded-sm bg-level1 p-3 text-sm whitespace-pre-wrap break-words max-h-80 overflow-auto"
          : "text-sm"}
      >
        {config.display
          ? config.display(value, field)
          : wide
          ? sql`cast(${value} as string)`
          : canInlineDisplayField(field)
          ? <InlineFieldDisplay field={field} value={value} />
          : value}
      </div>
    </div>
  );
}

function defaultSection(table: Table): AdminDetailSection {
  return {
    title: table.displayName,
    fields: Object.values(table.fields)
      .filter((field) => field.name !== "id" && field.type !== "Bytes")
      .map((field) => field.name),
  };
}

function isLongDetailField(field: Field) {
  return field.type === "String" &&
    (field.multiline ||
      field.maxLength > 160 ||
      field.name.includes("note") ||
      field.name.includes("description") ||
      field.name.includes("comment"));
}

function canInlineDisplayField(field: Field) {
  if (field.type !== "ForeignKey") {
    return true;
  }
  const target = system.db.tables[field.table];
  return !!(
    target?.inlineRecordDisplay || target?.recordDisplayName ||
    target?.fields.email
  );
}
