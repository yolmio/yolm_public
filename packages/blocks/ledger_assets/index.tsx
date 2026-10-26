import {
  AMOUNT_TYPE,
  postSchedulePending,
  schedulePendingFields,
  schedulePeriodEnd,
} from "blocks/ledger";
import type {
  LedgerBlock,
  LedgerSource,
  LedgerStandardAccount,
} from "blocks/ledger";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

/** Longest useful life, matching the ledger's schedules. */
const MAX_MONTHS = 600;

/** Gain or loss when a fixed asset is sold or written off. */
export const ASSET_DISPOSAL_ACCOUNT: LedgerStandardAccount = {
  number: "8900",
  name: "Gain or Loss on Asset Disposal",
  type: "other_income",
};

export interface LedgerAssetsOptions {
  ledger: LedgerBlock;
  /**
   * The equipment table (for example `EquipmentBlock`'s `equipment`), to
   * link an asset to the unit it is. The register stays finance-owned:
   * buildings, software, and grouped purchases have no equipment unit.
   */
  equipment?: { table: string };
}

/**
 * Fixed assets on the ledger: a register of capitalized assets depreciated
 * monthly (straight-line or double-declining) and retired with a gain or
 * loss. Construct before `system.addBlock(ledger)`; it registers the
 * `depreciation` and `asset_disposal` sources.
 */
export class LedgerAssetsBlock implements Block {
  blockName = "LedgerAssetsBlock";
  blockDisplayName = "Fixed assets";
  componentDependencies: string[] = [];
  description =
    "Fixed asset register with monthly depreciation and disposal posting to the ledger.";

  readonly ledger: LedgerBlock;
  readonly equipmentTable?: string;
  readonly #depreciation: LedgerSource;
  readonly #disposal: LedgerSource;

  constructor(opts: LedgerAssetsOptions) {
    this.ledger = opts.ledger;
    this.equipmentTable = opts.equipment?.table;
    this.#depreciation = this.ledger.registerSource({
      key: "depreciation",
      displayName: "Depreciation",
    });
    this.#disposal = this.ledger.registerSource({
      key: "asset_disposal",
      displayName: "Asset disposal",
    });
    this.ledger.addStandardAccounts([ASSET_DISPOSAL_ACCOUNT]);
  }

  initialize() {
    defineFixedAssets(this, this.#depreciation, this.#disposal);
  }

  validate() {
    if (this.equipmentTable && !system.db.tables[this.equipmentTable]) {
      throw new Error(
        `LedgerAssetsBlock equipment table ${this.equipmentTable} is missing`,
      );
    }
  }

  /**
   * Posts depreciation for every asset month ending on or before `through`,
   * one entry per month; reruns post only what is new. Runs in the caller's
   * transaction.
   */
  depreciate<T extends IServerBaseStatements>(s: T, through: Sql) {
    s.callStoredProcedure("ledger_depreciate_assets", {
      inputScalars: { p_through: through },
    });
  }

  /**
   * Opt-in scheduled job that depreciates through the end of last month;
   * months already closed post on the first open day.
   */
  scheduleDepreciation(schedule: string) {
    system.scheduledProc({
      name: "ledger_depreciate_assets_monthly",
      schedule,
      procedure: (s) => {
        s.startTransaction();
        this.depreciate(
          s,
          sql`date.subtract(day, 1, date.start_of_month(current_date()))`,
        );
        s.commitTransaction();
      },
    });
  }

  /**
   * Retires an asset, removing its cost and accumulated depreciation;
   * proceeds post to `proceedsAccountId` and the difference to 8900 Gain or
   * Loss on Asset Disposal. Depreciate through the disposal month first.
   */
  dispose<T extends IServerBaseStatements>(
    s: T,
    opts: {
      assetId: Sql;
      date: Sql;
      proceeds?: Sql;
      proceedsAccountId?: Sql;
    },
  ) {
    s.callStoredProcedure("ledger_dispose_asset", {
      inputScalars: {
        p_asset_id: opts.assetId,
        p_date: opts.date,
        p_proceeds: opts.proceeds ?? sql`cast(null as decimal(18, 4))`,
        p_proceeds_account_id: opts.proceedsAccountId ??
          sql`cast(null as bigint)`,
      },
    });
  }
}

/**
 * Fixed assets: a register of capitalized assets depreciated monthly from
 * their in-service month, straight-line or double-declining balance, down
 * to salvage value. The purchase itself posts through its bill or journal.
 */
function defineFixedAssets(
  assets: LedgerAssetsBlock,
  depreciation: LedgerSource,
  disposal: LedgerSource,
) {
  const block = assets.ledger;
  const { db } = system;
  system.enum_({
    name: "ledger_depreciation_method",
    values: [
      { name: "straight_line", displayName: "Straight line" },
      { name: "declining_balance", displayName: "Double declining balance" },
    ],
  });
  db.table("ledger_fixed_assets", (table) => {
    table.displayName("Fixed assets");
    table.string("name", 200).notNull();
    table.fk("asset_account_id", "ledger_accounts").notNull()
      .onDelete("Restrict");
    table.fk("accumulated_account_id", "ledger_accounts").notNull()
      .onDelete("Restrict");
    table.fk("expense_account_id", "ledger_accounts").notNull()
      .onDelete("Restrict");
    table.money("cost", AMOUNT_TYPE).notNull();
    table.money("salvage_value", AMOUNT_TYPE);
    table.date("in_service_on").notNull();
    table.smallInt("useful_life_months").notNull().check(
      (months) => sql`${months} between 1 and ${MAX_MONTHS}`,
      () => sql.lit`Useful life is 1 to 600 months`,
    );
    table.enum("method", "ledger_depreciation_method").notNull()
      .default(sql`cast('straight_line' as enums.ledger_depreciation_method)`);
    table.date("disposed_on");
    // The equipment unit this asset is, when equipment is tracked.
    if (assets.equipmentTable) {
      table.fk("equipment_id", assets.equipmentTable).onDelete("Restrict");
    }
    for (const d of block.dimensions) {
      table.fk(`${d.key}_id`, d.table).onDelete("Restrict");
    }
    table.recordDisplayName(["name"], (name) => sql`${name}`);
    table.skipAutoApi();
  });
  db.table("ledger_depreciation", (table) => {
    table.displayName("Depreciation");
    table.fk("asset_id", "ledger_fixed_assets").notNull().onDelete("Restrict");
    table.date("period").notNull();
    table.money("amount", AMOUNT_TYPE).notNull();
    table.fk("entry_id", "ledger_entries").notNull().onDelete("Restrict");
    table.insertOnly();
    table.skipAutoApi();
  });

  system.storedProcedure({
    name: "ledger_depreciate_assets",
    transaction: "caller",
    inputScalars: [{ name: "p_through", type: "Date" }],
    procedure: (s) => {
      const postedCount = sql`(select count(*) from db.ledger_depreciation
        where asset_id = asset.id)`;
      const postedSum = sql`coalesce((select sum(amount)
        from db.ledger_depreciation where asset_id = asset.id), 0)`;
      const remaining = sql`(asset.cost - coalesce(asset.salvage_value, 0)
        - ${postedSum})`;
      const dims = block.dimensions.map((d) =>
        sql`asset.${sql.ref(`${d.key}_id`)}`
      );
      const decimals = block.amountDecimalsSql(sql`asset`);
      // Each asset's next unposted month, one month per pass. The amount is
      // cast before rounding: compiled, rounding the raw quotient gave
      // 99.7099 for 99.7058. Declining
      // balance switches to straight-line over the months left once that is
      // larger, so the last month is no cliff.
      const next = sql`select asset.id as schedule_id,
          ${schedulePeriodEnd(sql`asset.in_service_on`, postedCount)} as period,
          asset.expense_account_id as account_id,
          asset.accumulated_account_id as offset_account_id,
          round(cast(case when ${postedCount} + 1 >= asset.useful_life_months
            then ${remaining}
            else least(${remaining}, case
              when asset.method = 'straight_line'
                then (asset.cost - coalesce(asset.salvage_value, 0))
                  / asset.useful_life_months
              else greatest((asset.cost - ${postedSum}) * 2
                  / asset.useful_life_months,
                ${remaining}
                  / (asset.useful_life_months - ${postedCount})) end) end
            as decimal(18, 6)), ${decimals}) as amount
          ${dims.length ? sql`, ${dims}` : sql``}
        from db.ledger_fixed_assets asset
        where ${remaining} > 0
          and ${postedCount} < asset.useful_life_months
          and ${
        schedulePeriodEnd(sql`asset.in_service_on`, postedCount)
      } <= p_through
          and (asset.disposed_on is null
            or ${schedulePeriodEnd(sql`asset.in_service_on`, postedCount)}
              <= asset.disposed_on)`;
      s.defTable("pending_depreciation", {
        fields: schedulePendingFields(block),
      });
      s.defScalar("depreciation_more", sql`true`);
      s.while(sql`depreciation_more`, (s) => {
        s.modify(sql`delete from pending_depreciation`);
        s.modify(sql`insert into pending_depreciation ${next}`);
        s.setScalar(
          "depreciation_more",
          sql`exists (select 1 from pending_depreciation)`,
        );
        postSchedulePending(s, block, depreciation, {
          pending: "pending_depreciation",
          postings: "ledger_depreciation",
          scheduleColumn: "asset_id",
          description: "Depreciation",
        });
      });
    },
  });

  // Removes cost and accumulated depreciation; proceeds post to
  // `p_proceeds_account_id` and the difference to gain or loss on disposal.
  system.storedProcedure({
    name: "ledger_dispose_asset",
    transaction: "caller",
    inputScalars: [
      { name: "p_asset_id", type: "BigInt" },
      { name: "p_date", type: "Date" },
      { name: "p_proceeds", type: AMOUNT_TYPE },
      { name: "p_proceeds_account_id", type: "BigInt" },
    ],
    procedure: (s) => {
      s.defRecord(
        "asset",
        sql`select asset.id, asset.asset_account_id,
            asset.accumulated_account_id, asset.cost, asset.disposed_on,
            asset.salvage_value, asset.useful_life_months,
            asset.in_service_on,
            coalesce((select sum(amount) from db.ledger_depreciation
              where asset_id = asset.id), 0) as accumulated
            ${
          block.dimensions.length
            ? sql`, ${
              block.dimensions.map((d) => sql`asset.${sql.ref(`${d.key}_id`)}`)
            }`
            : sql``
        }
          from db.ledger_fixed_assets asset where asset.id = p_asset_id`,
      );
      s.throwErrorIf(
        sql`asset.id is null or asset.disposed_on is not null`,
        sql.lit`This asset is not in service`,
      );
      s.throwErrorIf(
        sql`coalesce(p_proceeds, 0) <> 0 and p_proceeds_account_id is null`,
        sql.lit`Choose the account that received the proceeds`,
      );
      // Every month ended by the disposal date must be depreciated first,
      // or later runs would depreciate an asset that is already gone.
      const monthsEnded = sql`least(asset.useful_life_months,
        date.diff(month, date.start_of_month(asset.in_service_on),
          date.start_of_month(p_date))
        + case when p_date = ${
        schedulePeriodEnd(sql`p_date`, sql`0`)
      } then 1 else 0 end)`;
      s.throwErrorIf(
        sql`asset.accumulated < asset.cost - coalesce(asset.salvage_value, 0)
          and (select count(*) from db.ledger_depreciation
            where asset_id = p_asset_id) < ${monthsEnded}`,
        sql.lit`Depreciate this asset through the disposal date first`,
      );
      const dims = Object.fromEntries(
        block.dimensions.map((
          d,
        ) => [d.key, sql`asset.${sql.ref(`${d.key}_id`)}`]),
      );
      disposal.post(s, {
        recordId: sql`p_asset_id`,
        date: sql`p_date`,
        description: sql.lit`Asset disposal`,
        lines: [
          {
            account: sql`asset.accumulated_account_id`,
            amount: sql`asset.accumulated`,
            dimensions: dims,
          },
          {
            account: sql`asset.asset_account_id`,
            amount: sql`-asset.cost`,
            dimensions: dims,
          },
          {
            account:
              sql`coalesce(p_proceeds_account_id, asset.asset_account_id)`,
            amount: sql`coalesce(p_proceeds, 0)`,
            dimensions: dims,
          },
          {
            account: block.account(ASSET_DISPOSAL_ACCOUNT.number),
            amount:
              sql`asset.cost - asset.accumulated - coalesce(p_proceeds, 0)`,
            dimensions: dims,
          },
        ],
      });
      s.modify(sql`update db.ledger_fixed_assets set disposed_on = p_date
        where id = p_asset_id`);
    },
  });
}
