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
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

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
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface RecipientJobRecord {
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
  | "campaign.created"
  | "campaign.validated"
  | "campaign.queued"
  | "campaign.started"
  | "campaign.paused"
  | "campaign.resumed"
  | "campaign.completed"
  | "campaign.failed"
  | "recipient.claimed"
  | "recipient.sending"
  | "recipient.accepted"
  | "recipient.failed"
  | "recipient.retry_scheduled"
  | "recipient.skipped"
  | "recipient.unknown";

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
