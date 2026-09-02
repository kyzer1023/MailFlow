import type { MailMessage, MailProvider, MailSendResult } from "../../domain/mail-provider";
import { OAuthProviderError } from "./oauth";
import { ExchangeOnlineSmtpClient, SmtpProviderError } from "./smtp";
import type { AccessTokenSource } from "./adapter";

function smtpErrorResult(error: SmtpProviderError): MailSendResult {
  if (error.category === "ambiguous") return { kind: "unknown", category: "ambiguous", message: error.message };
  if (error.category === "network" && !error.safeToRetry) return { kind: "unknown", category: "transport", message: error.message };
  if (error.safeToRetry) {
    return {
      kind: "retryable",
      safeToRetry: true,
      category: error.category === "temporary" ? "throttle" : "network_before_send",
      message: error.message,
    };
  }
  const category = error.category === "authentication"
    ? "authentication"
    : error.category === "permission"
      ? "permission"
      : error.category === "invalid_recipient"
        ? "invalid_recipient"
        : error.category === "invalid_message"
          ? "invalid_message"
          : error.category === "policy"
            ? "policy"
            : "provider";
  return { kind: "failed", category, message: error.message };
}

export function delegatedSmtpMailProvider(
  smtp: ExchangeOnlineSmtpClient,
  accessToken: AccessTokenSource,
  mailboxAddress: string,
): MailProvider {
  return {
    async send(message: MailMessage): Promise<MailSendResult> {
      try {
        const bearer = typeof accessToken === "function" ? await accessToken() : accessToken;
        await smtp.send(bearer, mailboxAddress, message);
        return { kind: "accepted", providerMessageId: null, providerRequestId: null };
      } catch (error) {
        if (error instanceof SmtpProviderError) return smtpErrorResult(error);
        if (error instanceof OAuthProviderError) {
          if (error.category === "network" || error.category === "temporarily_unavailable") {
            return { kind: "retryable", safeToRetry: true, category: "pre_send_temporary", message: error.message };
          }
          return { kind: "failed", category: "authentication", message: error.message };
        }
        return { kind: "unknown", category: "transport", message: "The SMTP transport ended without a safe outcome" };
      }
    },
  };
}
