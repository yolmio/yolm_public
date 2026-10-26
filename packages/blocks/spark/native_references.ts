export interface SparkNativeReference {
  path: string;
  description: string;
  markdown: string;
}

export const SPARK_NATIVE_REFERENCES: SparkNativeReference[] = [
  {
    path: "System/UI",
    description:
      "Build compact, responsive Yolm dashboards with StatRow, charts, DataTable, and CSS grid.",
    markdown: `# Build a Spark UI

Pass a complete raw TSX module directly to \`render_ui\`. The tool input starts
with the module imports and ends with the exported component's closing brace.

Inspect the data with \`tools.query\` first. Use row count, category cardinality,
order, nulls, and numeric range to choose the presentation. A polished decision
view usually has 2-4 headline metrics, one chart, and one short detail table.

- Compose the dashboard with a responsive 12-column CSS grid and Tailwind-style
  classes. Use \`min-w-0\` and \`overflow-hidden\` on chart and table sections.
- Use \`StatRow\` with its \`stats\` prop for 2-4 query-backed metrics. A title
  is \`sql.lit("Label")\`. A value is a scalar SQL expression, with a query
  written as a parenthesized scalar subquery, as shown below.
- Use a bar chart for 3-8 ranked categories, a line chart for an ordered time
  series, and a pie chart for 2-6 non-negative parts of a whole.
- Give comparable non-negative bars a zero baseline with \`minValue={0}\`.
  When the largest value exceeds three times the second largest, feature the
  leader as a stat and chart the remaining comparison, or use a clearly labeled
  logarithmic scale.
- Size a full-width Spark chart at 600×300. Format values with
  \`format.decimal\`, \`format.currency\`, \`format.percent\`, and
  \`format.date\`.
- Use \`DataTable\` for the 5-8 rows that best support the decision. Select the
  useful fields, use short headers, and format every numeric and date cell. A
  compact table uses an SQL \`limit\`; a browsable table uses \`pageSize\` with
  an unbounded query.
- Represent JavaScript strings inside SQL with \`sql.lit(stringValue)\`.
  Interpolate JavaScript numbers and booleans into an \`sql\` template. SQL
  literals written directly inside the template are ready to use.

## Dashboard pattern

The example shows the preferred composition. Apply the same structure with the
views and fields from loaded capabilities.

\`\`\`tsx
import { StatRow } from "components/stat_row";
import { DataTable } from "components/data_table";
import { BarChart } from "vis/bar_charts";
import { sql } from "std/sql_utils";

export default function Ui() {
  const periodStart = sql.lit("2026-01-01");

  return (
    <div className="grid grid-cols-12 gap-4 p-4">
      <StatRow
        className="col-span-12"
        stats={[
          {
            title: sql.lit("Revenue"),
            value: sql\`(select sum(revenue)
              from spark_v_category_revenue
              where month >= \${periodStart})\`,
            formatValue: (value) =>
              sql\`format.currency(\${value}, 'USD')\`,
          },
          {
            title: sql.lit("Customers"),
            value: sql\`(select count(*) from spark_v_customers)\`,
            formatValue: (value) => sql\`format.decimal(\${value})\`,
          },
          {
            title: sql.lit("At risk"),
            value: sql\`(select count(*) from spark_v_inventory_risk where projected_gap > 0)\`,
          },
        ]}
      />

      <section className="col-span-12 min-w-0 overflow-hidden rounded-lg border border-neutral-200 p-4">
        <h2 className="mb-3 text-base font-semibold">Revenue by category</h2>
        <BarChart
          query={sql\`select category as label, revenue as value
            from spark_v_category_revenue
            order by value desc
            limit 8\`}
          layout="horizontal"
          width={600}
          height={300}
          minValue={0}
          padding={{ top: 16, right: 24, bottom: 40, left: 140 }}
        >
          <BarChart.XAxisLabels
            format={(value) => sql\`format.currency(\${value}, 'USD')\`}
          />
          <BarChart.YAxisLabels columnName="label" />
          <BarChart.CartesianGrid />
          <BarChart.Bar columnName="value" fill="#2563eb" />
          <BarChart.Tooltip />
        </BarChart>
      </section>

      <section className="col-span-12 min-w-0 overflow-hidden rounded-lg border border-neutral-200">
        <DataTable
          size="sm"
          header={<h2 className="text-base font-semibold">Highest risk</h2>}
          query={sql\`select product, projected_stock, reorder_level, projected_gap
            from spark_v_inventory_risk
            where projected_gap > 0
            order by projected_gap desc
            limit 6\`}
          columns={(b) => {
            b.simpleColumn("product", "Product");
            b.formatColumn("projected_stock", (value) =>
              sql\`format.decimal(\${value}, maximum_fraction_digits => 0)\`,
              "Projected stock", {
              align: "right",
            });
            b.formatColumn("reorder_level", (value) =>
              sql\`format.decimal(\${value}, maximum_fraction_digits => 0)\`,
              "Reorder level", {
              align: "right",
            });
            b.formatColumn("projected_gap", (value) =>
              sql\`format.decimal(\${value}, maximum_fraction_digits => 0)\`,
              "Gap", { align: "right" });
          }}
          emptyState="No projected shortages"
        />
      </section>

    </div>
  );
}
\`\`\`

Query granted views by registered name and granted tables as \`db.<table>\`.
For computed table queries, use \`b.simpleColumn\`, \`b.formatColumn\`, or
\`b.column\`. \`b.usdColumn\`, \`b.decimalColumn\`, and \`b.dateColumn\` provide
concise standard formatting. The date signature is
\`b.dateColumn("month", "%b %Y", "Month")\`. Use \`b.field\` with a matching
\`primaryTable\`. When a capability function returns a compact analysis
snapshot, place its rows in a SQL \`values\` query so the narrative, metrics,
and table share the same figures.

For an interactive next step, a \`Button\` can emit \`spark.request\` with a
clear \`message\` and the selected record IDs and scenario values. The host
starts a normal Spark turn, which can inspect current data and create the
capability action proposal for approval.

\`\`\`tsx
import { Button } from "components/button";

<Button
  color="primary"
  onClick={(s) => {
    s.emitDynamicInternalEvent(
      sql.lit("spark.request"),
      sql\`json_build_object(
        'message', 'Prepare the selected change for approval',
        'record_id', 42,
        'proposed_value', 12.50
      )\`,
    );
  }}
>
  Review change
</Button>
\`\`\``,
  },
  {
    path: "System/SQL",
    description:
      "Specialized Yolm SQL and query-planning guidance for dialect or planning questions.",
    markdown: `# Spark SQL

Spark is largely PostgreSQL-compatible, so use ordinary SQL unless a
capability guide shows a Yolm-specific form.

- \`tools.query\` runs a read-only \`SELECT\` and returns CSV in \`result.data\`.
- Loaded capability documents provide the granted views, tables, fields, and
  exact view definitions.
- Use \`true\` and \`false\` for booleans.
- Choose descriptive aliases such as \`ord\`, \`client\`, and \`invoice\`;
  \`s\`, \`db\`, and \`ui\` are Yolm scope prefixes.
- Yolm date helpers commonly use forms such as \`date.trunc(month, value)\`,
  \`date.add(day, amount, value)\`, and \`date.diff(day, start, finish)\`.
- The columnar engine rewards bounded projections and documented aggregate
  views.

Validator feedback supplies exact correction context; apply it directly and
retry the purposeful query.`,
  },
  {
    path: "System/Actions",
    description: "How capability actions, approval, and questions behave.",
    markdown: `# Spark actions and blockers

Capability actions are exposed as
\`tools.<capability>.<action>(input)\`. The capability reference identifies the
execution mode. Approval actions create a proposal and pause for approval or
the run's configured policy. Reversible actions execute automatically and
produce a transaction-backed receipt.

Load the capability first and use its exact input schema. Batch related actions
in one \`exec\` program. Report execution only when a later turn supplies its
resolved action state. Use \`tools.undoLastChanges()\` when the user asks to
reverse the most recent reversible Spark action batch; do not synthesize an
inverse with another domain action. It refuses when later work makes a clean
undo unsafe.

\`tools.askQuestions(...)\` pauses for user input. Give questions and action
proposals dedicated programs so each transition is clear.`,
  },
  {
    path: "System/Files",
    description:
      "Read capability files: file binding, PDF text and images, and Excel SQL examples.",
    markdown: `# Capability files\n\n` +
      `Bind one discovered file to a query with ` +
      `\`tools.query({ sql, file: { source, id } })\`. That query receives a ` +
      `one-row local table \`source_file(file_bytes, file_name, mime_type)\`. ` +
      `PDF table-function examples: ` +
      `\`SELECT * FROM pdf.pages((SELECT file_bytes FROM source_file))\`, ` +
      `\`SELECT * FROM pdf.text((SELECT file_bytes FROM source_file))\`, and ` +
      `\`SELECT * FROM pdf.text_positioned((SELECT file_bytes FROM source_file), 1, 1568)\`. ` +
      `Every PDF render width, including the width argument to ` +
      `\`pdf.text_positioned\`, must be an integer from 1 through 4096; use ` +
      `4096 for maximum detail. ` +
      `For Excel, list sheets with \`SELECT * FROM xlsx.sheets((SELECT file_bytes FROM source_file))\`, ` +
      `then read one with \`SELECT * FROM xlsx.rows((SELECT file_bytes FROM source_file), 'Sheet1')\`. ` +
      `Rows expose zero-based \`ordinal\` and columns \`field_0\` through \`field_49\`; inspect rows before choosing headers. Read PNG, JPEG, or WebP ` +
      `pixels with \`tools.readFileImage({ source, id })\`. To render a PDF, call ` +
      `\`tools.readFileImage({ source, id, page, width, crop?, renderMode?, outputWidth? })\`; ` +
      `\`width\` must be an integer from 320 through 4096. ` +
      `\`renderMode\` is \`"annotated"\` by default or \`"original"\` for ` +
      `the untouched source page. Crop is \`{ x, y, width, height }\` in ` +
      `the full-page pixel space selected by the required top-level \`width\`; ` +
      `for example, \`{ width: 4096, crop: { x, y, width, height } }\`. ` +
      `The crop's own width does not select that coordinate space. For an ` +
      `original PDF crop, optional maximum \`outputWidth\` ` +
      `must be an integer from 64 through 4096 and renders that source region ` +
      `directly at the largest aspect-preserving size within the render limit instead of ` +
      `enlarging a full-page raster. Returned image bytes expose the actual ` +
      `\`renderWidth\`, \`renderHeight\`, \`outputWidth\`, \`outputHeight\`, and ` +
      `\`crop\` used.\n`,
  },
  {
    path: "System/Help",
    description:
      "Answer how-to questions from this system's help documents and show their videos.",
    markdown: `# Help documents

Search help before describing how to do something in the application; do not
reconstruct UI steps from memory. \`tools.searchHelp({ query, limit? })\` greps
help case-insensitively for \`query\` as written and returns matching lines in
document order: \`{ documentId, title, sectionId, sectionTitle, kind, line }\`.
\`kind\` is \`title\` ("Document › Section"), \`text\` (a Markdown line), or
\`chapter\` (a video chapter, with \`mediaId\` and \`timeMs\`). Search for one or
two distinctive words, not the whole question, and try a synonym when nothing
matches. An empty query lists every section.

\`tools.readHelpDocument({ documentId })\` returns ordered sections with
markdown and media. Each media item has \`mediaId\`, \`kind\` (\`video\` or
\`image\`), a \`description\`, and, for recorded demos, \`chapters\`
(\`[{ timeMs, title, description }]\`).

Answer with the steps from the section as a short numbered list, then name the
guide and section they came from. When the section has a video, call
\`tools.showHelpMedia({ documentId, mediaId, startMs? })\` to show it in the
conversation; set \`startMs\` to the chapter that covers the user's step, and
mention that chapter by name. Show at most one video per answer unless the user
asks for more. If help has nothing relevant, say so instead of guessing.`,
  },
  {
    path: "System/Attachments",
    description:
      "Reading text, spreadsheets, documents, PDFs, and images attached to a run.",
    markdown: `# Spark attachments and documents

Use \`tools.listAttachments()\` to inspect uploads and
\`tools.readAttachment(...)\` to get a \`Uint8Array\`. DOCX parsing can use
the bundled \`mammoth\` module inside \`exec\`. Import Mammoth with
\`const mammoth = (await import("mammoth")).default;\`.
Keep raw bytes in JavaScript and emit the extracted text, data, or image.

For an attached \`.xlsx\` or \`.xls\`, inspect its worksheets before choosing
a header row:

\`\`\`js
const workbook = await tools.inspectSpreadsheet("report.xlsx");
text(workbook.sheets.map(({ name, rowCount, columnCount, preview }) => ({
  name,
  rowCount,
  columnCount,
  preview,
})));
\`\`\`

\`inspectSpreadsheet(idOrName)\` accepts optional \`previewRows\` (maximum 20)
and \`previewColumns\` (maximum 30). It returns at most 50 worksheets.

Read a selected sheet with bounded pagination:

\`\`\`js
const page = await tools.readSpreadsheet({
  name: "report.xlsx",
  sheet: "Data",       // exact name, or a zero-based sheet index
  headerRow: 2,         // one-based worksheet row
  offset: 0,            // physical rows after the header
  limit: 200,           // maximum 1,000
});
\`\`\`

Each returned row has \`values\`, \`display\`, and \`kinds\` objects keyed by
a unique column key. \`values\` contains JSON-safe raw values; dates are ISO
8601 and spreadsheet percentages remain numeric fractions. \`display\`
preserves the workbook's visible formatting such as \`$125,000\` or
\`98.5%\`. \`kinds\` identifies \`blank\`, \`boolean\`, \`currency\`, \`date\`,
\`error\`, \`number\`, \`percentage\`, or \`text\`. Duplicate headers receive
suffixes such as \`Amount (2)\`; blank headers become \`Column N\`. Formula
cells include the formula separately and use the workbook's cached value.
Follow \`nextOffset\` until it is null when more rows are needed. Never print
an entire large sheet; transform bounded pages and send normalized records to
the relevant domain action.

For PDF conversation attachments, try \`tools.readPdfText(...)\` first. When
drawing layout matters, request one page with
\`{ page, mode: "positioned", width }\` to receive bounded
\`text, x, y, w, h\` runs in the same pixel space as rendering. Use
\`tools.renderPdfPage(...)\` when the attachment is scanned or pixels are
needed; the result is a PNG \`Uint8Array\`. Zoom into a rendered detail with
\`tools.renderPdfPage({ id, page, width, crop: { x, y, width, height } })\`.

Pass PNG, JPEG, or WebP bytes to \`image(...)\` in the same execution:

\`image(await tools.readAttachment("photo.png"))\`

\`image(await tools.renderPdfPage({ id: 12, page: 1 }))\`

For generated bytes, specify the type explicitly:
\`image(bytes, { mimeType: "image/png", detail: "auto" })\`.

\`readPdfText\` and \`renderPdfPage\` only read conversation attachments. For a
capability-owned project PDF, bind its authorized bytes with
\`tools.query({ sql, file: { source, id } })\`, call the SQL table functions
\`pdf.pages\`, \`pdf.text\`, or \`pdf.text_positioned\` with
\`(select file_bytes from source_file)\`, and inspect pixels through
\`tools.readFileImage({ source, id, page, width, crop?, renderMode?, outputWidth? })\`.
The returned image bytes expose the actual \`renderWidth\`, \`renderHeight\`,
\`outputWidth\`, \`outputHeight\`, and \`crop\` used, so calibration and follow-up
analysis can use the emitted image's real coordinate frame.
PDF rendering defaults to \`"annotated"\`; pass \`"original"\` for the untouched
source page. Crop coordinates use the full-page pixel space selected by the
required top-level \`width\`; \`outputWidth\` is valid only with a crop and
controls the emitted crop size.
Sources with saved presentation data also expose
\`tools.readFileMarkup({ source, id, page? })\`. Governed company documents are
loaded with
\`tools.loadDocument(...)\`; passing \`renderPage\` returns PNG bytes.`,
  },
];
