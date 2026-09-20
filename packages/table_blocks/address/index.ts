import { addressFieldGroup } from "field_groups/address";
import type { AddressFieldGroupOpts } from "field_groups/address";
import { upcaseFirst } from "std/inflectors";
import { system, TableBlock } from "std/system";
import type { Table, TableBuilder } from "std/system";

/**
 Adds an address field group to the given main table.

This block must be added to a table before using the {@link AddressCard} or
{@link AddressText} components.

Do not individually add the address fields to the table, but instead use this block.

Set `allowMultipleInstances`, so a table may carry several address groups
(e.g. billing + shipping) by adding the block once per group with a distinct
`name`/`prefix` in its {@link AddressFieldGroupOpts}.

 @category Block
 */
export class AddressTableBlock extends TableBlock<AddressFieldGroupOpts> {
  #table?: Table;

  constructor(tableName: string, opts: AddressFieldGroupOpts = {}) {
    super(tableName, opts);
  }

  override allowMultipleInstances = true;

  initialize(table: TableBuilder) {
    addressFieldGroup(table, this.opts);
  }

  /**
   * Human-readable label derived from the group name (underscores to spaces,
   * first letter upper-cased). Falls back to `"Address"` when no name is set.
   */
  get displayName() {
    if (!this.opts.name) {
      return "Address";
    }
    return upcaseFirst(this.opts.name.split("_").join(" "));
  }

  /** The parent main table this block was added to. */
  get table() {
    if (!this.#table) {
      this.#table = system.db.tables[this.parentTableName!];
    }
    return this.#table!;
  }
}
