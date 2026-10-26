import { type Sql, sql } from "std/sql_utils";
import {
  buildCapabilityCatalogEntry,
  type RegisterReactorsOpts,
  sparkCurrentUserExpr,
  sparkDocumentIndexForUser,
  sparkRootInstructionsExpr,
  sparkSkillIndexExpr,
} from "./agent";

/** Technical reference for external clients, independent of native prompts. */
export function sparkMcpInstructions(
  opts: RegisterReactorsOpts,
  readOnly = false,
): Sql {
  let catalog: Sql = sql`''`;
  for (const cap of opts.capabilities) {
    if (cap.internal) continue;
    catalog = sql`${catalog} || case
      when spark_js_conv_capabilities @> json_build_array(${sql.lit(cap.name)})
      then chr(10) || ${sql.lit(buildCapabilityCatalogEntry(cap))}
      else '' end`;
  }
  const reference = `# Yolm Spark API reference

Setup and API overview: https://yolm.ai/mcp.
Public documentation: https://github.com/yolmio/yolm_public/tree/main/docs.
Tenant-specific schemas and capabilities are available through this connection.
Spark exposes business data, help, and capabilities, not the source code of the
system's applications.

execRead runs read-only JavaScript in a fresh V8 isolate without direct filesystem
or network access. Application APIs are under tools.*. text(value) emits text;
image(bytes) emits an image. Text output is limited to 40,000 characters per call;
the complete response is limited to 16 MiB. Calls are asynchronous.

tools.query(sql) or tools.query({sql,maxRows?,file?}) returns CSV in data.
tools.searchHelp({query,limit?}) greps this system's Studio help (section titles, text, and
video chapters) and returns matching lines; an empty query lists sections.
tools.readHelpDocument({documentId}) returns ordered sections, markdown, and media with kind,
chapters ({timeMs,title}), and URLs relative to the application. Both are read-only and
require no selected session.
tools.showHelpMedia({documentId,mediaId,startMs?}) shows a help video or image as a card in
the session, opening a video at startMs with its chapters, and returns link, which opens the
video at that time in a browser. After answering a how-to question from help, give the user
the session's url to watch it there, or the link when there is no session.
tools.readCapability(name) returns markdown with exact schemas and API signatures;
tools.readCapability({name,section:"schema",resource}) reads one table or view schema;
a table read adds virtual field SQL, constraints, display name, and enum value meanings.
tools.capabilityName.functionName(input) calls a granted capability function.
Runtime permissions and the selected session's capabilities limit access.

tools.listFiles(path?) lists workspace-relative paths; tools.readFile(path)
returns markdown. System/SQL contains SQL syntax documentation. The
organization's workspace AGENTS.md and skill catalog, when present, are listed
after the capability catalog.
tools.listArtifacts() and tools.readArtifact({id}) read saved session results.
An optional sessionId on execRead loads the selected session's task context.

tools.downloadFile({data,filename,mimeType}) exports generated text;
tools.downloadDriveFile({versionId}) returns a link for an authorized immutable
Drive version. Download links expire after 30 minutes and include their own
authorization; changing URL parameters invalidates them.

${
    readOnly
      ? "This read-only grant exposes list_sessions and execRead. It cannot create sessions, execute or propose actions, save artifacts, or upload files."
      : `create_session creates a work session; list_sessions lists existing sessions.
exec requires sessionId and runs JavaScript with write access. The same session
can be reused across calls. Scripts are not atomic, and each action call creates
a new receipt; retrying after a lost response can repeat an operation.
tools.capabilityName.actionName(input) invokes a granted action. Reversible actions
execute immediately; approval actions create proposals reviewed in the linked
Spark session. An external client cannot approve these proposals.
tools.actionReceipt({receiptId}) reads a receipt; tools.undoReceipt({receiptId})
undoes that receipt's reversible changes. tools.previewUndo({receiptIds}) returns
conflict analysis; tools.undoReceipts({preview}) uses that exact preview for
atomic bulk undo. These receipt tools, including the read-only previewUndo, need
exec and its sessionId; execRead rejects them. Bulk undo waits for the session's
other running work, including other exec calls, but not for the calling exec.
tools.saveArtifact({name,mimeType,bytes|text}) saves a session result;
tools.createMessage({message}) explicitly saves a work note.
tools.prepareDriveUpload({spaceId,parentId?,filename,mimeType}) creates an upload;
{itemId,filename,mimeType} creates a revision. The returned POST URL accepts raw
file bytes. Drive permissions and extension policies still apply.
Yolm records external executions, submitted code, actions and saved work; no
native inference is started. The client conversation is not copied automatically.`
  }

Available capabilities (evaluated at initialization):`;
  const rootInstructions = sparkRootInstructionsExpr(opts.workspace, sql`''`);
  return sql`${sql.lit(reference)} || ${catalog}
    || chr(10) || chr(10) || 'Connected as: '
    || ${sparkCurrentUserExpr(opts, sql`spark_js_owner_id`)}
    || case when ${rootInstructions} = '' then '' else
      chr(10) || chr(10) || '# Organization reference (workspace AGENTS.md)'
      || chr(10) || ${
    sql.lit(
      "Authored by this organization for Spark work; it describes the business and its conventions.",
    )
  } || chr(10) || chr(10) || ${rootInstructions} end
    || ${
    sparkSkillIndexExpr(
      opts.workspace,
      "Workspace skills authored by this organization. Each is a SKILL.md readable with tools.readFile(path).",
    )
  } || ${
    opts.knowledge
      ? sparkDocumentIndexForUser(opts.knowledge, sql`spark_js_owner_id`)
      : sql`''`
  }`;
}
