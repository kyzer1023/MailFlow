import type { AddressSeparator, RecipientConfiguration } from "../domain/types";
import type {
  AddressMapping,
  ClientMapping,
  MappedRecipientRow,
  MappingIssue,
  MappingResult,
  SpreadsheetTable,
} from "./types";

function sourceMapping(mapping: ClientMapping, key: "cc" | "bcc" | "replyTo"): AddressMapping {
  // An explicitly supplied source, including `null`/`undefined`, is the
  // current user's authoritative choice. This matters when a saved mapping
  // still carries the legacy `*Field` alias: clearing the new source must not
  // silently fall back to that stale alias.
  if (Object.prototype.hasOwnProperty.call(mapping, key)) return mapping[key];
  if (key === "cc") return mapping.ccField;
  if (key === "bcc") return mapping.bccField;
  return mapping.replyToField;
}

function mappingField(mapping: AddressMapping): string | null {
  if (!mapping) return null;
  if (typeof mapping === "string") return mapping.trim() || null;
  return mapping.kind === "column" ? mapping.field.trim() || null : null;
}

function mappingFixedValue(mapping: AddressMapping): string | null {
  if (!mapping || typeof mapping === "string" || mapping.kind !== "fixed") return null;
  return mapping.value.trim() || null;
}

function mappingValue(mapping: AddressMapping, row: Readonly<Record<string, string>>): string {
  if (!mapping) return "";
  if (typeof mapping === "string") return row[mapping] ?? "";
  return mapping.kind === "fixed" ? mapping.value : row[mapping.field] ?? "";
}

function addColumnIssue(
  issues: MappingIssue[],
  availableColumns: ReadonlySet<string>,
  mapping: AddressMapping,
  field: string,
): void {
  const column = mappingField(mapping);
  if (column && !availableColumns.has(column)) {
    issues.push({
      code: "missing_column",
      field,
      message: `The mapped column “${column}” is not present in the worksheet.`,
    });
  }
}

/**
 * Resolve fixed and column-based recipient fields for each spreadsheet row.
 * This step intentionally does not validate email syntax; callers can show
 * the complete mapping before validation is run.
 */
export function mapSpreadsheetRows(table: SpreadsheetTable, mapping: ClientMapping): MappingResult {
  const separator: AddressSeparator = mapping.separator ?? "auto";
  const availableColumns = new Set(table.columns.map((column) => column.key));
  const issues: MappingIssue[] = [];
  const toField = mapping.toField.trim();

  if (!toField) {
    issues.push({
      code: "missing_to_mapping",
      field: "toField",
      message: "Choose the spreadsheet column containing the primary recipient.",
    });
  } else if (!availableColumns.has(toField)) {
    issues.push({
      code: "missing_column",
      field: "toField",
      message: `The mapped column “${toField}” is not present in the worksheet.`,
    });
  }

  addColumnIssue(issues, availableColumns, sourceMapping(mapping, "cc"), "cc");
  addColumnIssue(issues, availableColumns, sourceMapping(mapping, "bcc"), "bcc");
  addColumnIssue(issues, availableColumns, sourceMapping(mapping, "replyTo"), "replyTo");

  for (const [placeholder, field] of Object.entries(mapping.placeholders ?? {})) {
    const normalizedField = field.trim();
    if (!normalizedField || !availableColumns.has(normalizedField)) {
      issues.push({
        code: "missing_column",
        field: placeholder,
        message: normalizedField
          ? `The mapped column “${normalizedField}” is not present in the worksheet.`
          : `Choose a spreadsheet column for {{${placeholder}}}.`,
      });
    }
  }

  const ccMapping = sourceMapping(mapping, "cc");
  const bccMapping = sourceMapping(mapping, "bcc");
  const replyToMapping = sourceMapping(mapping, "replyTo");
  const rows: MappedRecipientRow[] = table.rows.map((row) => ({
    sourceRow: row.sourceRow,
    to: row.values[toField] ?? "",
    cc: mappingValue(ccMapping, row.values),
    bcc: mappingValue(bccMapping, row.values),
    replyTo: mappingValue(replyToMapping, row.values),
    // Keep the full normalized source row. The server only receives rows after
    // validation and can therefore render from a deterministic merge record.
    mergeData: { ...row.values },
  }));

  return { rows, issues, separator, columns: table.columns };
}

/** Convert UI mapping state into the persisted domain configuration. */
export function mappingToRecipientConfiguration(mapping: ClientMapping): RecipientConfiguration {
  const toField = mapping.toField.trim();
  const ccMapping = sourceMapping(mapping, "cc");
  const bccMapping = sourceMapping(mapping, "bcc");
  const replyToMapping = sourceMapping(mapping, "replyTo");
  const placeholderMappings: Record<string, string> = {};
  for (const [placeholder, field] of Object.entries(mapping.placeholders ?? {})) {
    const normalizedPlaceholder = placeholder.trim();
    const normalizedField = field.trim();
    if (normalizedPlaceholder && normalizedField) placeholderMappings[normalizedPlaceholder] = normalizedField;
  }
  return {
    toField,
    ccField: mappingField(ccMapping),
    bccField: mappingField(bccMapping),
    replyToField: mappingField(replyToMapping),
    ccFixed: mappingFixedValue(ccMapping),
    bccFixed: mappingFixedValue(bccMapping),
    replyToFixed: mappingFixedValue(replyToMapping),
    placeholderMappings,
    importance: mapping.importance ?? "normal",
    separator: mapping.separator ?? "auto",
  };
}

/**
 * Hydrate the compact UI mapping state from a saved template version.
 *
 * Older versions only contain the `*Field` properties, so missing fixed
 * values and placeholder mappings intentionally fall back to null and an
 * empty object. A fixed value wins if malformed legacy data contains both a
 * fixed value and a column field; newly persisted mappings never contain
 * both sources.
 */
export function recipientConfigurationToClientMapping(
  configuration: RecipientConfiguration,
): ClientMapping {
  const addressMapping = (
    fixed: string | null | undefined,
    field: string | null | undefined,
  ): AddressMapping => fixed?.trim()
    ? { kind: "fixed", value: fixed.trim() }
    : field?.trim()
      ? { kind: "column", field: field.trim() }
      : null;

  return {
    toField: configuration.toField.trim(),
    cc: addressMapping(configuration.ccFixed, configuration.ccField),
    bcc: addressMapping(configuration.bccFixed, configuration.bccField),
    replyTo: addressMapping(configuration.replyToFixed, configuration.replyToField),
    importance: configuration.importance ?? "normal",
    separator: configuration.separator ?? "auto",
    placeholders: { ...(configuration.placeholderMappings ?? {}) },
  };
}

