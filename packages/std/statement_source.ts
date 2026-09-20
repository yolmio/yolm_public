export interface StatementSourceOrigin {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  statementId?: number;
}

export interface JsxDevSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

const normalizedFileNames = new Map<string, string | undefined>();
const originsBySourceFile = new Map<
  string,
  Map<number, Map<number, StatementSourceOrigin>>
>();
const statementSourceOriginStack: StatementSourceOrigin[] = [];

function normalizeUserFileName(fileName: string): string | undefined {
  if (normalizedFileNames.has(fileName)) {
    return normalizedFileNames.get(fileName);
  }

  let normalized = fileName.replaceAll("\\", "/");
  if (normalized.startsWith("file://")) {
    normalized = normalized.slice("file://".length);
  } else if (normalized.startsWith("yolm://")) {
    normalized = normalized.slice("yolm://".length);
  }
  normalized = normalized.replace(/^\/+/, "");

  const isFrameworkFile = normalized.includes("/packages/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith("packages/") ||
    normalized.startsWith("node_modules/");
  const result = isFrameworkFile ? undefined : normalized;
  normalizedFileNames.set(fileName, result);
  return result;
}

export function statementSourceOriginFromJsxDev(
  source: JsxDevSource | undefined,
): StatementSourceOrigin | undefined {
  if (
    source === undefined ||
    typeof source.fileName !== "string" ||
    typeof source.lineNumber !== "number" ||
    typeof source.columnNumber !== "number" ||
    !Number.isInteger(source.lineNumber) ||
    !Number.isInteger(source.columnNumber) ||
    source.lineNumber < 1 ||
    source.columnNumber < 1
  ) {
    return undefined;
  }
  const fileName = normalizeUserFileName(source.fileName);
  if (fileName === undefined) {
    return undefined;
  }
  let byLine = originsBySourceFile.get(fileName);
  if (byLine === undefined) {
    byLine = new Map();
    originsBySourceFile.set(fileName, byLine);
  }
  let byColumn = byLine.get(source.lineNumber);
  if (byColumn === undefined) {
    byColumn = new Map();
    byLine.set(source.lineNumber, byColumn);
  }
  let origin = byColumn.get(source.columnNumber);
  if (origin === undefined) {
    origin = {
      fileName,
      lineNumber: source.lineNumber,
      columnNumber: source.columnNumber,
    };
    byColumn.set(source.columnNumber, origin);
  }
  return origin;
}

export function pushStatementSourceOrigin(
  origin: StatementSourceOrigin | undefined,
): boolean {
  if (origin === undefined) {
    return false;
  }
  statementSourceOriginStack.push(origin);
  return true;
}

export function popStatementSourceOrigin(): void {
  statementSourceOriginStack.pop();
}

export function currentStatementSourceOrigin():
  | StatementSourceOrigin
  | undefined {
  return statementSourceOriginStack.at(-1);
}
