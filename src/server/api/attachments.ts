import type { CampaignRecord } from "../../domain/types";
import type { MailAttachment } from "../../domain/mail-provider";
import {
  AttachmentError,
  type AttachmentFileRecord,
  type AttachmentPayload,
  type AttachmentService,
  type AttachmentSetRecord,
} from "../attachments";
import type { Repositories } from "../database/contracts";

export function publicAttachmentSet(set: AttachmentSetRecord): Record<string, unknown> {
  // Upload keys, owner identifiers, expiry timestamps, and deletion details
  // are server metadata. The browser only needs this bounded progress shape.
  return {
    id: set.id,
    fileCount: set.fileCount,
    totalBytes: set.totalBytes,
    state: set.state,
  };
}

export function publicAttachmentFile(file: AttachmentFileRecord): Record<string, unknown> {
  // Never expose the private OneDrive locator through any API response.
  return {
    id: file.id,
    originalFilename: file.originalFilename,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    sha256: file.sha256,
    position: file.position,
  };
}

/**
 * Resolve and verify the immutable attachment set associated with a campaign.
 * The association is intentionally discovered through D1 rather than a
 * client-supplied identifier, so queue payloads and campaign reads never need
 * to carry attachment bytes or private object keys.
 */
export async function loadCampaignAttachments(
  repo: Repositories,
  service: AttachmentService,
  campaign: CampaignRecord,
): Promise<readonly MailAttachment[]> {
  const set = await repo.attachments.getSetByCampaignId(campaign.id);
  if (!set) return [];
  if (set.ownerUserId !== campaign.ownerUserId || set.state === "deleted") {
    throw new AttachmentError("integrity_error", "The campaign attachment set is no longer available");
  }
  if (set.fileCount < 1) {
    throw new AttachmentError("integrity_error", "The campaign attachment set is empty");
  }
  const payloads: readonly AttachmentPayload[] = await service.readSet(campaign.ownerUserId, set.id);
  const totalBytes = payloads.reduce((total, payload) => total + payload.bytes.byteLength, 0);
  if (payloads.length !== set.fileCount || totalBytes !== set.totalBytes) {
    throw new AttachmentError("integrity_error", "The campaign attachment metadata does not match its files");
  }
  return payloads.map(({ file, bytes }) => ({
    filename: file.originalFilename,
    contentType: file.mediaType,
    content: bytes,
  }));
}

export async function cleanupCampaignAttachments(
  repo: Repositories,
  service: AttachmentService | null,
  campaignId: string,
): Promise<void> {
  if (!service) return;
  const set = await repo.attachments.getSetByCampaignId(campaignId);
  if (set) await service.cleanupSetBytes(set.id);
}
