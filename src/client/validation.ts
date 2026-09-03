import {
  DEFAULT_PACE_PER_MINUTE,
  estimateCampaignDurationSeconds,
  validatePacePerMinute,
} from "../domain/pacing";
import type { AddressSeparator } from "../domain/types";
import { sanitizeTemplateHtml } from "./template";
import type {
  ClientValidationIssue,
  ClientValidationSummary,
  MappedRecipientRow,
  MappingIssue,
  NormalizedRecipientRow,
} from "./types";

export const DEFAULT_CLIENT_CAMPAIGN_LIMIT = 300;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu;

export type AddressValue = string | readonly string[] | null | undefined;

export interface ParsedAddressList {
  readonly addresses: readonly string[];
  readonly invalidParts: readonly string[];
}

export interface AddressValidationResult {
  readonly addresses: readonly string[];
  readonly issues: readonly ClientValidationIssue[];
}

export interface ClientCampaignValidationInput {
  readonly senderAddress: string;
  readonly subjectTemplate: string;
  readonly bodyHtml: string;
  readonly rows: readonly MappedRecipientRow[];
  readonly mappedFields?: Readonly<Record<string, string>>;
  readonly separator?: AddressSeparator;
  readonly maxRecipients?: number;
  readonly pacePerMinute?: number;
  readonly mappingIssues?: readonly MappingIssue[];
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= 320 && EMAIL_PATTERN.test(normalized);
}

function splitPattern(separator: AddressSeparator): RegExp {
  switch (separator) {
    case "semicolon":
      return /;/u;
    case "newline":
      return /\r?\n/u;
    case "comma":
      return /,/u;
    case "auto":
    default:
      return /[,;\r\n]+/u;
  }
}

/** Parse a cell containing one or more addresses using the chosen separator. */
export function parseEmailList(value: AddressValue, separator: AddressSeparator = "auto"): ParsedAddressList {
  if (value === null || value === undefined) return { addresses: [], invalidParts: [] };
  const values = Array.isArray(value) ? value : [value];
  const parts = values.flatMap((part) => String(part).split(splitPattern(separator)));
  const addresses: string[] = [];
  const invalidParts: string[] = [];
  for (const part of parts) {
    const normalized = normalizeEmail(part);
    if (!normalized) continue;
    if (isValidEmail(normalized)) addresses.push(normalized);
    else invalidParts.push(normalized);
  }
  return { addresses, invalidParts };
}

export function parseAddressList(value: AddressValue, separator: AddressSeparator = "auto"): string[] {
  return [...parseEmailList(value, separator).addresses];
}

export function validateAddressList(
  value: AddressValue,
  field: string,
  row?: number,
  separator: AddressSeparator = "auto",
): AddressValidationResult {
  const parsed = parseEmailList(value, separator);
  const issues: ClientValidationIssue[] = [];
  const supplied = Array.isArray(value) ? value.some((part) => String(part).trim() !== "") : String(value ?? "").trim() !== "";
  if (supplied && parsed.addresses.length === 0 && parsed.invalidParts.length === 0) {
    issues.push({ code: "malformed_address", field, row, message: `${field} contains no valid email address.` });
  }
  for (const invalidPart of parsed.invalidParts) {
    issues.push({ code: "malformed_address", field, row, message: `${field} contains an invalid email address.` });
    // One issue per cell is enough for the UI. Keep the parsed part only in
    // the internal result to avoid exposing potentially sensitive content.
    void invalidPart;
  }
  return { addresses: parsed.addresses, issues };
}

/** Extract unique, valid placeholders from subject and body templates. */
export function extractPlaceholders(subjectTemplate: string, bodyHtml: string): readonly string[] {
  const placeholders = new Set<string>();
  for (const source of [subjectTemplate, bodyHtml]) {
    PLACEHOLDER_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(PLACEHOLDER_PATTERN)) placeholders.add(match[1]);
  }
  return [...placeholders].sort((left, right) => left.localeCompare(right));
}

function normalizedMergeData(row: MappedRecipientRow): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.mergeData)) result[key] = value === null || value === undefined ? "" : String(value);
  return result;
}

export interface RecipientValidationResult {
  readonly issues: readonly ClientValidationIssue[];
  readonly validRows: readonly NormalizedRecipientRow[];
  readonly invalidRows: readonly number[];
  readonly duplicateRecipients: readonly string[];
}

/** Validate each mapped recipient row and flag only the later copy of a duplicate. */
export function validateMappedRecipientRows(
  rows: readonly MappedRecipientRow[],
  separator: AddressSeparator = "auto",
): RecipientValidationResult {
  const issues: ClientValidationIssue[] = [];
  const validRows: NormalizedRecipientRow[] = [];
  const invalidRows = new Set<number>();
  const seenRecipients = new Map<string, number>();
  const duplicateRecipients = new Set<string>();

  for (const row of rows) {
    const rowIssues: ClientValidationIssue[] = [];
    const to = validateAddressList(row.to, "to", row.sourceRow, separator);
    const cc = validateAddressList(row.cc, "cc", row.sourceRow, separator);
    const bcc = validateAddressList(row.bcc, "bcc", row.sourceRow, separator);
    const replyTo = validateAddressList(row.replyTo, "replyTo", row.sourceRow, separator);
    rowIssues.push(...to.issues, ...cc.issues, ...bcc.issues, ...replyTo.issues);

    if (to.addresses.length === 0 && to.issues.length === 0) {
      rowIssues.push({ code: "missing_recipient", field: "to", row: row.sourceRow, message: "A primary recipient is required." });
    } else if (to.addresses.length > 1) {
      rowIssues.push({
        code: "multiple_primary_recipients",
        field: "to",
        row: row.sourceRow,
        message: "Each spreadsheet row must resolve to one primary recipient.",
      });
    }

    const normalizedTo = to.addresses[0];
    if (normalizedTo && to.addresses.length === 1) {
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

    if (rowIssues.length > 0) {
      invalidRows.add(row.sourceRow);
      issues.push(...rowIssues);
      continue;
    }

    validRows.push({
      sourceRow: row.sourceRow,
      to: normalizedTo as string,
      cc: cc.addresses,
      bcc: bcc.addresses,
      replyTo: replyTo.addresses,
      mergeData: normalizedMergeData(row),
    });
  }

  return {
    issues,
    validRows,
    invalidRows: [...invalidRows].sort((left, right) => left - right),
    duplicateRecipients: [...duplicateRecipients].sort((left, right) => left.localeCompare(right)),
  };
}

function mappingIssueToValidationIssue(issue: MappingIssue): ClientValidationIssue {
  return { code: issue.code, field: issue.field, message: issue.message };
}

/**
 * Validate a complete client campaign before any API request is made. The
 * result deliberately contains only normalized, JSON-safe rows.
 */
export function validateClientCampaign(input: ClientCampaignValidationInput): ClientValidationSummary {
  const issues: ClientValidationIssue[] = (input.mappingIssues ?? []).map(mappingIssueToValidationIssue);
  const limit = input.maxRecipients ?? DEFAULT_CLIENT_CAMPAIGN_LIMIT;
  const pace = input.pacePerMinute ?? DEFAULT_PACE_PER_MINUTE;
  const senderAddress = normalizeEmail(input.senderAddress);

  if (!isValidEmail(senderAddress)) {
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
    const mappedField = input.mappedFields?.[placeholder]?.trim();
    if (!mappedField) {
      issues.push({
        code: "missing_mapping",
        field: placeholder,
        message: `The template field {{${placeholder}}} is not mapped to a spreadsheet column.`,
      });
    }
  }

  const sanitizedBodyHtml = sanitizeTemplateHtml(input.bodyHtml);
  // The sanitized form is the authoritative template used for previews,
  // immutable template versions, campaign rows, and Graph sends. DOMPurify
  // may remove active content or normalize harmless email markup, so string
  // inequality is not itself a validation failure. The Worker independently
  // rejects active HTML at the API boundary and never receives this raw input.

  const rowResult = validateMappedRecipientRows(input.rows, input.separator ?? "auto");
  issues.push(...rowResult.issues);
  const invalidRows = new Set(rowResult.invalidRows);
  for (const row of rowResult.validRows) {
    for (const placeholder of placeholders) {
      const mappedField = input.mappedFields?.[placeholder]?.trim();
      if (!mappedField) continue;
      const value = row.mergeData[mappedField];
      if (value === undefined || value.trim() === "") {
        issues.push({
          code: "empty_required_value",
          field: mappedField,
          row: row.sourceRow,
          message: `Row ${row.sourceRow} has no value for {{${placeholder}}}.`,
        });
        invalidRows.add(row.sourceRow);
      }
    }
  }

  const validRows = rowResult.validRows.filter((row) => !invalidRows.has(row.sourceRow));
  const validRecipientCount = validRows.length;
  const skippedRecipientCount = Math.max(0, input.rows.length - validRecipientCount);
  return {
    ok: issues.length === 0,
    issues,
    validRows,
    invalidRows: [...invalidRows].sort((left, right) => left - right),
    duplicateRecipients: rowResult.duplicateRecipients,
    placeholders,
    sanitizedBodyHtml,
    campaignLimit: limit,
    totalRows: input.rows.length,
    validRecipientCount,
    skippedRecipientCount,
    estimatedDurationSeconds: validatePacePerMinute(pace)
      ? estimateCampaignDurationSeconds(validRecipientCount, pace)
      : 0,
  };
}

/** Alias used by UI view-models. */
export const validateCampaignData = validateClientCampaign;
