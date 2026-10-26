import type { MailMessage, MailProvider, MailSendResult } from "../../domain/mail-provider";
import { buildMimeMessageChunks, smtpMimeIdentityForSendKey } from "../microsoft/smtp-mime";
import { prepareMailAuthorization } from "../microsoft/mail-authorization";

export const GMAIL_MAX_MIME_BYTES = 35_000_000;

export async function gmailMime(message: MailMessage, senderAddress: string, sendKey: string) {
  const options = { senderAddress, includeBcc: true, ...await smtpMimeIdentityForSendKey(sendKey) };
  const encoder = new TextEncoder();
  let byteLength = 0;
  for (const chunk of buildMimeMessageChunks(message, options)) byteLength += encoder.encode(chunk).byteLength;
  if (byteLength > GMAIL_MAX_MIME_BYTES) throw new Error("Encoded message exceeds Gmail's upload limit");
  const chunks = buildMimeMessageChunks(message, options)[Symbol.iterator]();
  return { byteLength, body: new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value));
    }, cancel() { chunks.return?.(); },
  }) };
}

export function gmailMailProvider(tokenSource: () => Promise<string>, senderAddress: string, fetchImpl: typeof fetch = fetch): MailProvider {
  const authorization = prepareMailAuthorization(tokenSource);
  const prepare = async () => {
    const failure = await authorization.prepare();
    return failure ? { ...failure, message: failure.kind === "reconnect_required"
      ? "Reconnect Google with the same account, then resume pending rows."
      : "Google authorization is temporarily unavailable. Sending will retry shortly." } : null;
  };
  return { prepare, async send(message, options): Promise<MailSendResult> {
    const failure = await prepare();
    if (failure) return failure;
    let mime;
    try { mime = await gmailMime(message, senderAddress, options?.sendKey ?? crypto.randomUUID()); }
    catch { return { kind: "failed", category: "invalid_message", message: "The message exceeds Gmail MIME safety limits or has invalid headers." }; }
    let response: Response;
    try {
      options?.onSubmissionStart?.();
      response = await fetchImpl("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
        method: "POST", headers: { Authorization: `Bearer ${authorization.token}`, "Content-Type": "message/rfc822" },
        body: mime.body, signal: AbortSignal.timeout(60_000), duplex: "half",
      } as RequestInit);
    } catch { return { kind: "unknown", category: "transport", message: "Gmail submission could not be confirmed. Check receipt manually before any new send." }; }
    if (response.ok) {
      try {
        const result = await response.json() as { id?: string };
        if (typeof result.id === "string" && result.id) return { kind: "accepted", providerMessageId: result.id };
      } catch {}
      return { kind: "unknown", category: "ambiguous", message: "Gmail returned an incomplete acceptance response. Check receipt manually." };
    }
    if (response.status >= 500 || response.status === 408) return { kind: "unknown", category: "ambiguous", message: "Gmail submission could not be confirmed. Check receipt manually." };
    let reason = "";
    try { const payload = await response.json() as { error?: { errors?: { reason?: string }[] } }; reason = payload.error?.errors?.[0]?.reason ?? ""; } catch { reason = ""; }
    if (response.status === 429 || ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(reason)) {
      return { kind: "retryable", safeToRetry: true, category: "throttle", message: "Gmail requested a quota pause. Sending will retry later.",
        retryAfter: response.headers.get("Retry-After") ?? (reason === "dailyLimitExceeded" ? 86_400 : 900) };
    }
    if (response.status === 401 || response.status === 403) return { kind: "reconnect_required", safeToRetry: true,
      category: response.status === 401 ? "authentication" : "permission", message: "Reconnect Google with the same account, then resume pending rows." };
    return { kind: "failed", category: response.status === 400 ? "invalid_message" : "provider", message: "Gmail rejected the message." };
  } };
}
