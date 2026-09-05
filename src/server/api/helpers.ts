import { validateRecipientRows } from "../../domain";
import type {
  AuditEventType,
  FlowRecord,
  RecipientConfiguration,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../../domain/types";
import {
  CSRF_COOKIE_NAME,
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  createCsrfToken,
  parseCookie,
  readSession,
  renewSession,
  serializeCookie,
  verifyCsrfToken,
} from "../auth/session";
import {
  AttachmentError,
} from "../attachments";
import { createD1AuthStores } from "../database/d1-auth";
import type { Repositories } from "../database/contracts";
import { cloudflareQueueAdapter, reserveCampaignWake } from "../queue";
import type { MailFlowContext, AuthenticatedSession } from "./context";
import { applicationOrigin, repositories, textEnv } from "./dependencies";
import { validationIssues } from "./schemas";
import { templatePlaceholders, validateTemplateHtml, validateTemplateSubject } from "./security";
import type { MailFlowVariables } from "./contracts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function sameOrigin(context: MailFlowContext): boolean {
  const requestUrl = new URL(context.req.url);
  if (applicationOrigin(context) !== requestUrl.origin) return false;
  const origin = context.req.header("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== requestUrl.origin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = context.req.header("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";
}

export function publicUser(user: MailFlowVariables["user"]): Record<string, unknown> {
  return {
    id: user.id,
    displayName: user.displayName,
    principalName: user.principalName,
    mailboxAddress: user.mailboxAddress,
  };
}

export function publicFlow(flow: FlowRecord): Record<string, unknown> {
  return { ...flow };
}

export function publicCampaign(campaign: import("../../domain/types").CampaignRecord): Record<string, unknown> {
  const {
    idempotencyKey: _idempotencyKey,
    requestFingerprint: _requestFingerprint,
    wakeToken: _wakeToken,
    wakeDueAt: _wakeDueAt,
    ...safe
  } = campaign;
  void _idempotencyKey;
  void _requestFingerprint;
  void _wakeToken;
  void _wakeDueAt;
  return safe;
}

export function publicJob(job: RecipientJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    campaignId: job.campaignId,
    sourceRow: job.sourceRow,
    recipient: job.recipient,
    cc: job.cc,
    bcc: job.bcc,
    replyTo: job.replyTo,
    importance: job.importance ?? "normal",
    status: job.status,
    attemptCount: job.attemptCount,
    claimedAt: job.claimedAt,
    sendingAt: job.sendingAt,
    acceptedAt: job.acceptedAt,
    nextAttemptAt: job.nextAttemptAt,
    lastErrorCategory: job.lastErrorCategory,
    lastErrorMessage: job.lastErrorMessage,
    providerMessageId: job.providerMessageId,
    providerRequestId: job.providerRequestId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function responseError(
  context: MailFlowContext,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
  code: string,
  message: string,
  issues?: readonly unknown[],
): Response {
  return context.json({ error: { code, message, ...(issues && issues.length > 0 ? { issues } : {}) } }, status);
}

export function attachmentErrorResponse(context: MailFlowContext, error: unknown): Response {
  if (!(error instanceof AttachmentError)) {
    console.warn("Attachment request failed", {
      name: error instanceof Error ? error.name : "unknown",
      code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
    });
    return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are temporarily unavailable. Try again shortly.");
  }
  if (error.transient && error.retryAfterSeconds) {
    context.header("Retry-After", String(error.retryAfterSeconds));
  }
  const status: 400 | 404 | 409 | 413 | 422 | 503 =
    error.code === "not_found" || error.code === "missing_object" ? 404
      : error.code === "immutable" || error.code === "already_associated" ? 409
        : error.code === "size_limit_exceeded" ? 413
          : error.code === "storage_missing" || error.code === "integrity_error" ? 409
            : ["authorization_error", "network_error", "throttled", "service_unavailable", "storage_error", "storage_temporary"].includes(error.code) ? 503
            : 422;
  const message = ["authorization_error", "network_error", "throttled", "service_unavailable", "storage_error", "storage_temporary"].includes(error.code)
    ? "Campaign attachments are temporarily unavailable. Try again shortly."
    : error.message;
  return responseError(context, status, `attachment_${error.code}`, message);
}

type JsonBodyResult =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "too_large" };

async function bodyJson(context: MailFlowContext, maxBytes?: number): Promise<JsonBodyResult> {
  const contentLength = context.req.header("Content-Length");
  if (maxBytes !== undefined && contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return { kind: "too_large" };
  }
  try {
    if (maxBytes === undefined) {
      const value = await context.req.json<unknown>();
      return value === null ? { kind: "invalid" } : { kind: "ok", value };
    }
    const body = context.req.raw.body;
    if (!body) return { kind: "invalid" };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = JSON.parse(text) as unknown;
    return value === null ? { kind: "invalid" } : { kind: "ok", value };
  } catch {
    return { kind: "invalid" };
  }
}

export async function requireSession(context: MailFlowContext): Promise<AuthenticatedSession | Response> {
  const sessionToken = parseCookie(context.req.header("Cookie"), SESSION_COOKIE_NAME);
  if (!sessionToken) return responseError(context, 401, "not_authenticated", "Sign in with your USM Microsoft account to continue.");
  const repo = repositories(context);
  const authStores = createD1AuthStores(context.env.DB);
  const session = await readSession(authStores.sessionStore, sessionToken);
  if (!session) return responseError(context, 401, "session_expired", "Your sign-in has expired. Sign in again, then resume from the first unsent row.");
  const user = await repo.users.getById(session.userId);
  if (!user) return responseError(context, 401, "session_expired", "Your sign-in has expired. Sign in again, then resume from the first unsent row.");
  const csrfToken = await csrfTokenFor(context, sessionToken);
  await renewSession(authStores.sessionStore, session);
  context.header("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
    secure: new URL(context.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: DEFAULT_SESSION_TTL_SECONDS,
  }), { append: true });
  return { user: {
    id: user.id,
    tenantId: user.tenantId,
    objectId: user.objectId,
    displayName: user.displayName,
    principalName: user.principalName,
    mailboxAddress: user.mailboxAddress,
  }, sessionToken, csrfToken };
}

export async function csrfTokenFor(context: MailFlowContext, sessionToken: string): Promise<string> {
  const secret = textEnv(context.env.SESSION_SECRET);
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const token = await createCsrfToken(sessionToken, secret);
  // CSRF is intentionally readable by browser JavaScript.  The session and
  // OAuth state cookies remain HttpOnly.
  const cookie = serializeCookie(CSRF_COOKIE_NAME, token, {
    secure: new URL(context.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: DEFAULT_SESSION_TTL_SECONDS,
  }).replace("; HttpOnly", "");
  context.header("Set-Cookie", cookie, { append: true });
  return token;
}

export async function requireMutationSession(context: MailFlowContext): Promise<AuthenticatedSession | Response> {
  if (!sameOrigin(context)) return responseError(context, 403, "same_origin_required", "This action must come from the Mail Flow website.");
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const provided = context.req.header("X-CSRF-Token") ?? context.req.header("X-XSRF-TOKEN");
  const secret = textEnv(context.env.SESSION_SECRET);
  if (!secret || !(await verifyCsrfToken(authenticated.sessionToken, provided, secret))) {
    return responseError(context, 403, "csrf_failed", "Refresh the page and try the action again.");
  }
  return authenticated;
}

export function routeParam(context: MailFlowContext, name: string): string {
  return context.req.param(name) ?? "";
}

export function audit(
  repo: Repositories,
  eventType: AuditEventType,
  values: { actorUserId?: string | null; campaignId?: string | null; recipientJobId?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  return repo.audit.append({
    id: id("audit"),
    actorUserId: values.actorUserId ?? null,
    campaignId: values.campaignId ?? null,
    recipientJobId: values.recipientJobId ?? null,
    eventType,
    metadata: values.metadata ?? {},
    createdAt: nowIso(),
  });
}

export function recipientAddressIssues(result: ReturnType<typeof validateRecipientRows>): readonly Record<string, unknown>[] {
  return result.issues.map((issue) => ({ code: issue.code, field: issue.field, row: issue.row, message: issue.message }));
}

export type RecipientConfigurationInput = {
  toField: string;
  ccField?: string | null;
  bccField?: string | null;
  replyToField?: string | null;
  ccFixed?: string | null;
  bccFixed?: string | null;
  replyToFixed?: string | null;
  placeholderMappings?: Readonly<Record<string, string>>;
  importance?: "low" | "normal" | "high";
  separator: "comma" | "semicolon" | "newline" | "auto";
};

/**
 * Normalize recipient settings at the persistence boundary. The JSON stored
 * by older template versions contains only the mapped column fields, so all
 * newly introduced values are optional on input and receive stable defaults
 * here. Fixed values and placeholder mappings are kept in the template
 * version; campaign rows still carry the already-resolved, validated values.
 */
export function versionConfigFromInput(input: RecipientConfigurationInput): RecipientConfiguration {
  const placeholderMappings: Record<string, string> = {};
  for (const [placeholder, field] of Object.entries(input.placeholderMappings ?? {})) {
    const normalizedPlaceholder = placeholder.trim();
    const normalizedField = field.trim();
    if (normalizedPlaceholder && normalizedField) placeholderMappings[normalizedPlaceholder] = normalizedField;
  }
  return {
    toField: input.toField.trim(),
    ccField: input.ccField?.trim() || null,
    bccField: input.bccField?.trim() || null,
    replyToField: input.replyToField?.trim() || null,
    ccFixed: input.ccFixed?.trim() || null,
    bccFixed: input.bccFixed?.trim() || null,
    replyToFixed: input.replyToFixed?.trim() || null,
    placeholderMappings,
    importance: input.importance ?? "normal",
    separator: input.separator,
  };
}

export async function createTemplateVersion(
  repo: Repositories,
  flow: FlowRecord,
  input: { subjectTemplate: string; bodyHtml: string; placeholderManifest?: readonly string[]; recipientConfiguration: TemplateVersionRecord["recipientConfiguration"] },
  publish = true,
): Promise<TemplateVersionRecord> {
  const subject = validateTemplateSubject(input.subjectTemplate);
  if (!subject.ok) throw new Error(subject.message);
  const body = validateTemplateHtml(input.bodyHtml);
  if (!body.ok) throw new Error(body.message);
  const versions = await repo.templateVersions.listByFlow(flow.id);
  const version: TemplateVersionRecord = {
    id: id("template"),
    flowId: flow.id,
    version: (versions[0]?.version ?? 0) + 1,
    subjectTemplate: subject.subject,
    bodyHtml: body.html,
    recipientConfiguration: input.recipientConfiguration,
    placeholderManifest: templatePlaceholders(subject.subject, body.html),
    createdAt: nowIso(),
  };
  await repo.templateVersions.create(version);
  const updatedFlow: FlowRecord = { ...flow, currentTemplateVersionId: version.id, updatedAt: version.createdAt };
  if (publish) await repo.flows.update(updatedFlow);
  return version;
}

function csvValue(value: string): string {
  const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export function jobCsv(jobs: readonly RecipientJobRecord[]): string {
  const columns = ["row_number", "recipient", "status", "attempt_count", "created_at", "claimed_at", "sending_at", "accepted_at", "last_error_category", "last_error_message"];
  const lines = [columns.join(",")];
  for (const job of jobs) {
    lines.push([
      String(job.sourceRow),
      job.recipient,
      job.status,
      String(job.attemptCount),
      job.createdAt,
      job.claimedAt ?? "",
      job.sendingAt ?? "",
      job.acceptedAt ?? "",
      job.lastErrorCategory ?? "",
      job.lastErrorMessage ?? "",
    ].map(csvValue).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export async function enqueueTick(
  context: MailFlowContext,
  campaignId: string,
  dueAt = nowIso(),
  message: string | null = null,
): Promise<{ reserved: boolean; published: boolean }> {
  if (!context.env.CAMPAIGN_QUEUE || typeof context.env.CAMPAIGN_QUEUE.send !== "function") throw new Error("Campaign queue is not configured on this Worker");
  const now = new Date();
  const result = await reserveCampaignWake({
    campaigns: repositories(context).campaigns,
    queue: cloudflareQueueAdapter(context.env.CAMPAIGN_QUEUE),
    campaignId,
    dueAt,
    message,
    now,
  });
  return { reserved: result.reserved, published: result.published };
}

export async function parseOrError<T>(
  context: MailFlowContext,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } },
  options: { readonly maxBytes?: number; readonly tooLargeCode?: string; readonly tooLargeMessage?: string } = {},
): Promise<T | Response> {
  const raw = await bodyJson(context, options.maxBytes ?? 2 * 1024 * 1024);
  if (raw.kind === "too_large") {
    return responseError(
      context,
      413,
      options.tooLargeCode ?? "request_too_large",
      options.tooLargeMessage ?? "The request body is too large.",
    );
  }
  if (raw.kind === "invalid") return responseError(context, 400, "invalid_json", "Send a valid JSON request body.");
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) return responseError(context, 422, "invalid_input", "Review the highlighted fields and try again.", validationIssues(parsed.error));
  return parsed.data;
}
