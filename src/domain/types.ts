/**
 * Domain records shared by the API, persistence adapters, and queue worker.
 *
 * This module intentionally contains no Cloudflare or Microsoft imports. The
 * runtime adapters translate their provider-specific representations into
 * these small, serialisable records.
 */

export const CAMPAIGN_STATES = [
  "draft",
  "validated",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export type CampaignAttachmentIssueCode =
  | "attachment_retrying"
  | "attachment_authorization_required"
  | "attachment_missing"
  | "attachment_integrity"
  | "attachment_storage_failure";

export const RECIPIENT_STATUSES = [
  "pending",
  "claimed",
  "sending",
  "accepted",
  "failed",
  "skipped",
  "unknown",
] as const;

export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export type UserRole = "member" | "administrator";
export type FlowState = "active" | "archived";

export interface UserRecord {
  id: string;
  tenantId: string;
  objectId: string;
  principalName: string;
  mailboxAddress: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface FlowRecord {
  id: string;
  ownerUserId: string;
  societyName: string | null;
  name: string;
  currentTemplateVersionId: string | null;
  state: FlowState;
  createdAt: string;
  updatedAt: string;
}

export type AddressSeparator = "comma" | "semicolon" | "newline" | "auto";
export type MailImportance = "low" | "normal" | "high";

export interface RecipientConfiguration {
  toField: string;
  ccField: string | null;
  bccField: string | null;
  replyToField: string | null;
  /**
   * Literal address values used when the corresponding recipient field is
   * fixed instead of sourced from a worksheet column. These properties are
   * optional so template versions written before fixed recipient settings
   * were persisted remain valid when read from D1.
   */
  ccFixed?: string | null;
  bccFixed?: string | null;
  replyToFixed?: string | null;
  /** Safe worksheet-column keys for subject/body placeholders. */
  placeholderMappings?: Readonly<Record<string, string>>;
  /** Microsoft Graph message importance. Older saved versions default to normal. */
  importance?: MailImportance;
  separator: AddressSeparator;
}

export interface TemplateVersionRecord {
  id: string;
  flowId: string;
  version: number;
  subjectTemplate: string;
  bodyHtml: string;
  recipientConfiguration: RecipientConfiguration;
  placeholderManifest: readonly string[];
  createdAt: string;
}

export interface CampaignRecord {
  deliveryVerifiedCount?: number;
  id: string;
  flowId: string;
  templateVersionId: string;
  ownerUserId: string;
  senderAddress: string;
  sourceFilename: string | null;
  totalRecipients: number;
  validRecipients: number;
  skippedRecipients: number;
  pacePerMinute: number;
  state: CampaignState;
  pauseReason: string | null;
  idempotencyKey: string;
  /** Server hash of the normalized create request. Null only for legacy rows. */
  requestFingerprint?: string | null;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Durable scheduler status. Coordination tokens are never exposed here. */
  cancelRequestedAt?: string | null;
  cancelledAt?: string | null;
  schedulerNextAttemptAt?: string | null;
  schedulerMessage?: string | null;
  /** Sanitized attachment recovery state. Never contains a OneDrive locator. */
  attachmentIssueCode?: CampaignAttachmentIssueCode | null;
  /** Durable ordinal used to bound exponential pre-claim attachment retries. */
  attachmentRetryCount?: number;
  wakeToken?: string | null;
  wakeDueAt?: string | null;
  updatedAt: string;
}

export interface RecipientJobRecord {
  deliveryVerifiedBy?: string | null;
  deliveryVerifiedAt?: string | null;
  deliveryVerificationNote?: string | null;
  id: string;
  campaignId: string;
  sourceRow: number;
  recipient: string;
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: readonly string[];
  /** Optional for records created before the importance migration. */
  importance?: MailImportance;
  mergeData: Readonly<Record<string, string>>;
  renderedSubject: string;
  renderedBodyHtml: string;
  sendKey: string;
  status: RecipientStatus;
  attemptCount: number;
  claimToken: string | null;
  claimedAt: string | null;
  sendingAt: string | null;
  acceptedAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  providerMessageId: string | null;
  providerRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuditEventType =
  | "campaign.cancel_requested"
  | "campaign.cancelled"
  | "recipient.delivery_verified"
  | "campaign.created"
  | "campaign.validated"
  | "campaign.queued"
  | "campaign.started"
  | "campaign.paused"
  | "campaign.resumed"
  | "campaign.completed"
  | "campaign.failed"
  | "campaign.mailbox_waiting"
  | "campaign.attachment_waiting"
  | "campaign.attachment_retry_scheduled"
  | "campaign.attachment_authorization_required"
  | "campaign.attachment_failed"
  | "campaign.wake_recovered"
  | "test_send.requested"
  | "test_send.accepted"
  | "test_send.failed"
  | "test_send.rate_limited"
  | "test_send.mailbox_waiting"
  | "recipient.claimed"
  | "recipient.sending"
  | "recipient.accepted"
  | "recipient.failed"
  | "recipient.retry_scheduled"
  | "recipient.skipped"
  | "recipient.unknown"
  | "recipient.recovered"
  | "recipient.recovery_unknown";

export const MAILBOX_ATTEMPT_STATES = [
  "reserved",
  "provider_bound",
  "accepted",
  "unknown",
  "not_submitted",
] as const;

export type MailboxAttemptState = (typeof MAILBOX_ATTEMPT_STATES)[number];

export interface DeliveryAttemptRecord {
  id: string;
  ownerUserId: string;
  campaignId: string | null;
  recipientJobId: string | null;
  testSendId: string | null;
  attemptToken: string;
  envelopeRecipientCount: number;
  state: MailboxAttemptState;
  reservedAt: string;
  providerBoundAt: string | null;
  completedAt: string | null;
  budgetExpiresAt: string;
  releaseReason: string | null;
  providerRequestId: string | null;
}

export interface AuditEventRecord {
  id: string;
  actorUserId: string | null;
  campaignId: string | null;
  recipientJobId: string | null;
  eventType: AuditEventType;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface CampaignCounts {
  pending: number;
  claimed: number;
  sending: number;
  accepted: number;
  failed: number;
  skipped: number;
  unknown: number;
}

export function emptyCampaignCounts(): CampaignCounts {
  return {
    pending: 0,
    claimed: 0,
    sending: 0,
    accepted: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
  };
}
