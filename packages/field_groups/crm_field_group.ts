import type { IconName } from "components/material_icon_names";
import type { TableBuilder } from "std/system";
import type { Node } from "std/ui";

/**
 * Field group that can be displayed in tabs or details pane
 * Uses a builder pattern similar to table definitions
 */
export class FieldGroup {
  public fields: Array<{ name: string; group: string }> = [];
  public name: string;
  public displayLocation: "tab" | "details";
  public icon?: IconName;
  public displayName?: string;

  constructor(
    name: string,
    displayLocation?: "tab" | "details",
    icon?: IconName,
    displayName?: string,
  ) {
    this.name = name;
    this.displayLocation = displayLocation ?? "details";
    this.icon = icon;
    this.displayName = displayName;
  }

  /**
   * Get the display name for this field group
   */
  getDisplayName(): string {
    return this.displayName ||
      this.name
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }

  /**
   * Apply the field group to a table using a builder function
   * Similar to how tables are defined
   */
  apply(
    table: TableBuilder,
    defineFields: (fg: FieldGroupBuilder) => void,
    prefix?: string,
  ): void {
    const builder = new FieldGroupBuilder(table, this.name, prefix);
    defineFields(builder);
    this.fields = builder.getFields();
  }

  /**
   * Optional custom tab content renderer
   */
  getTabContent?(): Node;

  /**
   * Optional custom details renderer
   */
  getDetailsContent?(): Node;
}

/**
 * Builder class that provides the same API as TableBuilder but scoped to a field group
 */
export class FieldGroupBuilder {
  private fields: Array<{ name: string; group: string }> = [];
  private groupName: string;

  constructor(
    private table: TableBuilder,
    groupName: string,
    private prefix?: string,
  ) {
    this.groupName = `${prefix || ""}${groupName}`;
  }

  // String fields
  string(name: string, maxLength: number) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.string(fieldName, maxLength).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Integer fields
  int(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.int(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // BigInt fields
  bigInt(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.bigInt(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Decimal fields
  decimal(
    name: string,
    options: { precision: number; scale: number; signed?: boolean },
  ) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.decimal(fieldName, options).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Boolean fields
  bool(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.bool(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Date fields
  date(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.date(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Time fields
  time(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.time(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Timestamp fields
  timestamp(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.timestamp(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // UUID fields
  uuid(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.uuid(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Enum fields
  enum(name: string, enumName: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.enum(fieldName, enumName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Email fields
  email(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.email(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Phone number fields
  phoneNumber(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.phoneNumber(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // URL fields (URLs are stored as strings)
  url(name: string, maxLength = 255) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.string(fieldName, maxLength).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // JSON fields
  json(name: string) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.json(fieldName).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Bytes fields
  bytes(name: string, maxLength = 1024) {
    const fieldName = `${this.prefix || ""}${name}`;
    const field = this.table.bytes(fieldName, maxLength).group(this.groupName);
    this.fields.push({ name: fieldName, group: this.groupName });
    return field;
  }

  // Foreign key fields
  fk(tableName: string, fieldName?: string) {
    const fkFieldName = fieldName || `${tableName}_id`;
    const fullFieldName = `${this.prefix || ""}${fkFieldName}`;
    const field = this.table.fk(tableName, fullFieldName).group(this.groupName);
    this.fields.push({ name: fullFieldName, group: this.groupName });
    return field;
  }

  // Get all fields defined in this group
  getFields() {
    return this.fields;
  }
}

/**
 * Configuration for CRM field groups
 */
export interface CrmFieldGroupConfigV2 {
  fieldGroups?: Array<{
    name: string;
    displayLocation?: "tab" | "details";
    icon?: IconName;
    displayName?: string;
    define: (fg: FieldGroupBuilder) => void;
  }>;
  prefix?: string;
}
