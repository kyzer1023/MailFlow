import type { ResultExportRow } from "./types";

export const RESULT_EXPORT_COLUMNS = [
  "row_number",
  "recipient",
  "status",
  "attempt_count",
  "created_at",
  "claimed_at",
  "sending_at",
  "accepted_at",
  "last_error_category",
  "last_error_message",
] as const;

export interface ResultsCsvOptions {
  /** Add UTF-8 BOM for spreadsheet applications. Defaults to false for pure CSV. */
  readonly includeBom?: boolean;
  /** Prevent spreadsheet formula execution in exported diagnostic fields. */
  readonly protectFormulaCells?: boolean;
}

function valueForColumn(row: ResultExportRow, column: (typeof RESULT_EXPORT_COLUMNS)[number]): string {
  switch (column) {
    case "row_number":
      return String(row.sourceRow);
    case "recipient":
      return row.recipient;
    case "status":
      return row.status;
    case "attempt_count":
      return String(row.attemptCount);
    case "created_at":
      return row.createdAt ?? "";
    case "claimed_at":
      return row.claimedAt ?? "";
    case "sending_at":
      return row.sendingAt ?? "";
    case "accepted_at":
      return row.acceptedAt ?? "";
    case "last_error_category":
      return row.lastErrorCategory ?? "";
    case "last_error_message":
      return row.lastErrorMessage ?? "";
  }
}

function protectFormula(value: string, enabled: boolean): string {
  return enabled && /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string, protectFormulaCells: boolean): string {
  const safe = protectFormula(value, protectFormulaCells);
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** Build a deterministic RFC 4180-compatible campaign result CSV. */
export function resultsToCsv(rows: readonly ResultExportRow[], options: ResultsCsvOptions = {}): string {
  const protectFormulaCells = options.protectFormulaCells ?? true;
  const lines = [
    RESULT_EXPORT_COLUMNS.map((column) => csvCell(column, false)).join(","),
    ...rows.map((row) => RESULT_EXPORT_COLUMNS.map((column) => csvCell(valueForColumn(row, column), protectFormulaCells)).join(",")),
  ];
  const csv = `${lines.join("\r\n")}\r\n`;
  return options.includeBom ? `\uFEFF${csv}` : csv;
}

/** Alias for callers that prefer the explicit CSV name. */
export const buildResultsCsv = resultsToCsv;
export const generateResultCsv = resultsToCsv;

export function createResultsCsvBlob(
  rows: readonly ResultExportRow[],
  options: ResultsCsvOptions = {},
): Blob {
  return new Blob([resultsToCsv(rows, { ...options, includeBom: options.includeBom ?? true })], { type: "text/csv;charset=utf-8" });
}

/** Trigger a normal browser download and revoke the temporary object URL. */
export function downloadResultsCsv(
  rows: readonly ResultExportRow[],
  fileName = "mailflow-results.csv",
  options: ResultsCsvOptions = {},
): void {
  const blob = createResultsCsvBlob(rows, options);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith(".csv") ? fileName : `${fileName}.csv`;
  anchor.rel = "noopener";
  anchor.click();
  // Revoke asynchronously so browsers finish consuming the download URL.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
