import type {
  MailMessage,
  MailProvider,
  MailSendResult,
} from "../../domain/mail-provider";
import { GraphApiError, GraphMailProvider } from "./graph";
import { prepareMailAuthorization, reconnectRequired } from "./mail-authorization";

export type AccessTokenSource = string | (() => Promise<string>);

function categoryResult(error: GraphApiError): MailSendResult {
  switch (error.category) {
    case "throttled":
      return {
        kind: "retryable",
        safeToRetry: true,
        category: "throttle",
        message: error.message,
        retryAfter: error.retryAfterSeconds ?? null,
        providerRequestId: error.requestId ?? null,
      };
    case "network":
      return {
        kind: "unknown",
        category: "ambiguous",
        message: error.message,
        providerRequestId: error.requestId ?? null,
      };
    case "unauthorized":
      return { ...reconnectRequired("authentication"), providerRequestId: error.requestId ?? null };
    case "forbidden":
      return { ...reconnectRequired("permission"), providerRequestId: error.requestId ?? null };
    case "invalid_recipient":
      return { kind: "failed", category: "invalid_recipient", message: error.message, providerRequestId: error.requestId ?? null };
    case "invalid_request":
      return { kind: "failed", category: "invalid_message", message: error.message, providerRequestId: error.requestId ?? null };
    case "not_found":
    case "server":
      return { kind: "failed", category: "provider", message: error.message, providerRequestId: error.requestId ?? null };
    case "unknown":
      return { kind: "failed", category: "unknown", message: error.message, providerRequestId: error.requestId ?? null };
  }
}

/**
 * Bridge the Microsoft-specific adapter to the provider-neutral campaign
 * contract. A queue tick supplies one access-token source and this wrapper
 * deliberately maps ambiguous transport failures to `unknown`.
 */
export function delegatedGraphMailProvider(
  graph: GraphMailProvider,
  accessToken: AccessTokenSource,
): MailProvider {
  const authorization = prepareMailAuthorization(accessToken);
  return {
    prepare: () => authorization.prepare(),
    async send(message: MailMessage, _options): Promise<MailSendResult> {
      if (message.attachments?.length) {
        return { kind: "failed", category: "invalid_message", message: "The Graph fallback does not support attachments in this release" };
      }
      const failure = await authorization.prepare();
      if (failure) return failure;
      try {
        const bearer = authorization.token;
        const result = await graph.sendMail(bearer, {
          subject: message.subject,
          bodyHtml: message.htmlBody,
          to: [message.to],
          cc: [...message.cc],
          bcc: [...message.bcc],
          replyTo: [...message.replyTo],
          importance: message.importance ?? "normal",
          saveToSentItems: true,
        });
        return { kind: "accepted", providerMessageId: null, providerRequestId: result.requestId ?? null };
      } catch (error) {
        if (error instanceof GraphApiError) return categoryResult(error);

        return {
          kind: "unknown",
          category: "ambiguous",
          message: "The connection ended before Microsoft confirmed the message. The row is marked unknown and will not be resent automatically.",
          providerRequestId: null,
        };
      }
    },
  };
}
