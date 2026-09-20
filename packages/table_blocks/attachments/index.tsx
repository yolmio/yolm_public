import { ListItemDecorator } from "components/list";
import { MaterialIcon } from "components/material_icon";
import { AuthApiICtxKey } from "std/ictx";
import type { AuthApiICtx } from "std/ictx";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { system, TableBlock } from "std/system";
import type { Table, TableBuilder } from "std/system";
import { useApp, useOptionalICtx } from "std/ui";
import { AttachmentsCard } from "./attachments_card";

/**
 Add a related attachments table to the given main table.

 The attachments table is named `${singularize(mainTable)}_attachments`, has a
 foreign key to the main table, and the following fields:
 - `name`: string
 - `blob`: blob ref (the stored file)
 - `content_type`: string (MIME type)
 - `size`: bigUint (byte count)

 Each registered app gets a `GET /api/<table>/{blob_id}` endpoint that streams the
 blob back (see {@link populate}). Use the {@link AttachmentsCard} component to
 display and manage the attachments.

 @category Block
 */
export class AttachmentsTableBlock extends TableBlock {
  #tableName?: string;
  #table?: Table;
  appsToAddApiEndpointsFor = new Map<string, AuthApiICtx | undefined>();

  constructor(tableName: string, opts = {}) {
    super(tableName, opts);
  }

  initialize(mainTable: TableBuilder) {
    this.#tableName = `${singularize(mainTable.name)}_attachments`;
    system.db.table(`${singularize(mainTable.name)}_attachments`, (table) => {
      // until we have the ability to generate sample images or files, we skip sample data
      table.sampleData({
        skipSampleData: true,
      });
      table.fk(mainTable.name).notNull();
      table.string("name", 100).notNull();
      table.blobRef("blob", 64).notNull();
      table.string("content_type", 100);
      table.bigUint("size").notNull();
    });
  }

  /** The generated `*_attachments` table. */
  get table() {
    if (!this.#table) {
      this.#table = system.db.tables[this.#tableName!];
    }
    return this.#table!;
  }

  /**
   * SQL expression for the download URL of a stored attachment, matching the
   * endpoint registered in {@link populate}. Pass the row's `blob` value.
   */
  getAttachmentUrl(blobId: Sql) {
    return sql.concat("/api/", this.#table!.getBaseUrl(), "/", blobId);
  }

  /**
   * Record the current app (and its optional auth context) so {@link populate}
   * adds a download endpoint for it. Call from within an app that renders the
   * attachments UI.
   */
  registerAppUsage() {
    const app = useApp();
    const authCtx = useOptionalICtx(AuthApiICtxKey);
    this.appsToAddApiEndpointsFor.set(app.domain, authCtx);
  }

  /**
   * Register a `GET /<table>/{blob_id}` blob-download endpoint on every app
   * recorded via {@link registerAppUsage}, returning the file bytes with its
   * content type and a long immutable cache header (404 if not found).
   */
  override populate() {
    const attachmentTable = this.table;
    for (const [domain, authCtx] of this.appsToAddApiEndpointsFor) {
      const api = system.api({ prefix: "/api", domain });
      api.get(`/${attachmentTable.getBaseUrl()}/{blob_id:uuid}`, {
        procedure: (s) => {
          if (authCtx) {
            authCtx.authenticate(s);
          }
          s.defRecord(
            "attachment",
            sql`select * from db.${attachmentTable.ident} where blob = blob_id`,
          );
          s.if(sql`attachment.id is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(sql.lit`Content-Type`, sql`attachment.content_type`);
          s.setHeader(
            sql.lit`Cache-Control`,
            sql.lit`max-age=31536000, immutable`,
          );
          s.returnBlob(sql`attachment.blob`);
        },
      });
    }
  }

  /** The {@link AttachmentsCard} component, exposed on the block for convenience. */
  static AttachmentsCard = AttachmentsCard;

  /** Detail-page tab ("Attachments") that renders the {@link AttachmentsCard}. */
  override getDetailTab() {
    return {
      value: "attachments",
      header: (
        <>
          <ListItemDecorator>
            <MaterialIcon icon="Attachment" />
          </ListItemDecorator>
          Attachments
        </>
      ),
      content: <AttachmentsCard />,
    };
  }
}
