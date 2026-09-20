import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { DataTable } from "components/data_table";
import { Button } from "components/button";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import { system, useBlock } from "std/system";
import type { Block } from "std/system";
import { Route, Show } from "std/ui";

export type PrintContentType = "pdf" | "raw";
export interface PrinterDestination {
  name: string;
  contentType: PrintContentType;
}
export interface PrintersBlockOpts {
  destinations: readonly PrinterDestination[];
}
export interface EnqueueDocumentOpts {
  destination: string;
  blob: AnyExpr;
  name: AnyExpr;
  copies?: AnyExpr;
}
export interface EnqueueRawOpts {
  destination: string;
  blob: AnyExpr;
  name: AnyExpr;
}

// Only the statement primitive these helpers need; usable from UI, tests and APIs.
interface PrintStatements {
  modify(statement: Sql): unknown;
}

/** One shared print queue; Forge owns the physical machines and driver configs. */
export class PrintersBlock implements Block {
  blockName = "PrintersBlock";
  blockDisplayName = "Printers";
  componentDependencies: string[] = [];
  description = "Print-ready PDF, ZPL, and ESC/POS jobs with explicit retry.";
  readonly destinations: readonly PrinterDestination[];

  constructor(opts: PrintersBlockOpts) {
    if (!opts.destinations.length) {
      throw new Error("PrintersBlock requires a destination");
    }
    const names = new Set<string>();
    for (const destination of opts.destinations) {
      if (
        !/^[a-z][a-z0-9_]{0,63}$/.test(destination.name) ||
        names.has(destination.name)
      ) {
        throw new Error(
          `Invalid or duplicate printer destination: ${destination.name}`,
        );
      }
      names.add(destination.name);
    }
    this.destinations = [...opts.destinations];
  }

  enqueueDocument(s: PrintStatements, opts: EnqueueDocumentOpts) {
    this.enqueue(s, opts, true);
  }

  enqueueRaw(s: PrintStatements, opts: EnqueueRawOpts) {
    this.enqueue(s, opts, false);
  }

  private enqueue(
    s: PrintStatements,
    opts: EnqueueDocumentOpts,
    document: boolean,
  ) {
    const destination = this.destinations.find((entry) =>
      entry.name === opts.destination
    );
    if (!destination || (destination.contentType === "pdf") !== document) {
      throw new Error(
        `Printer destination ${opts.destination} does not accept this job type`,
      );
    }
    s.modify(
      sql`insert into db.print_jobs (destination, content_type, content_blob, name, copies)
      values (${sql.lit(destination.name)}, ${
        sql.lit(destination.contentType)
      }, ${opts.blob}, ${opts.name}, ${opts.copies ?? sql`1`})`,
    );
  }

  initialize() {
    // Check expressions call functions instead of quoting literals: the
    // compiler echoes the check text into its violation message, and CLI
    // builds before platform cf22b79e2 do not escape the quotes there.
    system.enum_({
      name: "print_content_type",
      values: ["pdf", "raw"],
      withBoolRulesFn: [
        { name: "print_content_type_is_document", trues: ["pdf"] },
      ],
    });
    system.scalarFunction({
      name: "print_destination_accepts",
      description:
        "True when the destination is configured for the job's content type.",
      parameters: [
        { name: "destination", type: { type: "String", maxLength: 64 } },
        {
          name: "content_type",
          type: { type: "Enum", enum: "print_content_type" },
        },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.return(
          sql.or(
            ...this.destinations.map((destination) =>
              sql`input.destination = ${
                sql.lit(destination.name)
              } and input.content_type = ${sql.lit(destination.contentType)}`
            ),
          ),
        );
      },
    });
    system.enum_({
      name: "print_status",
      values: ["queued", "submitting", "submitted", "failed", "cancelled"],
    });
    system.db.table("print_jobs", (table) => {
      table.string("destination", 64).notNull();
      table.enum("content_type", "print_content_type").notNull();
      table.blobRef("content_blob").notNull();
      table.string("name", 200).notNull();
      table.int("copies").notNull().default(sql`1`);
      table.enum("status", "print_status").notNull().default(sql.lit`queued`);
      table.int("attempt").notNull().default(sql`0`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("started_at");
      table.timestampUtc("finished_at");
      table.string("error", 2000);
      table.check({
        fields: ["copies", "content_type"],
        errorMessage: () =>
          sql.lit`PDF copies must be 1–100; raw jobs encode their own copies`,
        check: ([copies, type]) =>
          sql`${copies} between 1 and 100 and (fn.print_content_type_is_document(${type}) or ${copies} = 1)`,
      });
      table.check({
        fields: ["attempt"],
        errorMessage: () => sql.lit`Invalid print attempt`,
        check: ([attempt]) => sql`${attempt} >= 0`,
      });
      table.check({
        fields: ["destination", "content_type"],
        errorMessage: () =>
          sql.lit`Unknown destination or incompatible print format`,
        check: ([name, type]) =>
          sql`fn.print_destination_accepts(${name}, ${type})`,
      });
    });
    for (const destination of this.destinations) this.defineEdge(destination);
  }

  private defineEdge(destination: PrinterDestination) {
    const edge = system.edge({
      name: `printer_${destination.name}`,
      drivers: {
        printer: destination.contentType === "pdf"
          ? { type: "document_printer" }
          : { type: "raw_printer" },
      },
    });
    const printer = edge.driver("printer");
    edge.onReactor({
      name: "submit_job",
      query: sql`select id from db.print_jobs where destination = ${
        sql.lit(destination.name)
      } and status = 'queued'
        and not exists(select 1 from db.print_jobs active where active.destination = ${
        sql.lit(destination.name)
      } and active.status = 'submitting')
        order by id limit 1`,
      procedure: (s) => {
        s.server((s) => {
          s.defScalar("print_content", sql`bytes.from_hex('')`);
          s.startTransaction();
          s.defRecord(
            "print_job",
            sql`select id, content_blob, name, copies, attempt + 1 as next_attempt
            from db.print_jobs where destination = ${
              sql.lit(destination.name)
            } and status = 'queued'
              and not exists(select 1 from db.print_jobs active where active.destination = ${
              sql.lit(destination.name)
            } and active.status = 'submitting')
              order by id limit 1`,
          );
          s.if(sql`print_job.id is not null`, (s) => {
            s.modify(
              sql`update db.print_jobs set status = 'submitting', attempt = print_job.next_attempt,
              started_at = now(), finished_at = null, error = null where id = print_job.id`,
            );
          });
          s.commitTransaction();
          s.if(sql`print_job.id is not null`, (s) => {
            s.readBlob(sql`print_job.content_blob`, {
              setContentScalar: "print_content",
            });
          });
        });
        s.if(sql`print_job.id is not null`, (s) => {
          s.driverSend(printer.send({
            action: "print",
            durability: "durable",
            commandId:
              sql`print_job.id::string || ':' || print_job.next_attempt::string`,
            params: {
              content: sql`print_content`,
              job_name: sql`print_job.name`,
              ...(destination.contentType === "pdf"
                ? { copies: sql`print_job.copies` }
                : {}),
            },
          }));
        });
      },
    });
    for (const event of ["complete", "error"] as const) {
      edge.onDriver({
        name: `print_${event}`,
        driver: printer,
        event,
        procedure: (s) =>
          s.server((s) => {
            s.startTransaction();
            s.modify(sql`update db.print_jobs set
            status = ${
              sql.lit(event === "complete" ? "submitted" : "failed")
            }, finished_at = now(),
            error = ${
              event === "error"
                ? sql`substring(coalesce(event.payload_json->>'message', 'Print submission failed') from 1 for 2000)`
                : sql`null`
            }
            where id = try_cast(split_part(event.command_id, ':', 1) as bigint)
              and attempt = try_cast(split_part(event.command_id, ':', 2) as int)
              and destination = ${
              sql.lit(destination.name)
            } and status = 'submitting'`);
            s.commitTransaction();
          }),
      });
    }
  }

  /** Explicit retry; caller must warn that uncertain jobs may already have printed. */
  retry(s: PrintStatements, id: AnyExpr, attempt: AnyExpr) {
    s.modify(
      sql`update db.print_jobs set status = 'queued', started_at = null, finished_at = null, error = null
      where id = ${id} and attempt = ${attempt} and (status = 'failed'
        or (status = 'submitting' and started_at < now() - interval '10 minutes'))`,
    );
  }

  /** Operator verified the output; resolve uncertainty without sending again. */
  confirmPrinted(s: PrintStatements, id: AnyExpr, attempt: AnyExpr) {
    s.modify(
      sql`update db.print_jobs set status = 'submitted', finished_at = now(), error = null
      where id = ${id} and attempt = ${attempt} and (status = 'failed'
        or (status = 'submitting' and started_at < now() - interval '10 minutes'))`,
    );
  }

  static JobsPage(props: { path?: string; canManage: Sql }) {
    const block = useBlock(PrintersBlock);
    return (
      <Route path={props.path ?? "/printers"}>
        <Data
          procedure={(s) =>
            s.defScalar("can_manage_print_jobs", props.canManage)}
        >
          <div className="container mx-auto max-w-6xl p-6 flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">Print jobs</h1>
            <Button onClick={(s) => s.refetch()}>Refresh</Button>
            <p>
              Submitted means handed to the printer, not verified on paper.
              Check the printer before retrying a failed or uncertain job.
            </p>
            <DataTable
              primaryTable="print_jobs"
              recordName="job"
              query={sql`select * from db.print_jobs order by id desc`}
              pageSize={50}
              columns={(b) => {
                b.simpleColumn("name", "Job");
                b.simpleColumn("destination", "Destination");
                b.simpleColumn("content_type", "Format");
                b.simpleColumn("status", "Status");
                b.simpleColumn("attempt", "Attempt");
                b.simpleColumn("created_at", "Queued at");
                b.simpleColumn("finished_at", "Finished at");
                b.simpleColumn("error", "Error");
                b.column(
                  "Actions",
                  ({ record }) => (
                    <Show when={sql`ui.can_manage_print_jobs`}>
                      <Show
                        when={sql`${record}.status = 'failed' or (${record}.status = 'submitting' and ${record}.started_at < now() - interval '10 minutes')`}
                      >
                        <ActionButton
                          confirm={{
                            description:
                              "This job may already have printed. Check the printer before submitting another attempt.",
                          }}
                          action={(s) => {
                            s.throwErrorIf(
                              sql`not ${props.canManage}`,
                              sql.lit`Printing permission required`,
                            );
                            s.startTransaction();
                            block.retry(
                              s,
                              sql`${record}.id`,
                              sql`${record}.attempt`,
                            );
                            s.commitTransaction();
                          }}
                        >
                          Retry
                        </ActionButton>
                        <ActionButton
                          confirm={{
                            description:
                              "Confirm you have checked the physical output. This only resolves the job record; it does not send another print command.",
                          }}
                          action={(s) => {
                            s.throwErrorIf(
                              sql`not ${props.canManage}`,
                              sql.lit`Printing permission required`,
                            );
                            s.startTransaction();
                            block.confirmPrinted(
                              s,
                              sql`${record}.id`,
                              sql`${record}.attempt`,
                            );
                            s.commitTransaction();
                          }}
                        >
                          Confirmed printed
                        </ActionButton>
                      </Show>
                      <Show
                        when={sql`${record}.status in ('queued', 'failed')`}
                      >
                        <ActionButton
                          action={(s) => {
                            s.throwErrorIf(
                              sql`not ${props.canManage}`,
                              sql.lit`Printing permission required`,
                            );
                            s.startTransaction();
                            s.modify(
                              sql`update db.print_jobs set status = 'cancelled', finished_at = now()
                    where id = ${record}.id and attempt = ${record}.attempt and status in ('queued', 'failed')`,
                            );
                            s.commitTransaction();
                          }}
                        >
                          Cancel
                        </ActionButton>
                      </Show>
                    </Show>
                  ),
                  { field: "status" },
                );
              }}
            />
          </div>
        </Data>
      </Route>
    );
  }
}
