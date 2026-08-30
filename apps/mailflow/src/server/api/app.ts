import { Hono } from "hono";
import type { Context } from "hono";
import { makeSendKey, validateRecipientRows } from "../../domain";
import type {
  AuditEventType,
  CampaignRecord,
  FlowRecord,
  RecipientConfiguration,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../../domain/types";
import {
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  createCsrfToken,
  parseCookie,
  readSession,
  revokeSession,
  serializeCookie,
  verifyCsrfToken,
} from "../auth/session";
import { AuthFlowError, MicrosoftAuthService } from "../auth/service";
import { createD1AuthStores } from "../database/d1-auth";
import { createD1Repositories } from "../database/d1";
import type { Repositories } from "../database/contracts";
import { delegatedGraphMailProvider, GraphApiError, GraphMailProvider, sendTestToSelf } from "../microsoft";
import { OAuthProviderError } from "../microsoft/oauth";
import { handleCampaignQueueMessage, cloudflareQueueAdapter } from "../queue";
import {
  acknowledgementSchema,
  campaignCreateSchema,
  flowCreateSchema,
  flowUpdateSchema,
  pauseSchema,
  templateVersionSchema,
  testSendSchema,
  validationIssues,
} from "./schemas";
import type { MailFlowBindings, MailFlowExecutionContext, MailFlowVariables, QueueBatch } from "./contracts";
import { isCampaignTickMessage } from "./contracts";
import {
  safeSourceFilename,
  templatePlaceholders,
  validateTemplateHtml,
  validateTemplateSubject,
} from "./security";

export type MailFlowAppEnv = {
  Bindings: MailFlowBindings;
  Variables: MailFlowVariables;
};

export type MailFlowContext = Context<MailFlowAppEnv>;

const app = new Hono<MailFlowAppEnv>();

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function textEnv(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

function integerEnv(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function repositories(context: MailFlowContext): Repositories {
  return createD1Repositories(context.env.DB);
}

function sameOrigin(context: MailFlowContext): boolean {
  const requestUrl = new URL(context.req.url);
  const configured = textEnv(context.env.PUBLIC_ORIGIN);
  if (configured) {
    try {
      if (new URL(configured).origin !== requestUrl.origin) return false;
    } catch {
      return false;
    }
  }
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

function publicUser(user: MailFlowVariables["user"]): Record<string, unknown> {
  return {
    id: user.id,
    displayName: user.displayName,
    principalName: user.principalName,
    mailboxAddress: user.mailboxAddress,
  };
}

function publicFlow(flow: FlowRecord): Record<string, unknown> {
  return { ...flow };
}

function publicCampaign(campaign: CampaignRecord): Record<string, unknown> {
  const { idempotencyKey: _idempotencyKey, ...safe } = campaign;
  void _idempotencyKey;
  return safe;
}

function publicJob(job: RecipientJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    campaignId: job.campaignId,
    sourceRow: job.sourceRow,
    recipient: job.recipient,
    cc: job.cc,
    bcc: job.bcc,
    replyTo: job.replyTo,
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

function responseError(
  context: MailFlowContext,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 502 | 503,
  code: string,
  message: string,
  issues?: readonly unknown[],
): Response {
  return context.json({ error: { code, message, ...(issues && issues.length > 0 ? { issues } : {}) } }, status);
}

async function bodyJson(context: MailFlowContext): Promise<unknown | null> {
  try {
    return await context.req.json<unknown>();
  } catch {
    return null;
  }
}

async function requireSession(context: MailFlowContext): Promise<{ user: MailFlowVariables["user"]; sessionToken: string; csrfToken: string } | Response> {
  const sessionToken = parseCookie(context.req.header("Cookie"), SESSION_COOKIE_NAME);
  if (!sessionToken) return responseError(context, 401, "not_authenticated", "Sign in with your USM Microsoft account to continue.");
  const repo = repositories(context);
  const session = await readSession(createD1AuthStores(context.env.DB).sessionStore, sessionToken);
  if (!session) return responseError(context, 401, "session_expired", "Your sign-in has expired. Sign in again, then resume from the first unsent row.");
  const user = await repo.users.getById(session.userId);
  if (!user) return responseError(context, 401, "session_expired", "Your sign-in has expired. Sign in again, then resume from the first unsent row.");
  const csrfToken = await csrfTokenFor(context, sessionToken);
  return { user: {
    id: user.id,
    tenantId: user.tenantId,
    objectId: user.objectId,
    displayName: user.displayName,
    principalName: user.principalName,
    mailboxAddress: user.mailboxAddress,
  }, sessionToken, csrfToken };
}

async function csrfTokenFor(context: MailFlowContext, sessionToken: string): Promise<string> {
  const secret = textEnv(context.env.SESSION_SECRET);
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const token = await createCsrfToken(sessionToken, secret);
  // CSRF is intentionally readable by browser JavaScript.  The session and
  // OAuth state cookies remain HttpOnly.
  const cookie = serializeCookie(CSRF_COOKIE_NAME, token, {
    secure: new URL(context.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 60 * 60 * 8,
  }).replace("; HttpOnly", "");
  context.header("Set-Cookie", cookie, { append: true });
  return token;
}

async function requireMutationSession(context: MailFlowContext): Promise<{ user: MailFlowVariables["user"]; sessionToken: string; csrfToken: string } | Response> {
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

function configFor(context: MailFlowContext, redirectOrigin?: string): { graph: GraphMailProvider; auth: MicrosoftAuthService } {
  const tenantId = textEnv(context.env.ENTRA_TENANT_ID);
  const clientId = textEnv(context.env.ENTRA_CLIENT_ID);
  const clientSecret = textEnv(context.env.ENTRA_CLIENT_SECRET);
  const tokenSecret = textEnv(context.env.TOKEN_ENCRYPTION_KEY_B64);
  const sessionSecret = textEnv(context.env.SESSION_SECRET);
  if (!tenantId || !clientId || !clientSecret || !tokenSecret || !sessionSecret) throw new Error("Microsoft sign-in is not configured on this Worker");
  const origin = redirectOrigin ?? textEnv(context.env.PUBLIC_ORIGIN, new URL(context.req.url).origin);
  const redirectUri = new URL("/auth/microsoft/callback", origin).toString();
  const config = {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
  };
  const graph = new GraphMailProvider({ requestTimeoutMs: 30_000 });
  const stores = createD1AuthStores(context.env.DB);
  const auth = new MicrosoftAuthService(config, graph, {
    userStore: stores.userStore,
    sessionStore: stores.sessionStore,
    tokenStore: stores.tokenStore,
    stateStore: stores.stateStore,
    stateSecret: sessionSecret,
    tokenEncryptionSecret: tokenSecret,
    secureCookies: new URL(context.req.url).protocol === "https:",
    sessionCookie: { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" },
  });
  return { graph, auth };
}

function routeParam(context: MailFlowContext, name: string): string {
  return context.req.param(name) ?? "";
}

function audit(
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

function recipientAddressIssues(result: ReturnType<typeof validateRecipientRows>): readonly Record<string, unknown>[] {
  return result.issues.map((issue) => ({ code: issue.code, field: issue.field, row: issue.row, message: issue.message }));
}

type RecipientConfigurationInput = {
  toField: string;
  ccField?: string | null;
  bccField?: string | null;
  replyToField?: string | null;
  ccFixed?: string | null;
  bccFixed?: string | null;
  replyToFixed?: string | null;
  placeholderMappings?: Readonly<Record<string, string>>;
  separator: "comma" | "semicolon" | "newline" | "auto";
};

/**
 * Normalize recipient settings at the persistence boundary. The JSON stored
 * by older template versions contains only the mapped column fields, so all
 * newly introduced values are optional on input and receive stable defaults
 * here. Fixed values and placeholder mappings are kept in the template
 * version; campaign rows still carry the already-resolved, validated values.
 */
function versionConfigFromInput(input: RecipientConfigurationInput): RecipientConfiguration {
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
    separator: input.separator,
  };
}

async function createTemplateVersion(
  repo: Repositories,
  flow: FlowRecord,
  input: { subjectTemplate: string; bodyHtml: string; placeholderManifest?: readonly string[]; recipientConfiguration: TemplateVersionRecord["recipientConfiguration"] },
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
  await repo.flows.update(updatedFlow);
  return version;
}

function csvValue(value: string): string {
  const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

function jobCsv(jobs: readonly RecipientJobRecord[]): string {
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

async function enqueueTick(context: MailFlowContext, campaignId: string): Promise<void> {
  if (!context.env.CAMPAIGN_QUEUE || typeof context.env.CAMPAIGN_QUEUE.send !== "function") throw new Error("Campaign queue is not configured on this Worker");
  await cloudflareQueueAdapter(context.env.CAMPAIGN_QUEUE).enqueue({ type: "campaign.tick", campaignId }, { delaySeconds: 0 });
}

async function parseOrError<T>(context: MailFlowContext, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: import("zod").ZodError } }): Promise<T | Response> {
  const raw = await bodyJson(context);
  if (raw === null) return responseError(context, 400, "invalid_json", "Send a valid JSON request body.");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return responseError(context, 422, "invalid_input", "Review the highlighted fields and try again.", validationIssues(parsed.error));
  return parsed.data;
}

// --- Authentication -------------------------------------------------------

app.get("/auth/microsoft/start", async (context) => {
  try {
    const returnTo = new URL(context.req.url).searchParams.get("returnTo") ?? "/dashboard";
    const { auth } = configFor(context);
    const started = await auth.beginSignIn(returnTo);
    context.header("Set-Cookie", started.stateCookie);
    return context.redirect(started.authorizationUrl, 302);
  } catch {
    return responseError(context, 503, "auth_unavailable", "Microsoft sign-in is not configured yet.");
  }
});

app.get("/auth/microsoft/callback", async (context) => {
  const query = new URL(context.req.url).searchParams;
  const error = query.get("error");
  if (error) return context.redirect("/?auth=cancelled", 302);
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state) return context.redirect("/?auth=invalid", 302);
  try {
    const { auth } = configFor(context);
    const completed = await auth.completeSignIn({ code, state, cookieHeader: context.req.header("Cookie") });
    context.header("Set-Cookie", completed.sessionCookie, { append: true });
    context.header("Set-Cookie", completed.stateCookie, { append: true });
    await csrfTokenFor(context, completed.sessionToken);
    return context.redirect(completed.returnTo, 302);
  } catch (errorValue) {
    void errorValue;
    return context.redirect("/?auth=failed", 302);
  }
});

app.post("/auth/logout", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const stores = createD1AuthStores(context.env.DB);
  await revokeSession(stores.sessionStore, authenticated.sessionToken);
  context.header("Set-Cookie", clearCookie(SESSION_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
  context.header("Set-Cookie", clearCookie(CSRF_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
  context.header("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
  return context.json({ ok: true });
});

app.get("/api/me", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  return context.json({
    user: publicUser(authenticated.user),
    csrfToken: authenticated.csrfToken,
    config: {
      defaultPacePerMinute: integerEnv(context.env.DEFAULT_CAMPAIGN_PACE, 12, 1, 600),
      maxCampaignRecipients: integerEnv(context.env.MAX_CAMPAIGN_RECIPIENTS, 300, 1, 300),
    },
  });
});

// --- Flows and template versions -----------------------------------------

app.get("/api/flows", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const flows = await repositories(context).flows.listByOwner(authenticated.user.id);
  return context.json({ flows: flows.map(publicFlow) });
});

app.post("/api/flows", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, flowCreateSchema);
  if (input instanceof Response) return input;
  if ((input.subjectTemplate === undefined) !== (input.bodyHtml === undefined)) return responseError(context, 422, "invalid_input", "A subject and message body must be provided together.");
  const repo = repositories(context);
  const createdAt = nowIso();
  const flow: FlowRecord = {
    id: id("flow"),
    ownerUserId: authenticated.user.id,
    societyName: input.societyName ?? null,
    name: input.name,
    currentTemplateVersionId: null,
    state: "active",
    createdAt,
    updatedAt: createdAt,
  };
  await repo.flows.create(flow);
  let version: TemplateVersionRecord | null = null;
  if (input.subjectTemplate !== undefined && input.bodyHtml !== undefined) {
    version = await createTemplateVersion(repo, flow, {
      subjectTemplate: input.subjectTemplate,
      bodyHtml: input.bodyHtml,
      placeholderManifest: input.placeholderManifest,
      recipientConfiguration: versionConfigFromInput(input.recipientConfiguration ?? { toField: "", separator: "auto" }),
    });
    flow.currentTemplateVersionId = version.id;
    flow.updatedAt = version.createdAt;
  }
  return context.json({ flow: publicFlow(flow), templateVersion: version }, 201);
});

app.get("/api/flows/:id", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const flow = await repositories(context).flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
  const templateVersion = flow.currentTemplateVersionId ? await repositories(context).templateVersions.getById(flow.currentTemplateVersionId) : null;
  return context.json({ flow: publicFlow(flow), templateVersion });
});

async function updateFlow(context: MailFlowContext): Promise<Response> {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, flowUpdateSchema);
  if (input instanceof Response) return input;
  const repo = repositories(context);
  const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
  const updated: FlowRecord = { ...flow, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.societyName !== undefined ? { societyName: input.societyName } : {}), ...(input.state !== undefined ? { state: input.state } : {}), updatedAt: nowIso() };
  if (!(await repo.flows.update(updated))) return responseError(context, 409, "flow_changed", "The flow changed in another session. Refresh and try again.");
  return context.json({ flow: publicFlow(updated) });
}

app.patch("/api/flows/:id", updateFlow);
app.put("/api/flows/:id", updateFlow);

app.get("/api/flows/:id/versions", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const repo = repositories(context);
  const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
  const versions = await repo.templateVersions.listByFlow(flow.id);
  return context.json({ versions });
});

app.post("/api/flows/:id/versions", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, templateVersionSchema);
  if (input instanceof Response) return input;
  const repo = repositories(context);
  const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
  try {
    const version = await createTemplateVersion(repo, flow, {
      ...input,
      recipientConfiguration: versionConfigFromInput(input.recipientConfiguration),
    });
    return context.json({ version }, 201);
  } catch (errorValue) {
    const message = errorValue instanceof Error ? errorValue.message : "The template could not be saved.";
    return responseError(context, 422, "invalid_template", message);
  }
});

// --- Campaigns ------------------------------------------------------------

app.get("/api/campaigns", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const rawLimit = new URL(context.req.url).searchParams.get("limit");
  const limit = rawLimit ? integerEnv(rawLimit, 50, 1, 200) : 50;
  const campaigns = await repositories(context).campaigns.listByOwner(authenticated.user.id, limit);
  return context.json({ campaigns: campaigns.map(publicCampaign) });
});

app.post("/api/campaigns", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, campaignCreateSchema);
  if (input instanceof Response) return input;
  const maxRecipients = integerEnv(context.env.MAX_CAMPAIGN_RECIPIENTS, 300, 1, 300);
  const pacePerMinute = input.pacePerMinute ?? integerEnv(context.env.DEFAULT_CAMPAIGN_PACE, 12, 1, 600);
  if (input.totalRecipients > maxRecipients || input.rows.length > maxRecipients) return responseError(context, 413, "campaign_too_large", `Campaigns are limited to ${maxRecipients} rows.`);
  if (input.totalRecipients !== input.validRecipients + input.skippedRecipients || input.validRecipients !== input.rows.length || input.validRecipients < 1) {
    return responseError(context, 422, "invalid_recipient_totals", "The recipient totals no longer match the validated rows. Validate the workbook again.");
  }
  const subject = validateTemplateSubject(input.subjectTemplate);
  const body = validateTemplateHtml(input.bodyHtml);
  if (!subject.ok) return responseError(context, 422, "invalid_template", subject.message);
  if (!body.ok) return responseError(context, 422, "invalid_template", body.message);
  const placeholders = templatePlaceholders(subject.subject, body.html);
  if (input.placeholderManifest.length > 0 && JSON.stringify([...input.placeholderManifest].sort()) !== JSON.stringify([...placeholders].sort())) {
    return responseError(context, 422, "template_changed", "The template fields changed after validation. Review the message again.");
  }
  // Recipient metadata is deliberately sourced from the validated row
  // payload. The saved configuration describes how the browser produced the
  // rows; it must not be re-applied here or a fixed/mapped value could be
  // duplicated when a campaign is retried.
  const rowResult = validateRecipientRows(input.rows.map((row) => ({
    sourceRow: row.sourceRow,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    replyTo: row.replyTo,
    mergeData: row.mergeData,
  })), input.recipientConfiguration.separator);
  if (rowResult.issues.length > 0 || rowResult.validRows.length !== input.rows.length) {
    return responseError(context, 422, "invalid_recipients", "Review the recipient rows before starting the campaign.", recipientAddressIssues(rowResult));
  }
  const sourceRows = new Set<number>();
  for (const row of input.rows) {
    if (sourceRows.has(row.sourceRow)) return responseError(context, 422, "duplicate_source_row", "Each spreadsheet row may appear only once.");
    sourceRows.add(row.sourceRow);
    const renderedSubject = validateTemplateSubject(row.renderedSubject);
    const renderedBody = validateTemplateHtml(row.renderedBodyHtml);
    if (!renderedSubject.ok || !renderedBody.ok || /\{\{\s*[A-Za-z0-9][A-Za-z0-9_.-]*\s*\}\}/u.test(row.renderedSubject) || /\{\{\s*[A-Za-z0-9][A-Za-z0-9_.-]*\s*\}\}/u.test(row.renderedBodyHtml)) {
      return responseError(context, 422, "invalid_rendered_message", "One rendered message is no longer safe or still contains an unmapped field. Review the message again.");
    }
  }
  const repo = repositories(context);
  const existingCampaign = await repo.campaigns.getByIdempotencyKey(authenticated.user.id, input.idempotencyKey);
  if (existingCampaign) {
    return context.json({
      campaign: publicCampaign(existingCampaign),
      counts: await repo.recipientJobs.counts(existingCampaign.id),
    });
  }
  const flow = await repo.flows.getByIdForOwner(input.flowId, authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "Save the flow before creating a campaign.");
  let templateVersion = input.templateVersionId ? await repo.templateVersions.getById(input.templateVersionId) : null;
  if (templateVersion && templateVersion.flowId !== flow.id) return responseError(context, 404, "template_not_found", "That template version is not available.");
  if (templateVersion && (templateVersion.subjectTemplate !== subject.subject || templateVersion.bodyHtml !== body.html || JSON.stringify(versionConfigFromInput(templateVersion.recipientConfiguration)) !== JSON.stringify(versionConfigFromInput(input.recipientConfiguration)))) {
    return responseError(context, 422, "template_changed", "The selected template changed after validation. Review and save it again.");
  }
  if (!templateVersion) {
    try {
      templateVersion = await createTemplateVersion(repo, flow, {
        subjectTemplate: subject.subject,
        bodyHtml: body.html,
        placeholderManifest: placeholders,
        recipientConfiguration: versionConfigFromInput(input.recipientConfiguration),
      });
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : "The template could not be saved.";
      return responseError(context, 422, "invalid_template", message);
    }
  }
  const createdAt = nowIso();
  const campaignId = id("campaign");
  const jobs: RecipientJobRecord[] = input.rows.map((row) => ({
    id: id("job"),
    campaignId,
    sourceRow: row.sourceRow,
    recipient: row.to.trim().toLowerCase(),
    cc: row.cc.map((address) => address.trim().toLowerCase()),
    bcc: row.bcc.map((address) => address.trim().toLowerCase()),
    replyTo: row.replyTo.map((address) => address.trim().toLowerCase()),
    mergeData: row.mergeData,
    renderedSubject: row.renderedSubject.trim(),
    renderedBodyHtml: row.renderedBodyHtml.trim(),
    sendKey: makeSendKey(campaignId, row.sourceRow),
    status: "pending",
    attemptCount: 0,
    claimToken: null,
    claimedAt: null,
    sendingAt: null,
    acceptedAt: null,
    nextAttemptAt: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    providerMessageId: null,
    providerRequestId: null,
    createdAt,
    updatedAt: createdAt,
  }));
  const campaign: CampaignRecord = {
    id: campaignId,
    flowId: flow.id,
    templateVersionId: templateVersion.id,
    ownerUserId: authenticated.user.id,
    senderAddress: authenticated.user.mailboxAddress,
    sourceFilename: safeSourceFilename(input.sourceFilename),
    totalRecipients: input.totalRecipients,
    validRecipients: input.validRecipients,
    skippedRecipients: input.skippedRecipients,
    pacePerMinute,
    state: "draft",
    pauseReason: null,
    idempotencyKey: input.idempotencyKey,
    createdAt,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: createdAt,
  };
  try {
    await repo.campaigns.create(campaign, jobs);
  } catch (errorValue) {
    const message = errorValue instanceof Error ? errorValue.message : "";
    if (/unique|constraint/iu.test(message)) {
      const concurrentCampaign = await repo.campaigns.getByIdempotencyKey(authenticated.user.id, input.idempotencyKey);
      if (concurrentCampaign) {
        return context.json({
          campaign: publicCampaign(concurrentCampaign),
          counts: await repo.recipientJobs.counts(concurrentCampaign.id),
        });
      }
      return responseError(context, 409, "duplicate_idempotency_key", "A campaign with this request key already exists.");
    }
    throw errorValue;
  }
  await repo.campaigns.markValidated(campaign.id, authenticated.user.id, nowIso());
  const validated = (await repo.campaigns.getById(campaign.id)) ?? { ...campaign, state: "validated" as const };
  await audit(repo, "campaign.created", { actorUserId: authenticated.user.id, campaignId: campaign.id, metadata: { totalRecipients: campaign.totalRecipients, validRecipients: campaign.validRecipients, skippedRecipients: campaign.skippedRecipients } });
  await audit(repo, "campaign.validated", { actorUserId: authenticated.user.id, campaignId: campaign.id });
  return context.json({ campaign: publicCampaign(validated), counts: await repo.recipientJobs.counts(campaign.id) }, 201);
});

app.get("/api/campaigns/:id", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  return context.json({ campaign: publicCampaign(campaign), counts: await repo.recipientJobs.counts(campaign.id) });
});

app.get("/api/campaigns/:id/jobs", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  const search = new URL(context.req.url).searchParams;
  const limit = integerEnv(search.get("limit") ?? undefined, 100, 1, 500);
  const offset = integerEnv(search.get("offset") ?? undefined, 0, 0, 10_000);
  const jobs = await repo.recipientJobs.listByCampaign(campaign.id, limit, offset);
  return context.json({ jobs: jobs.map(publicJob), counts: await repo.recipientJobs.counts(campaign.id), limit, offset });
});

app.get("/api/campaigns/:id/export.csv", async (context) => {
  const authenticated = await requireSession(context);
  if (authenticated instanceof Response) return authenticated;
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  const jobs: RecipientJobRecord[] = [];
  for (let offset = 0; offset < 10_000; offset += 500) {
    const page = await repo.recipientJobs.listByCampaign(campaign.id, 500, offset);
    jobs.push(...page);
    if (page.length < 500) break;
  }
  context.header("Content-Type", "text/csv; charset=utf-8");
  context.header("Content-Disposition", `attachment; filename="${campaign.id}-results.csv"`);
  return context.body(jobCsv(jobs));
});

app.post("/api/campaigns/:id/test-send", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, testSendSchema);
  if (input instanceof Response) return input;
  const subject = validateTemplateSubject(input.subject);
  if (!subject.ok) return responseError(context, 422, "invalid_template", subject.message);
  const body = validateTemplateHtml(input.bodyHtml);
  if (!body.ok) return responseError(context, 422, "invalid_template", body.message);
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  try {
    const { auth, graph } = configFor(context);
    const tokens = await auth.refreshUserAccessToken(authenticated.user.id);
    const result = await sendTestToSelf(graph, tokens.accessToken, { subject: subject.subject, bodyHtml: body.html });
    return context.json({ result });
  } catch (errorValue) {
    const message = errorValue instanceof GraphApiError || errorValue instanceof AuthFlowError || errorValue instanceof OAuthProviderError
      ? errorValue.message
      : "The test message could not be accepted by Microsoft.";
    const status = errorValue instanceof GraphApiError && errorValue.category === "unauthorized"
      ? 401
      : errorValue instanceof GraphApiError && errorValue.category === "forbidden"
        ? 403
        : errorValue instanceof AuthFlowError && errorValue.category === "token"
          ? 401
          : 502;
    return responseError(context, status, "test_send_failed", message);
  }
});

async function startCampaign(context: MailFlowContext): Promise<Response> {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, acknowledgementSchema);
  if (input instanceof Response) return input;
  void input;
  const repo = repositories(context);
  const idValue = routeParam(context, "id");
  const campaign = await repo.campaigns.getByIdForOwner(idValue, authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  if (campaign.state !== "validated") return responseError(context, 409, "campaign_not_ready", "Review and validate the campaign before starting it.");
  if (!(await repo.campaigns.queue(campaign.id, authenticated.user.id, nowIso()))) return responseError(context, 409, "campaign_changed", "The campaign changed in another session. Refresh and try again.");
  try {
    await enqueueTick(context, campaign.id);
  } catch {
    await repo.campaigns.fail(campaign.id, nowIso(), "The campaign queue is unavailable. No message was sent.");
    return responseError(context, 503, "queue_unavailable", "The campaign queue is unavailable. No message was sent.");
  }
  await audit(repo, "campaign.queued", { actorUserId: authenticated.user.id, campaignId: campaign.id });
  return context.json({ campaign: publicCampaign((await repo.campaigns.getById(campaign.id)) ?? campaign) });
}

app.post("/api/campaigns/:id/start", startCampaign);

app.post("/api/campaigns/:id/pause", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, pauseSchema);
  if (input instanceof Response) return input;
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  if (!(await repo.campaigns.pause(campaign.id, authenticated.user.id, nowIso(), input.reason ?? "Paused by member"))) return responseError(context, 409, "campaign_changed", "Only a queued or running campaign can be paused.");
  await audit(repo, "campaign.paused", { actorUserId: authenticated.user.id, campaignId: campaign.id, metadata: { reason: input.reason ?? "Paused by member" } });
  return context.json({ campaign: publicCampaign((await repo.campaigns.getById(campaign.id)) ?? campaign) });
});

app.post("/api/campaigns/:id/resume", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const repo = repositories(context);
  const campaign = await repo.campaigns.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!campaign) return responseError(context, 404, "campaign_not_found", "That campaign is not available.");
  if (!(await repo.campaigns.resume(campaign.id, authenticated.user.id, nowIso()))) return responseError(context, 409, "campaign_changed", "Only a paused campaign can be resumed.");
  try {
    await enqueueTick(context, campaign.id);
  } catch {
    return responseError(context, 503, "queue_unavailable", "The campaign resumed in storage, but the queue is currently unavailable.");
  }
  await audit(repo, "campaign.resumed", { actorUserId: authenticated.user.id, campaignId: campaign.id });
  return context.json({ campaign: publicCampaign((await repo.campaigns.getById(campaign.id)) ?? campaign) });
});

// API misses must remain JSON.  The Worker entrypoint applies the SPA shell
// only to unknown browser document requests outside /api and /auth.
app.notFound((context) => {
  if (new URL(context.req.url).pathname.startsWith("/api/") || new URL(context.req.url).pathname.startsWith("/auth/")) {
    return responseError(context, 404, "not_found", "The requested Mail Flow route was not found.");
  }
  return context.body(null, 404);
});

app.onError((error, context) => {
  // Do not send provider response bodies, request URLs, or stack traces to the
  // browser.  The Worker platform can retain its own redacted request logs.
  void error;
  return responseError(context, 500, "internal_error", "Mail Flow could not complete that request. Try again.");
});

export { app };

export async function processQueueBatch(batch: QueueBatch<unknown>, bindings: MailFlowBindings): Promise<void> {
  const queueContext = {
    env: bindings,
    req: { url: textEnv(bindings.PUBLIC_ORIGIN, "https://mailflow.invalid") } as MailFlowContext["req"],
  } as MailFlowContext;
  const repo = createD1Repositories(bindings.DB);
  let authServices: ReturnType<typeof configFor> | null = null;
  for (const message of batch.messages) {
    if (!isCampaignTickMessage(message.body)) {
      message.ack();
      continue;
    }
    try {
      if (!authServices) authServices = configFor(queueContext);
      const result = await handleCampaignQueueMessage(message.body, {
        campaigns: repo.campaigns,
        recipientJobs: repo.recipientJobs,
        queue: cloudflareQueueAdapter(bindings.CAMPAIGN_QUEUE),
        mailProvider: async (campaign) => {
          const tokens = await authServices!.auth.refreshUserAccessToken(campaign.ownerUserId);
          return delegatedGraphMailProvider(authServices!.graph, tokens.accessToken);
        },
      });
      if (result.kind === "persistence_error") message.retry({ delaySeconds: 60 });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}

export async function fetchMailFlow(request: Request, bindings: MailFlowBindings, executionContext?: MailFlowExecutionContext): Promise<Response> {
  // The route layer does not schedule detached work. Passing no context also
  // keeps this adapter framework-neutral for local unit tests; the Worker
  // entrypoint still retains the execution context for future waitUntil work.
  void executionContext;
  return app.fetch(request, bindings);
}
