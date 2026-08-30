import type { ClientMapping } from "./types";
import { mappingToRecipientConfiguration } from "./mapping";
import { renderTemplate } from "./template";
import { validateClientCampaign } from "./validation";
import type {
  CampaignCreatePayload,
  CampaignRecipientPayload,
  ClientValidationIssue,
  ClientValidationSummary,
  MessagePreview,
  MappedRecipientRow,
  NormalizedRecipientRow,
  PreviewPosition,
  RepresentativeRow,
} from "./types";

export interface RepresentativePreviewInput {
  readonly senderAddress: string;
  readonly subjectTemplate: string;
  readonly bodyHtml: string;
  readonly rows: readonly NormalizedRecipientRow[];
  readonly fieldMappings?: Readonly<Record<string, string>>;
}

export interface CreateCampaignPayloadInput {
  /** Stable per user intent so retries cannot create duplicate campaigns. */
  readonly idempotencyKey: string;
  readonly flowId: string;
  readonly templateVersionId?: string | null;
  readonly sourceFilename?: string | null;
  readonly subjectTemplate: string;
  readonly bodyHtml: string;
  readonly mapping: ClientMapping;
  readonly pacePerMinute: number;
  readonly rows: readonly MappedRecipientRow[];
  /** A prior validation result is required to prevent an accidental bypass. */
  readonly validation: ClientValidationSummary;
}

export class CampaignPayloadError extends Error {
  readonly code = "campaign_not_ready";
  readonly issues: readonly ClientValidationIssue[];

  constructor(message: string, issues: readonly ClientValidationIssue[] = []) {
    super(message);
    this.name = "CampaignPayloadError";
    this.issues = issues;
  }
}

/** Return first, middle, and last valid rows without duplicate positions. */
export function representativeRows(rows: readonly NormalizedRecipientRow[]): readonly RepresentativeRow[] {
  if (rows.length === 0) return [];
  if (rows.length === 1) return [{ position: "first", row: rows[0] }];
  if (rows.length === 2) {
    return [
      { position: "first", row: rows[0] },
      { position: "last", row: rows[1] },
    ];
  }
  const middleIndex = Math.floor((rows.length - 1) / 2);
  return [
    { position: "first", row: rows[0] },
    { position: "middle", row: rows[middleIndex] },
    { position: "last", row: rows[rows.length - 1] },
  ];
}

/** Alias used by the review step. */
export const getRepresentativeRows = representativeRows;

/** Resolve representative rows into safe, isolated preview models. */
export function buildMessagePreviews(input: RepresentativePreviewInput): readonly MessagePreview[] {
  return representativeRows(input.rows).map(({ position, row }) => {
    const rendered = renderTemplate(input.subjectTemplate, input.bodyHtml, row.mergeData, {
      fieldMappings: input.fieldMappings,
    });
    return {
      position,
      sourceRow: row.sourceRow,
      senderAddress: input.senderAddress,
      to: row.to,
      cc: row.cc,
      bcc: row.bcc,
      replyTo: row.replyTo,
      subject: rendered.subject,
      bodyHtml: rendered.bodyHtml,
      missingPlaceholders: rendered.missingPlaceholders,
    };
  });
}

function ensureValidated(input: CreateCampaignPayloadInput): void {
  if (!input.validation.ok) {
    throw new CampaignPayloadError("Review and fix the flagged rows before starting the campaign.", input.validation.issues);
  }
  if (input.validation.validRows.length === 0) {
    throw new CampaignPayloadError("At least one valid recipient is required before starting a campaign.");
  }
  if (input.validation.validRows.length !== input.rows.filter((row) => input.validation.invalidRows.indexOf(row.sourceRow) === -1).length) {
    throw new CampaignPayloadError("The campaign data changed after validation. Validate the rows again.");
  }
}

/**
 * Build the JSON-safe request body sent to the campaign API. Sender identity
 * is intentionally absent: the Worker derives it from the authenticated
 * session and cannot be overridden by browser input.
 */
export function createCampaignPayload(input: CreateCampaignPayloadInput): CampaignCreatePayload {
  ensureValidated(input);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new CampaignPayloadError("A stable campaign request key is required.");
  const flowId = input.flowId.trim();
  if (!flowId) throw new CampaignPayloadError("A flow is required before starting a campaign.");

  const fieldMappings = input.mapping.placeholders ?? {};
  const validSourceRows = new Set(input.validation.validRows.map((row) => row.sourceRow));
  const sourceRows = new Map(input.rows.map((row) => [row.sourceRow, row]));
  const rows: CampaignRecipientPayload[] = [];
  for (const normalized of input.validation.validRows) {
    const source = sourceRows.get(normalized.sourceRow);
    if (!source) throw new CampaignPayloadError("The campaign data changed after validation. Validate the rows again.");
    const rendered = renderTemplate(input.subjectTemplate, input.bodyHtml, normalized.mergeData, { fieldMappings });
    if (rendered.missingPlaceholders.length > 0) {
      throw new CampaignPayloadError("The template contains a field that is not available for every recipient.");
    }
    rows.push({
      sourceRow: normalized.sourceRow,
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      replyTo: normalized.replyTo,
      mergeData: { ...normalized.mergeData },
      renderedSubject: rendered.subject,
      renderedBodyHtml: rendered.bodyHtml,
    });
  }

  // Keep this check explicit so a caller cannot accidentally add a row between
  // validation and serialization without re-running validation.
  if (rows.some((row) => !validSourceRows.has(row.sourceRow))) {
    throw new CampaignPayloadError("The campaign data changed after validation. Validate the rows again.");
  }

  const persistedMapping = mappingToRecipientConfiguration(input.mapping);
  return {
    idempotencyKey,
    flowId,
    templateVersionId: input.templateVersionId?.trim() || null,
    sourceFilename: input.sourceFilename?.trim() || null,
    subjectTemplate: input.subjectTemplate,
    bodyHtml: input.validation.sanitizedBodyHtml,
    placeholderManifest: [...input.validation.placeholders],
    recipientConfiguration: persistedMapping,
    pacePerMinute: input.pacePerMinute,
    totalRecipients: input.validation.totalRows,
    validRecipients: input.validation.validRecipientCount,
    skippedRecipients: input.validation.skippedRecipientCount,
    rows,
  };
}

/** Alias describing the endpoint-oriented operation. */
export const createCampaignRequest = createCampaignPayload;

/** Convert an arbitrary position into a stable display label. */
export function previewPositionLabel(position: PreviewPosition): string {
  switch (position) {
    case "first":
      return "First valid row";
    case "middle":
      return "Middle valid row";
    case "last":
      return "Last valid row";
  }
}

// Exporting this helper keeps integration code from importing the validation
// module solely to create the pre-flight summary.
export { validateClientCampaign };
