import type { MailImportance } from "./types";

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/** The provider-neutral message passed to the selected Microsoft mail adapter. */
export interface MailMessage {
  to: string;
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: readonly string[];
  importance?: MailImportance;
  subject: string;
  htmlBody: string;
  attachments?: readonly MailAttachment[];
}

export interface MailSendAccepted {
  kind: "accepted";
  providerMessageId?: string | null;
  providerRequestId?: string | null;
}

export interface MailSendRetryable {
  kind: "retryable";
  /** Must be true only when the adapter knows Microsoft did not accept the send. */
  safeToRetry: true;
  category: "throttle" | "pre_send_temporary" | "network_before_send";
  message: string;
  retryAfter?: number | string | Date | null;
  providerRequestId?: string | null;
}

export interface MailSendFailed {
  kind: "failed";
  category:
    | "authentication"
    | "permission"
    | "invalid_recipient"
    | "invalid_message"
    | "provider"
    | "policy"
    | "unknown";
  message: string;
  providerRequestId?: string | null;
}

export interface MailSendUnknown {
  kind: "unknown";
  category: "ambiguous" | "transport";
  message: string;
  providerRequestId?: string | null;
}

export type MailSendResult = MailSendAccepted | MailSendRetryable | MailSendFailed | MailSendUnknown;

/**
 * Microsoft transports are kept behind this interface. An adapter must return
 * `unknown` if a request may have been accepted but the response was lost.
 * The queue must never infer a retry from a thrown error.
 */
export interface MailProvider {
  send(message: MailMessage, options?: { sendKey: string }): Promise<MailSendResult>;
}
