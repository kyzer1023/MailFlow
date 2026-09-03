import ExcelJS from "exceljs";
import type {
  ParsedSpreadsheet,
  RawSpreadsheetRow,
  SpreadsheetColumn,
  SpreadsheetFormat,
  SpreadsheetRecord,
  SpreadsheetTable,
  SpreadsheetWorksheet,
} from "./types";

export type SpreadsheetInput = ArrayBuffer | Uint8Array | string;

export interface ParseSpreadsheetOptions {
  readonly fileName?: string | null;
  readonly format?: SpreadsheetFormat;
  readonly csvDelimiter?: string;
}

export type HeaderRowSelection = number | "auto";

export interface SelectTableOptions {
  readonly worksheet?: number | string;
  readonly headerRow?: HeaderRowSelection;
}

export class SpreadsheetParseError extends Error {
  readonly code:
    | "unsupported_format"
    | "invalid_content"
    | "empty_workbook"
    | "worksheet_not_found"
    | "header_row_not_found";

  constructor(
    code: SpreadsheetParseError["code"],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "SpreadsheetParseError";
    this.code = code;
  }
}

/**
 * Normalize a display header into a stable, safe placeholder key.
 *
 * Keys are intentionally snake_case rather than using the original label.
 * This keeps spaces, punctuation, and locale-specific punctuation out of
 * template expressions while preserving the original label on the column.
 */
export function normalizeHeaderKey(label: string, fallback = "column"): string {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  const safeFallback = fallback
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "column";
  const key = normalized || safeFallback;
  return /^[a-z]/u.test(key) ? key : `${safeFallback}_${key}`;
}

/** Alias with a concise name for mapping controls. */
export const normalizeHeader = normalizeHeaderKey;

/** Normalize headers and suffix collisions deterministically. */
export function normalizeHeaders(labels: readonly string[]): readonly SpreadsheetColumn[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return labels.map((label, index) => {
    const original = String(label);
    const base = normalizeHeaderKey(original, `column_${index + 1}`);
    let count = (seen.get(base) ?? 0) + 1;
    let key = count === 1 ? base : `${base}_${count}`;
    while (used.has(key)) {
      count += 1;
      key = `${base}_${count}`;
    }
    seen.set(base, count);
    used.add(key);
    return {
      key,
      label: original,
      sourceColumn: index + 1,
    };
  });
}

/**
 * Decode an uploaded CSV buffer. UTF-8 is the normal browser format; UTF-16
 * BOMs are accepted as a convenience for files exported by desktop Excel.
 */
export function decodeSpreadsheetText(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Parse a CSV text using RFC 4180-style quoting. Newlines inside quoted cells
 * are retained. The parser is deliberately dependency-free so it remains
 * small in the client bundle and works in a Worker-free browser context.
 */
export function parseCsvText(text: string, delimiter = ","): readonly RawSpreadsheetRow[] {
  if (delimiter.length !== 1) {
    throw new SpreadsheetParseError("invalid_content", "CSV delimiter must be one character.");
  }

  const source = text.replace(/^\uFEFF/u, "");
  if (!source) return [];

  const rows: RawSpreadsheetRow[] = [];
  let values: string[] = [];
  let value = "";
  let inQuotes = false;
  let rowNumber = 1;

  const pushValue = (): void => {
    values.push(value);
    value = "";
  };
  const pushRow = (): void => {
    // A terminal newline does not represent an additional spreadsheet row.
    rows.push({ sourceRow: rowNumber, values: values.slice() });
    values = [];
    rowNumber += 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"' && value.length === 0) {
      inQuotes = true;
    } else if (character === delimiter) {
      pushValue();
    } else if (character === "\n" || character === "\r") {
      // Treat CRLF as one line ending and retain a lone CR as a line ending.
      pushValue();
      pushRow();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }

  if (inQuotes) {
    throw new SpreadsheetParseError("invalid_content", "The CSV contains an unterminated quoted value.");
  }

  if (value.length > 0 || values.length > 0 || (source.length > 0 && !/[\r\n]$/u.test(source))) {
    pushValue();
    pushRow();
  }

  return rows;
}

function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(cellValueToString).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("richText" in record && Array.isArray(record.richText)) {
      return record.richText.map(cellValueToString).join("");
    }
    if ("text" in record && typeof record.text === "string") return record.text;
    if ("result" in record) return cellValueToString(record.result);
    if ("error" in record && typeof record.error === "string") return record.error;
    if ("formula" in record && typeof record.formula === "string") return record.formula;
  }
  return String(value);
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  // Buffer is a Uint8Array view over a pooled Node allocation. Copying via a
  // fresh Uint8Array avoids passing unrelated bytes from that pool to JSZip.
  return new Uint8Array(input).slice().buffer;
}

function worksheetVisibility(state: unknown): SpreadsheetWorksheet["visibility"] {
  if (state === "veryHidden") return "veryHidden";
  if (state === "hidden") return "hidden";
  return "visible";
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): readonly RawSpreadsheetRow[] {
  const rows: RawSpreadsheetRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      values.push(cellValueToString(row.getCell(column).value));
    }
    // ExcelJS may expose a formatting-only row. It is not useful as input,
    // and omitting it avoids creating thousands of empty records in exports.
    if (values.some((item) => item !== "")) rows.push({ sourceRow: rowNumber, values });
  });
  return rows;
}

/** Parse an XLSX ArrayBuffer with ExcelJS in the browser. */
export async function parseXlsx(input: ArrayBuffer | Uint8Array, fileName: string | null = null): Promise<ParsedSpreadsheet> {
  try {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS's browser build accepts ArrayBuffer at runtime while its
    // declaration retains the Node Buffer type. Keep the cast at this adapter
    // boundary so no Node type leaks into the rest of the client API.
    await workbook.xlsx.load(toArrayBuffer(input) as never);
    const worksheets: SpreadsheetWorksheet[] = workbook.worksheets.map((worksheet, index) => ({
      index,
      name: worksheet.name,
      visibility: worksheetVisibility(worksheet.state),
      rows: worksheetToRows(worksheet),
    }));
    if (worksheets.length === 0) {
      throw new SpreadsheetParseError("empty_workbook", "The workbook does not contain a worksheet.");
    }
    return { format: "xlsx", fileName, worksheets };
  } catch (error) {
    if (error instanceof SpreadsheetParseError) throw error;
    throw new SpreadsheetParseError("invalid_content", "The XLSX file could not be read.", { cause: error });
  }
}

/** Parse a CSV input into a workbook-like single worksheet. */
export function parseCsv(
  input: string | ArrayBuffer | Uint8Array,
  options: { readonly fileName?: string | null; readonly delimiter?: string } = {},
): ParsedSpreadsheet {
  const text = typeof input === "string" ? input : decodeSpreadsheetText(input);
  const rows = parseCsvText(text, options.delimiter ?? ",");
  const name = options.fileName?.replace(/\.[^.]+$/u, "") || "Sheet1";
  return {
    format: "csv",
    fileName: options.fileName ?? null,
    worksheets: [{ index: 0, name, visibility: "visible", rows }],
  };
}

function looksLikeXlsx(input: ArrayBuffer | Uint8Array): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function inferFormat(input: SpreadsheetInput, options: ParseSpreadsheetOptions): SpreadsheetFormat {
  if (options.format) return options.format;
  const fileName = options.fileName?.toLocaleLowerCase() ?? "";
  if (fileName.endsWith(".xlsx")) return "xlsx";
  if (fileName.endsWith(".csv")) return "csv";
  return typeof input === "string" ? "csv" : looksLikeXlsx(input) ? "xlsx" : "csv";
}

/** Parse a supported uploaded file. Parsing always happens in the browser. */
export async function parseSpreadsheet(
  input: SpreadsheetInput,
  options: ParseSpreadsheetOptions = {},
): Promise<ParsedSpreadsheet> {
  const format = inferFormat(input, options);
  if (format === "csv") {
    if (typeof input === "string") return parseCsv(input, { fileName: options.fileName, delimiter: options.csvDelimiter });
    return parseCsv(input, { fileName: options.fileName, delimiter: options.csvDelimiter });
  }
  if (typeof input === "string") {
    throw new SpreadsheetParseError("unsupported_format", "An XLSX file must be supplied as binary data.");
  }
  return parseXlsx(input, options.fileName ?? null);
}

function firstVisibleWorksheet(workbook: ParsedSpreadsheet): SpreadsheetWorksheet | undefined {
  return workbook.worksheets.find((worksheet) => worksheet.visibility === "visible") ?? workbook.worksheets[0];
}

/** Resolve a worksheet by zero-based index or exact name. */
export function selectWorksheet(
  workbook: ParsedSpreadsheet,
  selector?: number | string,
): SpreadsheetWorksheet {
  const worksheet = selector === undefined
    ? firstVisibleWorksheet(workbook)
    : typeof selector === "number"
      ? workbook.worksheets[selector]
      : workbook.worksheets.find((item) => item.name === selector);
  if (!worksheet) {
    throw new SpreadsheetParseError("worksheet_not_found", "Select a worksheet before continuing.");
  }
  return worksheet;
}

/** Return rows that are useful header candidates for a worksheet picker. */
export function getHeaderRowCandidates(
  worksheet: SpreadsheetWorksheet,
  maxCandidates = 50,
): readonly number[] {
  return worksheet.rows
    .filter((row) => row.values.some((value) => value.trim() !== ""))
    .slice(0, Math.max(1, maxCandidates))
    .map((row) => row.sourceRow);
}

function inferHeaderRow(worksheet: SpreadsheetWorksheet): RawSpreadsheetRow | undefined {
  const nonEmpty = worksheet.rows.filter((row) => row.values.some((value) => value.trim() !== ""));
  if (nonEmpty.length === 0) return undefined;
  // Prefer the first row with at least two populated cells, which handles a
  // title or note above a conventional tabular header without being clever
  // enough to guess incorrectly on a one-column import.
  return nonEmpty.find((row) => row.values.filter((value) => value.trim() !== "").length >= 2) ?? nonEmpty[0];
}

function rowForHeader(
  worksheet: SpreadsheetWorksheet,
  headerRow: HeaderRowSelection,
): RawSpreadsheetRow | undefined {
  if (headerRow === "auto") return inferHeaderRow(worksheet);
  return worksheet.rows.find((row) => row.sourceRow === headerRow);
}

/**
 * Select a worksheet and header row, normalize its columns, and expose records
 * keyed by those safe column names. Data rows retain their original numbers.
 */
export function selectSpreadsheetTable(
  workbook: ParsedSpreadsheet,
  options: SelectTableOptions = {},
): SpreadsheetTable {
  const worksheet = selectWorksheet(workbook, options.worksheet);
  const header = rowForHeader(worksheet, options.headerRow ?? "auto");
  if (!header) {
    throw new SpreadsheetParseError("header_row_not_found", "Choose a row containing your spreadsheet headers.");
  }

  const width = Math.max(
    header.values.length,
    ...worksheet.rows.filter((row) => row.sourceRow > header.sourceRow).map((row) => row.values.length),
  );
  const labels = Array.from({ length: width }, (_, index) => header.values[index] ?? "");
  const columns = normalizeHeaders(labels);
  const rows: SpreadsheetRecord[] = worksheet.rows
    .filter((row) => row.sourceRow > header.sourceRow)
    .map((row) => {
      const rawValues = Array.from({ length: width }, (_, index) => row.values[index] ?? "");
      const values: Record<string, string> = {};
      for (const [index, column] of columns.entries()) values[column.key] = rawValues[index] ?? "";
      return { sourceRow: row.sourceRow, rawValues, values };
    });

  return {
    format: workbook.format,
    fileName: workbook.fileName,
    worksheetIndex: worksheet.index,
    worksheetName: worksheet.name,
    headerRow: header.sourceRow,
    columns,
    rows,
  };
}

/** Convenience for the common one-call import path. */
export async function parseAndSelectSpreadsheet(
  input: SpreadsheetInput,
  options: ParseSpreadsheetOptions & SelectTableOptions = {},
): Promise<SpreadsheetTable> {
  const workbook = await parseSpreadsheet(input, options);
  return selectSpreadsheetTable(workbook, options);
}
