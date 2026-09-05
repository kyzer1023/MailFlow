import type { ValidationIssue } from "./errors";
import { addressSeparatorPattern } from "./pacing";
import type { AddressSeparator } from "./types";

export interface RecipientValidationInput {
  sourceRow: number;
  to: string | readonly string[] | null | undefined;
  cc?: string | readonly string[] | null;
  bcc?: string | readonly string[] | null;
  replyTo?: string | readonly string[] | null;
  mergeData?: Readonly<Record<string, unknown>>;
}

export interface NormalizedRecipient {
  sourceRow: number;
  to: string;
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: readonly string[];
  mergeData: Readonly<Record<string, string>>;
}

export interface ValidationResult {
  issues: readonly ValidationIssue[];
  validRows: readonly NormalizedRecipient[];
  invalidRows: readonly number[];
  duplicateRecipients: readonly string[];
}

const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu;
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= 254 && normalized.split("@")[0].length <= 64 && EMAIL_PATTERN.test(normalized);
}

export function parseAddressList(
  value: string | readonly string[] | null | undefined,
  separator: AddressSeparator = "auto",
): string[] {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((part) => String(part).split(addressSeparatorPattern(separator)))
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

export function extractPlaceholders(subjectTemplate: string, bodyHtml: string): string[] {
  const placeholders = new Set<string>();
  for (const source of [subjectTemplate, bodyHtml]) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
      placeholders.add(match[1]);
    }
  }
  return [...placeholders].sort((left, right) => left.localeCompare(right));
}

export function validateAddressList(
  value: string | readonly string[] | null | undefined,
  field: string,
  row?: number,
  separator: AddressSeparator = "auto",
): { addresses: readonly string[]; issues: readonly ValidationIssue[] } {
  const addresses = parseAddressList(value, separator);
  const issues: ValidationIssue[] = [];
  if ((value !== null && value !== undefined && String(value).trim() !== "") && addresses.length === 0) {
    issues.push({ code: "malformed_address", field, row, message: `${field} contains no valid email address.` });
  }
  for (const address of addresses) {
    if (!isValidEmail(address)) {
      issues.push({ code: "malformed_address", field, row, message: `${field} contains an invalid email address.` });
    }
  }
  return { addresses, issues };
}

export function validateRecipientRows(
  rows: readonly RecipientValidationInput[],
  separator: AddressSeparator = "auto",
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const validRows: NormalizedRecipient[] = [];
  const invalidRows = new Set<number>();
  const seenRecipients = new Map<string, number>();
  const duplicateRecipients = new Set<string>();

  for (const row of rows) {
    const rowIssues: ValidationIssue[] = [];
    const toResult = validateAddressList(row.to, "to", row.sourceRow, separator);
    const to = [...toResult.addresses];
    rowIssues.push(...toResult.issues);
    if (to.length === 0) {
      rowIssues.push({ code: "missing_recipient", field: "to", row: row.sourceRow, message: "A primary recipient is required." });
    } else if (to.length > 1) {
      rowIssues.push({
        code: "multiple_primary_recipients",
        field: "to",
        row: row.sourceRow,
        message: "Each spreadsheet row must resolve to one primary recipient.",
      });
    }

    const cc = validateAddressList(row.cc, "cc", row.sourceRow, separator);
    const bcc = validateAddressList(row.bcc, "bcc", row.sourceRow, separator);
    const replyTo = validateAddressList(row.replyTo, "replyTo", row.sourceRow, separator);
    rowIssues.push(...cc.issues, ...bcc.issues, ...replyTo.issues);

    const normalizedTo = to[0];
    if (normalizedTo && isValidEmail(normalizedTo)) {
      const previousRow = seenRecipients.get(normalizedTo);
      if (previousRow !== undefined) {
        duplicateRecipients.add(normalizedTo);
        rowIssues.push({
          code: "duplicate_recipient",
          field: "to",
          row: row.sourceRow,
          message: `This recipient duplicates row ${previousRow}.`,
        });
      } else {
        seenRecipients.set(normalizedTo, row.sourceRow);
      }
    }

    const mergeData: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.mergeData ?? {})) {
      mergeData[key] = value === null || value === undefined ? "" : String(value);
    }

    if (rowIssues.length > 0) {
      invalidRows.add(row.sourceRow);
      issues.push(...rowIssues);
      continue;
    }
    validRows.push({
      sourceRow: row.sourceRow,
      to: normalizedTo,
      cc: cc.addresses,
      bcc: bcc.addresses,
      replyTo: replyTo.addresses,
      mergeData,
    });
  }

  return {
    issues,
    validRows,
    invalidRows: [...invalidRows].sort((a, b) => a - b),
    duplicateRecipients: [...duplicateRecipients].sort(),
  };
}

