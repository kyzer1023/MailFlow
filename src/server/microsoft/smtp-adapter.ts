import { safeErrorKind } from "../diagnostics";
import type { MailMessage, MailProvider, MailSendResult } from "../../domain/mail-provider";
import { prepareMailAuthorization, reconnectRequired } from "./mail-authorization";
import { ExchangeOnlineSmtpClient, SmtpProviderError } from "./smtp";
import type { AccessTokenSource } from "./adapter";

function smtpErrorResult(error: SmtpProviderError): MailSendResult {
  if (error.category === "authentication" || error.category === "permission") return reconnectRequired(error.category);
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
  const category = error.category === "invalid_recipient"
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
  const authorization = prepareMailAuthorization(accessToken);
  return {
    prepare: () => authorization.prepare(),
    async send(message: MailMessage, options?: { sendKey: string }): Promise<MailSendResult> {
      const failure = await authorization.prepare();
      if (failure) return failure;
      try {
        await smtp.send(authorization.token, mailboxAddress, message, { sendKey: options?.sendKey });
        return { kind: "accepted", providerMessageId: null, providerRequestId: null };
      } catch (error) {
        if (error instanceof SmtpProviderError) return { ...smtpErrorResult(error), diagnosticId: error.diagnosticId };
        console.warn("Unexpected SMTP adapter failure", {
          classification: safeErrorKind(error),
        });
        return { kind: "unknown", category: "transport", message: "The SMTP transport ended without a safe outcome" };
      }
    },
  };
}
