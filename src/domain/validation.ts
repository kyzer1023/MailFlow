import { DomainError, type ValidationIssue } from "./errors";
import { addressSeparatorPattern, DEFAULT_PACE_PER_MINUTE, paceDelaySeconds, validatePacePerMinute } from "./pacing";
import type { AddressSeparator } from "./types";

export const DEFAULT_CAMPAIGN_LIMIT = 300;

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

export interface CampaignValidationInput {
  senderAddress: string;
  subjectTemplate: string;
  bodyHtml: string;
  rows: readonly RecipientValidationInput[];
  mappedFields?: Readonly<Record<string, string>>;
  separator?: AddressSeparator;
  maxRecipients?: number;
  pacePerMinute?: number;
}

export interface CampaignValidationSummary {
  ok: boolean;
  issues: readonly ValidationIssue[];
  validRows: readonly NormalizedRecipient[];
  invalidRows: readonly number[];
  duplicateRecipients: readonly string[];
  placeholders: readonly string[];
  estimatedDurationSeconds: number;
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

export function validateCampaign(input: CampaignValidationInput): CampaignValidationSummary {
  const issues: ValidationIssue[] = [];
  const limit = input.maxRecipients ?? DEFAULT_CAMPAIGN_LIMIT;
  const pace = input.pacePerMinute ?? DEFAULT_PACE_PER_MINUTE;
  if (!isValidEmail(input.senderAddress)) {
    issues.push({ code: "invalid_sender", field: "senderAddress", message: "The authenticated sender mailbox is invalid." });
  }
  if (!input.subjectTemplate.trim()) {
    issues.push({ code: "missing_subject", field: "subjectTemplate", message: "A subject template is required." });
  }
  if (!input.bodyHtml.trim()) {
    issues.push({ code: "missing_body", field: "bodyHtml", message: "An HTML body template is required." });
  }
  if (!Number.isInteger(limit) || limit < 1) {
    issues.push({ code: "invalid_campaign_limit", field: "maxRecipients", message: "The campaign limit is invalid." });
  } else if (input.rows.length > limit) {
    issues.push({ code: "campaign_too_large", field: "rows", message: `Campaigns are limited to ${limit} rows.` });
  }
  if (!validatePacePerMinute(pace)) {
    issues.push({ code: "invalid_pace", field: "pacePerMinute", message: "The sending pace is outside the allowed range." });
  }

  const placeholders = extractPlaceholders(input.subjectTemplate, input.bodyHtml);
  for (const placeholder of placeholders) {
    if (!input.mappedFields || !Object.hasOwn(input.mappedFields, placeholder) || !input.mappedFields[placeholder]) {
      issues.push({
        code: "missing_mapping",
        field: placeholder,
        message: `The template field {{${placeholder}}} is not mapped to a spreadsheet column.`,
      });
    }
  }

  const rowResult = validateRecipientRows(input.rows, input.separator ?? "auto");
  issues.push(...rowResult.issues);
  for (const row of rowResult.validRows) {
    for (const placeholder of placeholders) {
      const mappedField = input.mappedFields && Object.hasOwn(input.mappedFields, placeholder) ? input.mappedFields[placeholder] : undefined;
      if (!mappedField) continue;
      const value = Object.hasOwn(row.mergeData, mappedField) ? row.mergeData[mappedField] : undefined;
      if (value === undefined || value.trim() === "") {
        issues.push({
          code: "empty_required_value",
          field: mappedField,
          row: row.sourceRow,
          message: `Row ${row.sourceRow} has no value for {{${placeholder}}}.`,
        });
      }
    }
  }

  const invalidRows = new Set(rowResult.invalidRows);
  for (const issue of issues) {
    if (issue.row !== undefined) invalidRows.add(issue.row);
  }
  const validRows = rowResult.validRows.filter((row) => !invalidRows.has(row.sourceRow));
  return {
    ok: issues.length === 0,
    issues,
    validRows,
    invalidRows: [...invalidRows].sort((a, b) => a - b),
    duplicateRecipients: rowResult.duplicateRecipients,
    placeholders,
    estimatedDurationSeconds: validRows.length === 0 ? 0 : Math.max(0, validRows.length - 1) * paceDelaySeconds(pace),
  };
}

export function assertCampaignValid(input: CampaignValidationInput): CampaignValidationSummary {
  const result = validateCampaign(input);
  if (!result.ok) {
    throw new DomainError("invalid_input", "Campaign validation failed.", result.issues);
  }
  return result;
}
