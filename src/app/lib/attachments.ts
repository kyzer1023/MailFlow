import { formatAttachmentSize } from "../../client/campaign";
import type { CampaignAttachment } from "../../client/types";
import type { AttachmentFileResponse } from "../api";

export function attachmentFileFromResponse(
  response: AttachmentFileResponse,
): CampaignAttachment {
  const file = response?.file;
  if (
    !file ||
    typeof file.id !== "string" ||
    !file.id.trim() ||
    typeof file.originalFilename !== "string" ||
    !file.originalFilename.trim() ||
    typeof file.mediaType !== "string" ||
    !file.mediaType.trim() ||
    !Number.isSafeInteger(file.byteSize) ||
    file.byteSize <= 0
  ) {
    throw new Error(
      "The upload response is incomplete. Remove this file and choose it again.",
    );
  }
  return {
    id: file.id,
    name: file.originalFilename,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    status: "ready",
  };
}

export function attachmentSummaryText(
  attachments: readonly CampaignAttachment[],
): string {
  return attachments.length > 0
    ? attachments
        .map(
          (attachment) =>
            `${attachment.name} (${formatAttachmentSize(attachment.byteSize)})`,
        )
        .join(", ")
    : "None";
}
