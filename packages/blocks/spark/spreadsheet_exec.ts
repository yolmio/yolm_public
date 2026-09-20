export const SPARK_SPREADSHEET_EXEC_HELPERS = String.raw`
let __sparkXlsxModulePromise;
const __sparkLoadXlsx = () => {
  if (__sparkXlsxModulePromise === undefined) {
    __sparkXlsxModulePromise = import("xlsx");
  }
  return __sparkXlsxModulePromise;
};
const __sparkSpreadsheetInteger = (
  value,
  fallback,
  min,
  max,
  label,
  clampMaximum = false,
) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new TypeError(label + " must be an integer of at least " + min);
  }
  if (parsed > max) {
    if (clampMaximum) return max;
    throw new TypeError(label + " must be no more than " + max);
  }
  return parsed;
};
const __sparkSpreadsheetAttachmentInput = (input) => {
  if (input === null || input === undefined) {
    throw new TypeError("A spreadsheet attachment id or name is required");
  }
  if (typeof input !== "object") return input;
  if (input.id !== undefined) return { id: input.id };
  if (input.name !== undefined) return { name: input.name };
  throw new TypeError("A spreadsheet attachment id or name is required");
};
const __sparkOpenSpreadsheet = async (input) => {
  const bytes = await tools.readAttachment(
    __sparkSpreadsheetAttachmentInput(input),
  );
  const metadata = __sparkBinaryMetadata.get(bytes) || {};
  const name = String(metadata.name || "spreadsheet");
  const mimeType = String(metadata.mimeType || "");
  const hasSpreadsheetName = /[.](xlsx|xls)$/i.test(name);
  const hasSpreadsheetMime = /excel|spreadsheet/i.test(mimeType);
  if (!hasSpreadsheetName && !hasSpreadsheetMime) {
    throw new TypeError(
      'Attachment "' + name + '" is not an .xlsx or .xls spreadsheet',
    );
  }
  const XLSX = await __sparkLoadXlsx();
  let workbook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
    });
  } catch (error) {
    throw new Error(
      'Unable to parse spreadsheet "' + name + '": ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    throw new Error('Spreadsheet "' + name + '" has no worksheets');
  }
  return { XLSX, workbook, name, mimeType };
};
const __sparkSpreadsheetRange = (XLSX, sheet) => {
  if (!sheet || !sheet["!ref"]) return null;
  try {
    return XLSX.utils.decode_range(sheet["!ref"]);
  } catch (_) {
    return null;
  }
};
const __sparkSpreadsheetCell = (XLSX, sheet, row, column) => {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[address];
  if (cell === undefined) {
    return { value: null, display: "", kind: "blank" };
  }
  if (cell.v === undefined || cell.v === null) {
    const result = { value: null, display: "", kind: "blank" };
    if (cell.f !== undefined) result.formula = String(cell.f);
    return result;
  }
  let display;
  try {
    display = XLSX.utils.format_cell(cell);
  } catch (_) {
    display = String(cell.w ?? cell.v ?? "");
  }
  const format = String(cell.z || "");
  let kind = "text";
  let value = cell.v;
  if (cell.t === "e") {
    kind = "error";
    value = null;
  } else if (cell.t === "b") {
    kind = "boolean";
    value = Boolean(cell.v);
  } else if (cell.t === "d" || cell.v instanceof Date) {
    kind = "date";
    const date = cell.v instanceof Date ? cell.v : new Date(cell.v);
    const iso = date.toISOString();
    value = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  } else if (cell.t === "n") {
    kind = format.includes("%")
      ? "percentage"
      : /[$€£¥]|\[\$/u.test(format)
      ? "currency"
      : "number";
    value = Number(cell.v);
  } else {
    value = String(cell.v);
  }
  const result = { value, display: String(display ?? ""), kind };
  if (cell.f !== undefined) result.formula = String(cell.f);
  return result;
};
const __sparkSpreadsheetSheet = (opened, requestedSheet) => {
  const names = opened.workbook.SheetNames;
  let index = 0;
  if (requestedSheet !== undefined && requestedSheet !== null) {
    if (typeof requestedSheet === "number") {
      index = __sparkSpreadsheetInteger(
        requestedSheet,
        0,
        0,
        Math.max(0, names.length - 1),
        "sheet",
      );
    } else {
      index = names.indexOf(String(requestedSheet));
      if (index < 0) {
        throw new Error(
          'Worksheet "' + requestedSheet + '" was not found. Available: ' +
            names.join(", "),
        );
      }
    }
  }
  return { index, name: names[index], sheet: opened.workbook.Sheets[names[index]] };
};

tools.inspectSpreadsheet = async (input) => {
  const options = typeof input === "object" && input !== null ? input : {};
  const previewRows = __sparkSpreadsheetInteger(
    options.previewRows,
    8,
    1,
    20,
    "previewRows",
    true,
  );
  const previewColumns = __sparkSpreadsheetInteger(
    options.previewColumns,
    12,
    1,
    30,
    "previewColumns",
    true,
  );
  const opened = await __sparkOpenSpreadsheet(input);
  const sheetNames = opened.workbook.SheetNames;
  const sheets = [];
  for (let index = 0; index < Math.min(sheetNames.length, 50); index += 1) {
    const name = sheetNames[index];
    const sheet = opened.workbook.Sheets[name];
    const range = __sparkSpreadsheetRange(opened.XLSX, sheet);
    const preview = [];
    if (range !== null) {
      const lastRow = Math.min(range.e.r, range.s.r + previewRows - 1);
      const lastColumn = Math.min(
        range.e.c,
        range.s.c + previewColumns - 1,
      );
      for (let row = range.s.r; row <= lastRow; row += 1) {
        const cells = [];
        for (let column = range.s.c; column <= lastColumn; column += 1) {
          cells.push({
            column: opened.XLSX.utils.encode_col(column),
            ...__sparkSpreadsheetCell(opened.XLSX, sheet, row, column),
          });
        }
        preview.push({ rowNumber: row + 1, cells });
      }
    }
    sheets.push({
      name,
      index,
      rowCount: range === null ? 0 : range.e.r - range.s.r + 1,
      columnCount: range === null ? 0 : range.e.c - range.s.c + 1,
      preview,
      previewTruncated: range !== null &&
        (range.e.r >= range.s.r + previewRows ||
          range.e.c >= range.s.c + previewColumns),
    });
  }
  return {
    name: opened.name,
    mimeType: opened.mimeType,
    sheetCount: sheetNames.length,
    sheets,
    sheetsTruncated: sheetNames.length > sheets.length,
  };
};

tools.readSpreadsheet = async (input) => {
  const options = typeof input === "object" && input !== null ? input : {};
  const opened = await __sparkOpenSpreadsheet(input);
  const selected = __sparkSpreadsheetSheet(opened, options.sheet);
  const range = __sparkSpreadsheetRange(opened.XLSX, selected.sheet);
  if (range === null) {
    return {
      name: opened.name,
      mimeType: opened.mimeType,
      sheet: selected.name,
      sheetIndex: selected.index,
      headerRow: 1,
      columns: [],
      rows: [],
      offset: 0,
      limit: 0,
      totalRowCount: 0,
      nextOffset: null,
      columnsTruncated: false,
    };
  }
  const headerRow = __sparkSpreadsheetInteger(
    options.headerRow,
    range.s.r + 1,
    1,
    range.e.r + 1,
    "headerRow",
  );
  const offset = __sparkSpreadsheetInteger(options.offset, 0, 0, 1000000, "offset");
  const limit = __sparkSpreadsheetInteger(
    options.limit,
    200,
    1,
    1000,
    "limit",
    true,
  );
  const headerIndex = headerRow - 1;
  if (headerIndex < range.s.r || headerIndex > range.e.r) {
    throw new RangeError(
      "headerRow is outside worksheet " + selected.name +
        " (rows " + (range.s.r + 1) + "-" + (range.e.r + 1) + ")",
    );
  }
  const firstColumn = range.s.c;
  const lastColumn = Math.min(range.e.c, firstColumn + 149);
  const columns = [];
  const headerCounts = new Map();
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    const cell = __sparkSpreadsheetCell(
      opened.XLSX,
      selected.sheet,
      headerIndex,
      column,
    );
    const headerValue = cell.display !== "" ? cell.display : cell.value ?? "";
    const label = String(headerValue).trim() ||
      "Column " + (column + 1);
    const countKey = label.toLowerCase();
    const count = (headerCounts.get(countKey) || 0) + 1;
    headerCounts.set(countKey, count);
    columns.push({
      key: count === 1 ? label : label + " (" + count + ")",
      label,
      column: opened.XLSX.utils.encode_col(column),
    });
  }
  const firstDataRow = headerIndex + 1;
  const totalRowCount = Math.max(0, range.e.r - firstDataRow + 1);
  const startRow = firstDataRow + offset;
  const endRow = Math.min(range.e.r, startRow + limit - 1);
  const rows = [];
  if (startRow <= range.e.r) {
    for (let row = startRow; row <= endRow; row += 1) {
      const values = {};
      const display = {};
      const kinds = {};
      const formulas = {};
      let populated = false;
      for (let index = 0; index < columns.length; index += 1) {
        const column = firstColumn + index;
        const key = columns[index].key;
        const cell = __sparkSpreadsheetCell(
          opened.XLSX,
          selected.sheet,
          row,
          column,
        );
        values[key] = cell.value;
        display[key] = cell.display;
        kinds[key] = cell.kind;
        if (cell.formula !== undefined) formulas[key] = cell.formula;
        if (cell.kind !== "blank" || cell.formula !== undefined) {
          populated = true;
        }
      }
      if (populated) {
        const result = { rowNumber: row + 1, values, display, kinds };
        if (Object.keys(formulas).length > 0) result.formulas = formulas;
        rows.push(result);
      }
    }
  }
  const scannedRowCount = startRow > range.e.r ? 0 : endRow - startRow + 1;
  const nextOffset = offset + scannedRowCount < totalRowCount
    ? offset + scannedRowCount
    : null;
  return {
    name: opened.name,
    mimeType: opened.mimeType,
    sheet: selected.name,
    sheetIndex: selected.index,
    headerRow,
    columns,
    rows,
    offset,
    limit,
    totalRowCount,
    nextOffset,
    columnsTruncated: range.e.c > lastColumn,
  };
};
`;
