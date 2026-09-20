import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { system } from "std/system";

export const MAX_SERVER_EMAIL_ATTACHMENT_COUNT = 20;
export const MAX_SERVER_EMAIL_ATTACHMENT_BYTES = 2_999_999;
export const MAX_SERVER_EMAIL_ATTACHMENTS_TOTAL_BYTES = 10_000_000;

const attachmentInputFields: HelperProcField[] = [
  { name: "id", type: "BigInt" },
  { name: "filename", type: "String" },
  { name: "content_type", type: "String" },
  { name: "size_bytes", type: "BigInt" },
  { name: "blob", type: { type: "Bytes", maxLength: 64 } },
];

/** Loads blob-backed runtime attachment rows into provider-ready base64. */
export function defineServerEmailAttachments<T extends IServerBaseStatements>(
  s: T,
  query: Sql,
  prefix: string,
) {
  const input = `${prefix}_attachment_inputs`;
  const output = `${prefix}_attachments`;
  const summaryName = `${prefix}_attachment_summary`;
  s.defRecord(
    summaryName,
    sql`select
        count(*) as attachment_count,
        coalesce(sum(size_bytes), 0) as total_size_bytes,
        count(*) filter (
          where size_bytes is null
            or size_bytes > ${MAX_SERVER_EMAIL_ATTACHMENT_BYTES}
        ) as invalid_size_count
      from (${query}) attachment_source`,
  );
  s.throwErrorIf(
    sql`${sql.ref(summaryName, "attachment_count")} >
      ${MAX_SERVER_EMAIL_ATTACHMENT_COUNT}`,
    sql.lit`Email attachments are limited to 20 files.`,
  );
  s.throwErrorIf(
    sql`${sql.ref(summaryName, "invalid_size_count")} > 0`,
    sql.lit`Each email attachment must be smaller than 3 MB.`,
  );
  s.throwErrorIf(
    sql`${sql.ref(summaryName, "total_size_bytes")} >
      ${MAX_SERVER_EMAIL_ATTACHMENTS_TOTAL_BYTES}`,
    sql.lit`Email attachments are limited to 10 MB in total.`,
  );
  s.defTable(input, { fields: attachmentInputFields });
  s.modify(
    sql`insert into ${
      sql.ref(input)
    } select id, filename, content_type, size_bytes, blob from (${query}) attachment_source`,
  );
  s.callStoredProcedure("email_load_server_attachments", {
    inputTables: { attachments: input },
    outputTables: { loaded_attachments: output },
  });
  return output;
}

/** Registers the bounded blob-loading boundary shared by Gmail and Outlook. */
export function registerServerEmailAttachmentProcedure() {
  if (
    system.storedProcedures.some((p) =>
      p.name === "email_load_server_attachments"
    )
  ) return;
  system.storedProcedure({
    name: "email_load_server_attachments",
    transaction: "caller",
    inputTables: [{ name: "attachments", fields: attachmentInputFields }],
    outputTables: [{
      name: "loaded_attachments",
      fields: [
        { name: "id", type: "BigInt", notNull: true },
        {
          name: "filename",
          type: { type: "String", maxLength: 255 },
          notNull: true,
        },
        {
          name: "content_type",
          type: { type: "String", maxLength: 255 },
          notNull: true,
        },
        {
          name: "content",
          type: { type: "String", maxLength: 4_000_000 },
          notNull: true,
        },
      ],
    }],
    procedure: (s) => {
      loadServerEmailAttachments(s, sql`select * from attachments`, "loaded");
    },
  });
}

function loadServerEmailAttachments<T extends IServerBaseStatements>(
  s: T,
  query: Sql,
  prefix: string,
) {
  const tableName = `${prefix}_attachments`;
  const recordName = `${prefix}_attachment`;
  const bytesName = `${prefix}_attachment_bytes`;
  s.forEachQuery(query, recordName, (s) => {
    s.readBlob(sql.ref(recordName, "blob"), {
      defContentScalar: bytesName,
    });
    s.throwErrorIf(
      sql`octet_length(${sql.ref(bytesName)}) !=
        ${sql.ref(recordName, "size_bytes")}`,
      sql.lit`An email attachment changed after it was saved.`,
    );
    s.modify(sql`insert into ${sql.ref(tableName)} (
        id, filename, content_type, content
      ) values (
        ${sql.ref(recordName, "id")},
        ${sql.ref(recordName, "filename")},
        ${sql.ref(recordName, "content_type")},
        bytes.to_base64(${sql.ref(bytesName)})
      )`);
  });
  return tableName;
}
