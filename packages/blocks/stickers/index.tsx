import { Alert } from "components/alert";
import { Button } from "components/button";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import { Each, Show } from "std/ui";

/** A record kind a sticker can be attached to. */
export interface StickerTarget {
  /** Foreign key column on `stickers`, e.g. `equipment_id`. */
  field: string;
  /** Referenced table, e.g. `equipment`. */
  table: string;
  /** Sticker type values used for this target. The first is the default. */
  types: { name: string; displayName: string }[];
  /**
   * `single`: one current sticker; a new one supersedes it and bumps
   * `qr_version` (pieces, bundles). `many`: stickers are independent and are
   * voided individually; blank stickers can be attached (equipment, locations).
   */
  stickers: "single" | "many";
}

export interface StickersBlockOptions {
  targets: StickerTarget[];
  /** Enum name for sticker types. */
  typeEnum?: string;
  /** Who may issue, print and void stickers. */
  canIssue: (user: Sql) => Sql;
  /** Who may attach a blank sticker to a `many` target. */
  canAttach: (user: Sql) => Sql;
  /** QR payload for a code, usually an app URL so phone cameras open it. */
  qrValue: (code: Sql) => Sql;
  /** Creator column target; defaults to `sys_users` keyed by the acting user. */
  creator?: { table: string; fromUser: (user: Sql) => Sql };
  defineStickers?: (table: TableBuilder) => void;
}

const BLANK = "blank";

/** Printed QR stickers with late binding to equipment, locations or other records. */
export class StickersBlock implements Block {
  blockName = "StickersBlock";
  blockDisplayName = "Stickers";
  componentDependencies = [];
  description =
    "QR sticker codes: issue, print, attach blank stickers later, supersede or void.";

  constructor(readonly opts: StickersBlockOptions) {}

  get typeEnum() {
    return this.opts.typeEnum ?? "sticker_type";
  }

  private creator(user: Sql) {
    return this.opts.creator?.fromUser(user) ?? user;
  }

  initialize() {
    const targets = this.opts.targets;
    system.enum_({
      name: this.typeEnum,
      values: [
        { name: BLANK, displayName: "Blank" },
        ...targets.flatMap((target) => target.types),
      ],
    });
    system.enum_({
      name: "sticker_status",
      values: [
        { name: "active", displayName: "Active" },
        { name: "superseded", displayName: "Superseded" },
        { name: "void", displayName: "Void" },
      ],
    });
    system.db.table("stickers", (table) => {
      for (const target of targets) table.fk(target.field, target.table);
      table.enum("sticker_type", this.typeEnum).notNull();
      table.string("label_code", 120).notNull().unique();
      table.check({
        fields: ["label_code"],
        errorMessage: () =>
          sql.lit`Sticker codes must be nonempty, lowercase, and trimmed.`,
        check: ([code]) =>
          sql`${code} != '' and ${code} collate binary = lower(trim(${code})) collate binary`,
      });
      table.int("qr_version").notNull().default(sql`1`);
      table.enum("status", "sticker_status").notNull().default(
        sql.lit`active`,
      );
      table.timestampUtc("issued_at").notNull().default(sql`now()`);
      table.uuid("batch_id");
      table.timestampUtc("bound_at");
      table.fk("bound_by_id", "sys_users").onDelete("SetToNull");
      table.fk("created_by_id", this.opts.creator?.table ?? "sys_users");
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.check({
        fields: ["sticker_type", ...targets.map((target) => target.field)],
        errorMessage: () =>
          sql
            .lit`A sticker's type must match the one record it identifies; blank stickers identify none.`,
        check: ([kind, ...fields]) => {
          const attached = fields
            .map((field) => sql`case when ${field} is null then 0 else 1 end`)
            .reduce((sum, next) => sql`${sum} + ${next}`);
          const typed = targets.map((target, index) =>
            sql`(${fields[index]} is null or ${
              sql.inList(kind, target.types.map((type) => sql.lit(type.name)))
            })`
          );
          return sql.and(
            sql`(${attached}) = case when ${kind} = ${
              sql.lit(BLANK)
            } then 0 else 1 end`,
            ...typed,
          );
        },
      });
      for (const target of targets) {
        if (target.stickers === "single") {
          table.unique({
            fields: [target.field, "qr_version"],
            distinctNulls: true,
          });
        }
      }
      this.opts.defineStickers?.(table);
      table.recordDisplayName(["label_code"], (code) => code);
    });
  }

  populate() {
    this.registerIssueProcedure();
    this.registerBlankProcedure();
    this.registerAttachProcedure();
    this.registerVoidProcedure();
  }

  /** Accepts a bare code or a scanned URL whose last path segment is the code. */
  static normalizeCode(value: Sql) {
    return sql`lower(trim(regex.replace_all(trim(${value}), '^.*/', '')))`;
  }

  /** New random code: ten hex characters in two groups, easy to type. Evaluated per row. */
  static newCodeSql() {
    return sql`left(replace(cast(gen_random_uuid() as string), '-', ''), 5) || '-' || left(replace(cast(gen_random_uuid() as string), '-', ''), 5)`;
  }

  /** QR image data URL for a code, using the configured payload. */
  qrImage(code: Sql) {
    return sql`qr.data_url(${this.opts.qrValue(code)}, 'M')`;
  }

  private targetBranches(
    s: ProcedureStatements,
    body: (s: ProcedureStatements, target: StickerTarget) => void,
  ) {
    for (const target of this.opts.targets) {
      s.if(sql`p_target = ${sql.lit(target.field)}`, (s) => body(s, target));
    }
  }

  private registerIssueProcedure() {
    system.storedProcedure({
      name: "stickers_issue",
      transaction: "caller",
      inputScalars: [
        { name: "p_target", type: { type: "String", maxLength: 100 } },
        { name: "p_target_id", type: "BigInt" },
        { name: "p_type", type: { type: "String", maxLength: 100 } },
        { name: "p_actor", type: "BigInt" },
      ],
      outputScalars: [{ name: "p_sticker_id", type: "BigInt" }],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not coalesce(${this.opts.canIssue(sql`p_actor`)}, false)`,
          sql.lit`Sticker printing permission is required.`,
        );
        s.throwErrorIf(
          sql`not ${
            sql.inList(
              sql`p_target`,
              this.opts.targets.map((target) => sql.lit(target.field)),
            )
          }`,
          sql.lit`Unknown sticker target.`,
        );
        s.defScalar("issued_sticker", { type: "BigInt" });
        this.targetBranches(s, (s, target) => {
          s.throwErrorIf(
            sql`not exists(select 1 from db.${
              sql.ref(target.table)
            } where id = p_target_id)`,
            sql.lit`The record to label was not found.`,
          );
          s.defScalar(
            "issue_type",
            sql`coalesce(nullif(p_type, ''), ${sql.lit(target.types[0].name)})`,
          );
          s.throwErrorIf(
            sql`not ${
              sql.inList(
                sql`issue_type`,
                target.types.map((type) => sql.lit(type.name)),
              )
            }`,
            sql.lit`That sticker type does not fit this record.`,
          );
          s.defScalar("issue_version", sql`1`);
          if (target.stickers === "single") {
            s.setScalar(
              "issue_version",
              sql`coalesce((select max(qr_version) from db.stickers where ${
                sql.ref(target.field)
              } = p_target_id), 0) + 1`,
            );
            s.modify(sql`update db.stickers set status = 'superseded'
              where ${
              sql.ref(target.field)
            } = p_target_id and status = 'active'`);
          }
          s.modify(sql`insert into db.stickers
            (${
            sql.ref(target.field)
          }, sticker_type, label_code, qr_version, created_by_id)
            values (p_target_id, cast(issue_type as enums.${
            sql.ref(this.typeEnum)
          }), ${StickersBlock.newCodeSql()}, issue_version, ${
            this.creator(sql`p_actor`)
          })
            returning id into issued_sticker`);
        });
        s.setScalar("p_sticker_id", sql`issued_sticker`);
      },
    });
  }

  private registerBlankProcedure() {
    system.storedProcedure({
      name: "stickers_issue_blank",
      transaction: "caller",
      inputScalars: [
        { name: "p_count", type: "Int" },
        { name: "p_actor", type: "BigInt" },
      ],
      outputScalars: [{ name: "p_batch_id", type: "Uuid" }],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not coalesce(${this.opts.canIssue(sql`p_actor`)}, false)`,
          sql.lit`Sticker printing permission is required.`,
        );
        s.throwErrorIf(
          sql`p_count is null or p_count < 1 or p_count > 200`,
          sql.lit`Print between 1 and 200 blank stickers at a time.`,
        );
        s.setScalar("p_batch_id", sql`gen_random_uuid()`);
        s.modify(sql`insert into db.stickers
          (sticker_type, label_code, batch_id, created_by_id)
          select cast(${sql.lit(BLANK)} as enums.${
          sql.ref(this.typeEnum)
        }), ${StickersBlock.newCodeSql()}, p_batch_id, ${
          this.creator(sql`p_actor`)
        }
          from generate_series(1, p_count)`);
      },
    });
  }

  private registerAttachProcedure() {
    const attachable = this.opts.targets.filter((target) =>
      target.stickers === "many"
    );
    system.storedProcedure({
      name: "stickers_attach",
      transaction: "caller",
      inputScalars: [
        { name: "p_code", type: { type: "String", maxLength: 400 } },
        { name: "p_target", type: { type: "String", maxLength: 100 } },
        { name: "p_target_id", type: "BigInt" },
        { name: "p_actor", type: "BigInt" },
      ],
      outputScalars: [{ name: "p_sticker_id", type: "BigInt" }],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not coalesce(${this.opts.canAttach(sql`p_actor`)}, false)`,
          sql.lit`You cannot attach stickers.`,
        );
        s.defRecord(
          "attach_sticker",
          sql`select id, status, sticker_type = ${
            sql.lit(BLANK)
          } as blank from db.stickers
            where label_code = ${StickersBlock.normalizeCode(sql`p_code`)}`,
        );
        s.throwErrorIf(
          sql`attach_sticker.id is null`,
          sql.lit`That sticker code was not found.`,
        );
        s.throwErrorIf(
          sql`not attach_sticker.blank or attach_sticker.status <> 'active'`,
          sql.lit`This sticker is already in use.`,
        );
        s.throwErrorIf(
          sql`not ${
            sql.inList(sql`p_target`, [
              ...attachable.map((target) => sql.lit(target.field)),
              sql.lit``,
            ])
          }`,
          sql.lit`Blank stickers cannot be attached to that kind of record.`,
        );
        s.setScalar("p_sticker_id", sql`attach_sticker.id`);
        for (const target of attachable) {
          s.if(sql`p_target = ${sql.lit(target.field)}`, (s) => {
            s.throwErrorIf(
              sql`not exists(select 1 from db.${
                sql.ref(target.table)
              } where id = p_target_id)`,
              sql.lit`The record to label was not found.`,
            );
            s.modify(
              sql`update db.stickers set ${sql.ref(target.field)} = p_target_id,
              sticker_type = cast(${sql.lit(target.types[0].name)} as enums.${
                sql.ref(this.typeEnum)
              }),
              bound_at = now(), bound_by_id = p_actor
              where id = attach_sticker.id`,
            );
          });
        }
      },
    });
  }

  private registerVoidProcedure() {
    system.storedProcedure({
      name: "stickers_void",
      transaction: "caller",
      inputScalars: [
        { name: "p_sticker_id", type: "BigInt" },
        { name: "p_actor", type: "BigInt" },
      ],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not coalesce(${this.opts.canIssue(sql`p_actor`)}, false)`,
          sql.lit`Sticker printing permission is required.`,
        );
        s.modify(
          sql`update db.stickers set status = 'void' where id = p_sticker_id and status = 'active'`,
        );
      },
    });
  }
}

type ProcedureStatements = GeneralServerStatements;

/**
 * Printable sticker sheet: one sticker per cell with QR, code and caption.
 * Browser printing to a Zebra driver prints one sticker per label.
 */
export function StickerSheet(props: {
  block: StickersBlock;
  where: Sql;
  caption?: (sticker: Sql) => Sql;
}) {
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "sheet_stickers",
          sql`select sticker.id, sticker.label_code, ${
            props.block.qrImage(sql`sticker.label_code`)
          } as qr_image, ${
            props.caption?.(sql`sticker`) ?? sql`cast(null as string)`
          } as caption
          from db.stickers sticker where ${props.where}
          order by sticker.id`,
        )}
    >
      <div
        className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-1 print:gap-0 print:p-0"
        sx={{ "@media print": { "& > div": { breakAfter: "page" } } }}
      >
        <Each table="sheet_stickers" recordName="sheet_sticker">
          <div className="flex items-center gap-3 rounded-lg border border-divider bg-white p-3 print:rounded-none print:border-0">
            <img
              src={sql`sheet_sticker.qr_image`}
              alt={sql`'QR ' || sheet_sticker.label_code`}
              className="h-24 w-24 shrink-0"
            />
            <div className="min-w-0">
              <p className="whitespace-nowrap font-mono text-lg font-bold tracking-wider text-black">
                {sql`upper(sheet_sticker.label_code)`}
              </p>
              <Show when={sql`sheet_sticker.caption is not null`}>
                <p className="text-sm text-black">
                  {sql`sheet_sticker.caption`}
                </p>
              </Show>
            </div>
          </div>
        </Each>
      </div>
    </Data>
  );
}

/** Active stickers on one record, with print and void actions. */
export function StickersCard(props: {
  block: StickersBlock;
  target: string;
  targetId: Sql;
  printHref: (stickerId: Sql) => Sql;
}) {
  const target = props.block.opts.targets.find((candidate) =>
    candidate.field === props.target
  );
  if (!target) throw new Error(`Unknown sticker target ${props.target}`);
  return (
    <Data
      local
      procedure={(s) =>
        s.defScalar("stickers_printed_id", {
          expr: sql`null`,
          type: "BigInt",
        })}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "stickers_can_issue",
            sql`coalesce(${
              props.block.opts.canIssue(sql`current_user`)
            }, false)`,
          );
          s.defTable(
            "record_stickers",
            sql`select id, label_code, status, qr_version, issued_at, bound_at
            from db.stickers where ${
              sql.ref(target.field)
            } = ${props.targetId} and status = 'active'
            order by id desc`,
          );
        }}
      >
        <div className="flex flex-col gap-2">
          <Show when={sql`not exists(select 1 from record_stickers)`}>
            <Typography level="body-sm" color="neutral">
              No sticker yet.
            </Typography>
          </Show>
          <Each table="record_stickers" recordName="record_sticker">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-divider px-3 py-2">
              <div>
                <p className="font-mono text-sm font-semibold">
                  {sql`upper(record_sticker.label_code)`}
                </p>
                <p className="text-xs text-secondary">
                  {sql`case when record_sticker.bound_at is not null then 'Attached ' || format.date(record_sticker.bound_at, '%b %-d, %Y') else 'Issued ' || format.date(record_sticker.issued_at, '%b %-d, %Y') end`}
                </p>
              </div>
              <Show when={sql`stickers_can_issue`}>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="plain"
                    href={props.printHref(sql`record_sticker.id`)}
                  >
                    Print
                  </Button>
                  {target.stickers === "many" && (
                    <ActionButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      confirm={{
                        description:
                          "Void this sticker? Scanning it will show that it was removed from use.",
                        confirmText: "Void sticker",
                      }}
                      action={(s) => {
                        s.startTransaction();
                        s.callStoredProcedure("stickers_void", {
                          inputScalars: {
                            p_sticker_id: sql`record_sticker.id`,
                            p_actor: sql`current_user`,
                          },
                        });
                        s.commitTransaction();
                      }}
                    >
                      Void
                    </ActionButton>
                  )}
                </div>
              </Show>
            </div>
          </Each>
          <Show when={sql`stickers_can_issue`}>
            <ActionButton
              size="sm"
              variant="outlined"
              startIcon="QrCode"
              errorDisplay="inline"
              action={(s) => {
                s.startTransaction();
                s.callStoredProcedure("stickers_issue", {
                  inputScalars: {
                    p_target: sql.lit(target.field),
                    p_target_id: props.targetId,
                    p_type: sql.lit``,
                    p_actor: sql`current_user`,
                  },
                  outputScalars: { p_sticker_id: "issued_sticker_id" },
                });
                s.commitTransaction();
                s.setScalar("ui.stickers_printed_id", sql`issued_sticker_id`);
              }}
              afterSuccessClient={(s) =>
                s.navigate(props.printHref(sql`stickers_printed_id`))}
            >
              {target.stickers === "single" ? "Reprint sticker" : "New sticker"}
            </ActionButton>
          </Show>
        </div>
      </Data>
    </Data>
  );
}

/** Explains a sticker that cannot be opened. */
export function StickerStatusAlert(props: { status: Sql }) {
  return (
    <Alert color="warning" variant="soft">
      {sql`case ${props.status} when 'superseded' then 'This sticker was reprinted. Use the current sticker.' when 'void' then 'This sticker was removed from use.' else 'This sticker code was not found.' end`}
    </Alert>
  );
}
