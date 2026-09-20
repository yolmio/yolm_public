// deno-lint-ignore-file no-undef

import * as XLSX from "xlsx";
import {
  downloadUrl,
  fetchLimited,
  moduleResult,
  parseArgs,
  previewPart,
  requiredMount,
} from "../_drive_preview/common";

const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 150;
const instances = new Map();

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellText(cell) {
  if (!cell) return "";
  if (cell.w !== undefined && cell.w !== null) return String(cell.w);
  if (cell.v === undefined || cell.v === null) {
    return cell.f ? `=${cell.f}` : "";
  }
  if (cell.v instanceof Date) return cell.v.toLocaleString();
  return String(cell.v);
}

function cellTitle(cell) {
  if (!cell?.f) return "";
  return `Formula (not calculated here): =${cell.f}`;
}

class SpreadsheetViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId, "spreadsheet viewer");
    const layout = getComputedStyle(this.mount);
    this.rowHeight = parseFloat(
      layout.getPropertyValue("--preview-row-height"),
    );
    this.rowHeaderWidth = parseFloat(
      layout.getPropertyValue("--preview-row-header-width"),
    );
    this.columnWidth = parseFloat(
      layout.getPropertyValue("--preview-column-width"),
    );
    this.fileUrl = fileUrl;
    this.fileName = fileName || "workbook.xlsx";
    this.abortController = new AbortController();
    this.listeners = [];
    this.destroyed = false;
    this.renderFrame = null;
  }

  async initialize() {
    const buffer = await fetchLimited(
      this.fileUrl,
      MAX_WORKBOOK_BYTES,
      this.abortController.signal,
      "This workbook",
    );
    if (this.destroyed) return;
    this.workbook = XLSX.read(buffer, {
      bookVBA: true,
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      type: "array",
    });
    if (!this.workbook.SheetNames.length) {
      throw new Error("This workbook contains no worksheets.");
    }
    this.build();
    this.selectSheet(this.workbook.SheetNames[0]);
    emit("ready", {
      handle: this.handle,
      json: { sheetCount: this.workbook.SheetNames.length },
    });
  }

  build() {
    this.mount.innerHTML = "";
    previewPart(this.mount, "sheet-mount");
    this.viewport = previewPart(
      document.createElement("div"),
      "sheet-viewport",
    );
    this.spacer = previewPart(document.createElement("div"), "sheet-spacer");
    this.viewport.append(this.spacer);
    this.listen(this.viewport, "scroll", () => this.scheduleRender());
    this.mount.append(this.viewport);
  }

  selectSheet(name) {
    if (!this.workbook.SheetNames.includes(name)) return;
    this.sheet = this.workbook.Sheets[name];
    const rawRange = this.sheet["!ref"] || "A1:A1";
    let range;
    try {
      range = XLSX.utils.decode_range(rawRange);
    } catch {
      range = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
    }
    this.startRow = Math.max(0, range.s.r);
    this.startColumn = Math.max(0, range.s.c);
    this.rowCount = Math.min(
      MAX_ROWS,
      Math.max(1, range.e.r - this.startRow + 1),
    );
    this.columnCount = Math.min(
      MAX_COLUMNS,
      Math.max(1, range.e.c - this.startColumn + 1),
    );
    const truncated = range.e.r - this.startRow + 1 > MAX_ROWS ||
      range.e.c - this.startColumn + 1 > MAX_COLUMNS;
    const macroWorkbook = /\.xlsm$/i.test(this.fileName) ||
      Boolean(this.workbook.vbaraw);
    const messages = [
      "Read-only preview. Values are shown as saved in the file.",
    ];
    if (macroWorkbook) messages.unshift("Macros are turned off.");
    if (truncated) {
      messages.push(
        `Preview limited to ${MAX_ROWS.toLocaleString()} rows and ${MAX_COLUMNS} columns.`,
      );
    }
    emit("stateChanged", {
      handle: this.handle,
      json: {
        sheets: this.workbook.SheetNames.map((name) => ({ name })),
        sheet: name,
        notice: messages.join(" "),
        summary:
          `${this.rowCount.toLocaleString()} rows × ${this.columnCount} columns`,
      },
    });
    this.spacer.style.width = `${
      this.rowHeaderWidth + this.columnCount * this.columnWidth
    }px`;
    this.spacer.style.height = `${
      this.rowHeight + this.rowCount * this.rowHeight
    }px`;
    this.viewport.scrollTop = 0;
    this.viewport.scrollLeft = 0;
    this.renderVisibleRows();
  }

  scheduleRender() {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderVisibleRows();
    });
  }

  renderVisibleRows() {
    this.spacer.replaceChildren();
    const header = previewPart(document.createElement("div"), "sheet-header");
    header.append(this.makeCell("", this.rowHeaderWidth, true));
    for (let column = 0; column < this.columnCount; column++) {
      header.append(
        this.makeCell(
          columnName(this.startColumn + column),
          this.columnWidth,
          true,
        ),
      );
    }
    this.spacer.append(header);
    const first = Math.max(
      0,
      Math.floor(this.viewport.scrollTop / this.rowHeight) - 2,
    );
    const visible = Math.ceil(this.viewport.clientHeight / this.rowHeight) + 5;
    const last = Math.min(this.rowCount, first + visible);
    for (let row = first; row < last; row++) {
      const rowElement = previewPart(
        document.createElement("div"),
        "sheet-row",
      );
      rowElement.style.setProperty(
        "--preview-row-top",
        `${this.rowHeight + row * this.rowHeight}px`,
      );
      rowElement.append(
        this.makeCell(
          String(this.startRow + row + 1),
          this.rowHeaderWidth,
          true,
        ),
      );
      for (let column = 0; column < this.columnCount; column++) {
        const address = XLSX.utils.encode_cell({
          c: this.startColumn + column,
          r: this.startRow + row,
        });
        const cell = this.sheet[address];
        const cellElement = this.makeCell(
          cellText(cell),
          this.columnWidth,
          false,
        );
        cellElement.title = cellTitle(cell) || cellElement.textContent;
        rowElement.append(cellElement);
      }
      this.spacer.append(rowElement);
    }
  }

  makeCell(text, width, header) {
    const cell = document.createElement("div");
    cell.textContent = text;
    previewPart(cell, "sheet-cell");
    cell.style.setProperty("--preview-cell-width", `${width}px`);
    cell.dataset.header = String(header);
    return cell;
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  download() {
    downloadUrl(this.fileUrl, this.fileName);
  }

  destroy() {
    this.destroyed = true;
    this.abortController.abort();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.mount.innerHTML = "";
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new SpreadsheetViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function download(args) {
  instances.get(args.handle || parseArgs(args).handle)?.download();
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  instances.get(handle)?.destroy();
  instances.delete(handle);
}

function selectSheet(args) {
  const data = parseArgs(args);
  const v = instances.get(args.handle || data.handle);
  if (v?.workbook) v.selectSheet(data.value);
}
registerModule({ initialize, download, cleanup, selectSheet });
