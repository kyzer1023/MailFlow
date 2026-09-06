import type { MailSendReconnect, MailSendRetryable } from "../../domain/mail-provider";
import { AuthFlowError } from "../auth/service";
import { OAuthProviderError } from "./oauth";
import type { AccessTokenSource } from "./adapter";

export function prepareMailAuthorization(source: AccessTokenSource) {
  let token = typeof source === "string" ? source : "";
  return {
    get token() { return token; },
    async prepare(): Promise<MailSendReconnect | MailSendRetryable | null> {
      if (token) return null;
      try {
        token = typeof source === "function" ? await source() : source;
        return token ? null : reconnectRequired();
      } catch (error) {
        return mailPreparationFailure(error);
      }
    },
  };
}

export const MAIL_RECONNECT_MESSAGE = "Reconnect Microsoft with the same account, then resume from the pending rows.";

export function reconnectRequired(category: "authentication" | "permission" = "authentication"): MailSendReconnect {
  return { kind: "reconnect_required", safeToRetry: true, category, message: MAIL_RECONNECT_MESSAGE };
}

/** Called only around token acquisition, where no message can have been submitted. */
export function mailPreparationFailure(error: unknown): MailSendReconnect | MailSendRetryable {
  if ((error instanceof AuthFlowError && error.category === "token")
    || (error instanceof OAuthProviderError && ["invalid_grant", "invalid_client", "access_denied", "configuration"].includes(error.category))
    || (error && typeof error === "object" && "code" in error && error.code === "refresh_token_crypto_failed")) {
    return reconnectRequired();
  }
  return { kind: "retryable", safeToRetry: true, category: "pre_send_temporary",
    message: "Microsoft authorization is temporarily unavailable. Sending will retry shortly.", retryAfter: 30 };
}
