import type { AttachmentCandidate } from "../../client/campaign";
import { attachmentMediaType, formatAttachmentSize } from "../../client/campaign";
import type { CampaignAttachment } from "../../client/types";

interface AttachmentMetadata {
  readonly id?: unknown;
  readonly originalFilename?: unknown;
  readonly filename?: unknown;
  readonly name?: unknown;
  readonly mediaType?: unknown;
  readonly contentType?: unknown;
  readonly type?: unknown;
  readonly byteSize?: unknown;
  readonly size?: unknown;
}

export interface AttachmentUploadResponseLike extends AttachmentMetadata {
  readonly file?: AttachmentMetadata | null;
  readonly attachment?: AttachmentMetadata | null;
}

export function attachmentFileFromResponse(
  response: AttachmentUploadResponseLike | null | undefined,
  fallback: AttachmentCandidate | null | undefined,
  localId: string,
): CampaignAttachment {
  const candidate: AttachmentMetadata = response?.file || response?.attachment || response || {};
  const byteSize = Number(candidate.byteSize ?? candidate.size ?? fallback?.size ?? 0);
  return {
    id: String(candidate.id || localId),
    name: String(candidate.originalFilename ?? candidate.filename ?? candidate.name ?? fallback?.name ?? "Attachment"),
    mediaType: String(candidate.mediaType ?? candidate.contentType ?? candidate.type ?? fallback?.type ?? attachmentMediaType(fallback || { name: "", size: byteSize, type: "" })),
    byteSize: Number.isFinite(byteSize) ? byteSize : Number(fallback?.size || 0),
    status: "ready",
  };
}

export function attachmentSummaryText(attachments: readonly CampaignAttachment[]): string {
  return attachments.length > 0
    ? attachments.map((attachment) => `${attachment.name} (${formatAttachmentSize(attachment.byteSize)})`).join(", ")
    : "None";
}
