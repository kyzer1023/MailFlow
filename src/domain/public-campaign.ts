import type { CampaignRecord } from "./types";

/** Adding a persistence field does not automatically add it to the public API. */
export const PUBLIC_CAMPAIGN_FIELDS = [
  "id", "flowId", "templateVersionId", "ownerUserId", "senderAddress", "sourceFilename",
  "totalRecipients", "validRecipients", "skippedRecipients", "pacePerMinute", "state", "pauseReason",
  "createdAt", "queuedAt", "startedAt", "completedAt", "updatedAt", "cancelRequestedAt", "cancelledAt",
  "schedulerNextAttemptAt", "schedulerMessage", "attachmentIssueCode", "attachmentRetryCount",
  "mailIssueCode", "deliveryVerifiedCount",
] as const satisfies readonly (keyof CampaignRecord)[];

export type PublicCampaignRecord = Pick<CampaignRecord, typeof PUBLIC_CAMPAIGN_FIELDS[number]>;
