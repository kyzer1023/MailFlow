import type { AddressSeparator } from "../domain/types";

/** File formats accepted by the browser import step. */
export type SpreadsheetFormat = "csv" | "xlsx";

/**
 * A row as it appeared in the source workbook. Row numbers are one based so
 * that validation messages match the row numbers users see in Excel.
 */
export interface RawSpreadsheetRow {
  readonly sourceRow: number;
  readonly values: readonly string[];
}

export interface SpreadsheetWorksheet {
  /** Zero-based position in the parsed workbook. */
  readonly index: number;
  readonly name: string;
  readonly visibility: "visible" | "hidden" | "veryHidden";
  readonly rows: readonly RawSpreadsheetRow[];
}

export interface ParsedSpreadsheet {
  readonly format: SpreadsheetFormat;
  readonly fileName: string | null;
  readonly worksheets: readonly SpreadsheetWorksheet[];
}

export interface SpreadsheetColumn {
  /** Stable safe key used by placeholders and API payloads. */
  readonly key: string;
  /** Label exactly as supplied by the header row, except for generated blanks. */
  readonly label: string;
  /** One-based column number in the source worksheet. */
  readonly sourceColumn: number;
}

export interface SpreadsheetRecord {
  readonly sourceRow: number;
  readonly values: Readonly<Record<string, string>>;
  /** Raw values are retained for an optional compact data preview. */
  readonly rawValues: readonly string[];
}

export interface SpreadsheetTable {
  readonly format: SpreadsheetFormat;
  readonly fileName: string | null;
  readonly worksheetIndex: number;
  readonly worksheetName: string;
  /** One-based source row used as the header. */
  readonly headerRow: number;
  readonly columns: readonly SpreadsheetColumn[];
  readonly rows: readonly SpreadsheetRecord[];
}

export type AddressMapping =
  | { readonly kind: "column"; readonly field: string }
  | { readonly kind: "fixed"; readonly value: string }
  /** A string is treated as a column key for concise UI form state. */
  | string
  | null
  | undefined;

/** Mapping selected in the mapping step. */
export interface ClientMapping {
  /** Safe column key for the one required primary recipient. */
  readonly toField: string;
  readonly cc?: AddressMapping;
  readonly bcc?: AddressMapping;
  readonly replyTo?: AddressMapping;
  /** Aliases matching the persisted recipient configuration shape. */
  readonly ccField?: string | null;
  readonly bccField?: string | null;
  readonly replyToField?: string | null;
  readonly separator?: AddressSeparator;
  /** Placeholder key to safe column key. */
  readonly placeholders?: Readonly<Record<string, string>>;
}

/** A row ready for validation and, after validation, for API serialization. */
export interface MappedRecipientRow {
  readonly sourceRow: number;
  readonly to: string;
  readonly cc: string;
  readonly bcc: string;
  readonly replyTo: string;
  readonly mergeData: Readonly<Record<string, string>>;
}

export interface MappingIssue {
  readonly code: "missing_to_mapping" | "missing_column";
  readonly field: string;
  readonly message: string;
}

export interface MappingResult {
  readonly rows: readonly MappedRecipientRow[];
  readonly issues: readonly MappingIssue[];
  readonly separator: AddressSeparator;
  readonly columns: readonly SpreadsheetColumn[];
}

export interface ClientValidationIssue {
  readonly code: string;
  readonly field?: string;
  readonly row?: number;
  readonly message: string;
}

export interface NormalizedRecipientRow {
  readonly sourceRow: number;
  readonly to: string;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly replyTo: readonly string[];
  readonly mergeData: Readonly<Record<string, string>>;
}

export interface ClientValidationSummary {
  readonly ok: boolean;
  readonly issues: readonly ClientValidationIssue[];
  readonly validRows: readonly NormalizedRecipientRow[];
  readonly invalidRows: readonly number[];
  readonly duplicateRecipients: readonly string[];
  readonly placeholders: readonly string[];
  readonly sanitizedBodyHtml: string;
  readonly campaignLimit: number;
  readonly totalRows: number;
  readonly validRecipientCount: number;
  readonly skippedRecipientCount: number;
  readonly estimatedDurationSeconds: number;
}

export type PreviewPosition = "first" | "middle" | "last";

export interface RepresentativeRow {
  readonly position: PreviewPosition;
  readonly row: NormalizedRecipientRow;
}

export interface MessagePreview {
  readonly position: PreviewPosition;
  readonly sourceRow: number;
  readonly senderAddress: string;
  readonly to: string;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly replyTo: readonly string[];
  readonly subject: string;
  readonly bodyHtml: string;
  readonly missingPlaceholders: readonly string[];
}

export interface CampaignRecipientPayload {
  readonly sourceRow: number;
  readonly to: string;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly replyTo: readonly string[];
  readonly mergeData: Readonly<Record<string, string>>;
  readonly renderedSubject: string;
  readonly renderedBodyHtml: string;
}

/** JSON-safe body for POST /api/campaigns. Sender identity is server-owned. */
export interface CampaignCreatePayload {
  readonly idempotencyKey: string;
  readonly flowId: string;
  readonly templateVersionId: string | null;
  readonly sourceFilename: string | null;
  readonly subjectTemplate: string;
  readonly bodyHtml: string;
  readonly placeholderManifest: readonly string[];
  readonly recipientConfiguration: {
    readonly toField: string;
    readonly ccField: string | null;
    readonly bccField: string | null;
    readonly replyToField: string | null;
    /** Literal recipient metadata when the source is fixed rather than a column. */
    readonly ccFixed?: string | null;
    readonly bccFixed?: string | null;
    readonly replyToFixed?: string | null;
    /** Safe worksheet-column keys used to resolve template placeholders. */
    readonly placeholderMappings?: Readonly<Record<string, string>>;
    readonly separator: AddressSeparator;
  };
  readonly pacePerMinute: number;
  readonly totalRecipients: number;
  readonly validRecipients: number;
  readonly skippedRecipients: number;
  readonly rows: readonly CampaignRecipientPayload[];
}

export interface ResultExportRow {
  readonly sourceRow: number;
  readonly recipient: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly createdAt?: string | null;
  readonly claimedAt?: string | null;
  readonly sendingAt?: string | null;
  readonly acceptedAt?: string | null;
  readonly lastErrorCategory?: string | null;
  readonly lastErrorMessage?: string | null;
}
