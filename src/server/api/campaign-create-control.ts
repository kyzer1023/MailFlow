import type { RecipientConfiguration } from "../../domain/types";
import { sha256Base64Url } from "../auth/crypto";
import type { CampaignCreateInput } from "./schemas";

export function campaignReplayFingerprint(
  storedFingerprint: string | null | undefined,
  requestedFingerprint: string,
): "exact" | "legacy" | "conflict" {
  if (!storedFingerprint) return "legacy";
  return storedFingerprint === requestedFingerprint ? "exact" : "conflict";
}

function sortedRecord(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Hash only values that define the persisted campaign snapshot. Ordering of
 * record keys and input rows is normalized so semantically identical retries
 * receive the same fingerprint.
 */
export async function campaignCreateFingerprint(input: {
  readonly request: CampaignCreateInput;
  readonly subjectTemplate: string;
  readonly bodyHtml: string;
  readonly recipientConfiguration: RecipientConfiguration;
  readonly sourceFilename: string | null;
  readonly pacePerMinute: number;
}): Promise<string> {
  const rows = input.request.rows.map((row) => ({
    sourceRow: row.sourceRow,
    to: row.to.trim().toLowerCase(),
    cc: row.cc.map((address) => address.trim().toLowerCase()),
    bcc: row.bcc.map((address) => address.trim().toLowerCase()),
    replyTo: row.replyTo.map((address) => address.trim().toLowerCase()),
    mergeData: sortedRecord(row.mergeData),
    renderedSubject: row.renderedSubject.trim(),
    renderedBodyHtml: row.renderedBodyHtml.trim(),
  })).sort((left, right) => left.sourceRow - right.sourceRow);

  return sha256Base64Url(JSON.stringify({
    flowId: input.request.flowId,
    templateVersionId: input.request.templateVersionId ?? null,
    attachmentSetId: input.request.attachmentSetId ?? null,
    sourceFilename: input.sourceFilename,
    subjectTemplate: input.subjectTemplate,
    bodyHtml: input.bodyHtml,
    recipientConfiguration: {
      ...input.recipientConfiguration,
      placeholderMappings: sortedRecord(input.recipientConfiguration.placeholderMappings ?? {}),
    },
    pacePerMinute: input.pacePerMinute,
    totalRecipients: input.request.totalRecipients,
    validRecipients: input.request.validRecipients,
    skippedRecipients: input.request.skippedRecipients,
    rows,
  }));
}
