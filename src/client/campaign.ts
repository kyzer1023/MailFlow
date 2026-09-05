import type { ClientMapping } from "./types";
import { mappingToRecipientConfiguration } from "./mapping";
import { renderTemplate } from "./template";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
} from "./types";
import type {
  CampaignCreatePayload,
  CampaignAttachment,
  CampaignRecipientPayload,
  ClientValidationIssue,
  ClientValidationSummary,
  MessagePreview,
  MappedRecipientRow,
  NormalizedRecipientRow,
  RepresentativeRow,
} from "./types";

import { normalizeAttachmentContentType, sanitizeAttachmentFilename } from "../domain/attachment-policy";

export type AttachmentCandidate = Pick<File, "name" | "size" | "type">;

export interface AttachmentSelectionError {
  readonly name: string;
  readonly size: number;
  readonly mediaType: string;
  readonly code: "empty" | "unsupported" | "duplicate" | "too_many" | "too_large";
  readonly message: string;
}

export interface AttachmentSelectionResult {
  readonly accepted: readonly File[];
  readonly rejected: readonly AttachmentSelectionError[];
}

/** Infer only supported, extension-matching media types. */
export function attachmentMediaType(file: AttachmentCandidate): string {
  try { return normalizeAttachmentContentType(sanitizeAttachmentFilename(file.name), file.type); }
  catch { return "application/octet-stream"; }
}

export function isSupportedAttachment(file: AttachmentCandidate): boolean {
  try { normalizeAttachmentContentType(sanitizeAttachmentFilename(file.name), file.type); return true; }
  catch { return false; }
}

/** Validate a native multi-file selection before any upload begins. */
export function validateAttachmentSelection(
  files: readonly File[],
  existing: readonly CampaignAttachment[] = [],
): AttachmentSelectionResult {
  const accepted: File[] = [];
  const rejected: AttachmentSelectionError[] = [];
  const active = existing.filter((item) => item.status !== "error");
  let totalBytes = active.reduce((total, item) => total + item.byteSize, 0);
  const seenNames = new Set(active.map((item) => item.name.trim().toLocaleLowerCase()));

  for (const file of files) {
    const mediaType = attachmentMediaType(file);
    const base = { name: file.name, size: file.size, mediaType };
    let error: AttachmentSelectionError | null = null;
    if (file.size <= 0) {
      error = { ...base, code: "empty", message: "Empty files cannot be attached." };
    } else if (!isSupportedAttachment(file)) {
      error = { ...base, code: "unsupported", message: "This file type is not supported. Choose PDF, DOCX, XLSX, PPTX, CSV, TXT, PNG, or JPEG." };
    } else if (seenNames.has(file.name.trim().toLocaleLowerCase())) {
      error = { ...base, code: "duplicate", message: "This file was already added." };
    } else if (active.length + accepted.length >= ATTACHMENT_MAX_FILES) {
      error = { ...base, code: "too_many", message: `You can add up to ${ATTACHMENT_MAX_FILES} attachments.` };
    } else if (totalBytes + file.size > ATTACHMENT_MAX_BYTES) {
      error = { ...base, code: "too_large", message: "Attachments must be 20 MiB or smaller in total." };
    }
    if (error) {
      rejected.push(error);
      continue;
    }
    accepted.push(file);
    seenNames.add(file.name.trim().toLocaleLowerCase());
    // Include the current selection in the running total so two files added
    // together cannot collectively exceed the campaign limit.
    totalBytes += file.size;
  }
  return { accepted, rejected };
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const value = bytes / (1024 * 1024);
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0$/u, "")} MB`;
}

export function attachmentTotalBytes(attachments: readonly Pick<CampaignAttachment, "byteSize">[]): number {
  return attachments.reduce((total, attachment) => total + attachment.byteSize, 0);
}

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
  /** Opaque server-owned attachment set identifier. No File objects are accepted. */
  readonly attachmentSetId?: string | null;
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

  const persistedMapping = mappingToRecipientConfiguration(input.mapping);
  return {
    idempotencyKey,
    attachmentSetId: input.attachmentSetId?.trim() || null,
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

