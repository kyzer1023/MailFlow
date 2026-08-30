/** The provider-neutral message passed to the Microsoft Graph adapter. */
export interface MailMessage {
  to: string;
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: readonly string[];
  subject: string;
  htmlBody: string;
}

export interface MailSendAccepted {
  kind: "accepted";
  providerMessageId?: string | null;
  providerRequestId?: string | null;
}

export interface MailSendRetryable {
  kind: "retryable";
  /** Must be true only when the adapter knows Graph did not receive the send. */
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
 * Microsoft Graph is kept behind this interface. In particular, a Graph
 * adapter must return `unknown` if a request may have reached Graph but the
 * response was lost. The queue must never infer a retry from a thrown error.
 */
export interface MailProvider {
  send(message: MailMessage, options?: { sendKey: string }): Promise<MailSendResult>;
}

