import { Hono } from "hono";
import { makeSendKey, validateRecipientRows } from "../../domain";
import type {
  CampaignRecord,
  FlowRecord,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../../domain/types";
import { AuthFlowError } from "../auth/service";
import { createD1Repositories } from "../database/d1";
import {
  delegatedGraphMailProvider,
  delegatedSmtpMailProvider,
  GraphApiError,
  resolveMailTransport,
  sendProviderTestToSelf,
  sendTestToSelf,
  TestSendError,
} from "../microsoft";
import {
  ATTACHMENT_MAX_BYTES,
  AttachmentError,
  createAttachmentService,
  OneDriveAppFolderAttachmentStore,
  type AttachmentService,
} from "../attachments";
import type { MailAttachment } from "../../domain/mail-provider";
import { OAuthProviderError } from "../microsoft/oauth";
import { handleCampaignQueueMessage, cloudflareQueueAdapter } from "../queue";
import {
  acknowledgementSchema,
  attachmentSetCreateSchema,
  campaignCreateSchema,
  flowCreateSchema,
  flowUpdateSchema,
  pauseSchema,
  templateVersionSchema,
  testSendSchema,
} from "./schemas";
import type { MailFlowBindings, MailFlowExecutionContext, QueueBatch } from "./contracts";
import { isCampaignTickMessage } from "./contracts";
import { safeSourceFilename, templatePlaceholders, validateTemplateHtml, validateTemplateSubject } from "./security";
import type { MailFlowAppEnv, MailFlowContext } from "./context";
import {
  attachmentInfrastructureAvailable,
  attachmentServiceFor,
  configFor,
  integerEnv,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
  textEnv,
} from "./dependencies";
import {
  audit,
  createTemplateVersion,
  enqueueTick,
  id,
  jobCsv,
  nowIso,
  parseOrError,
  publicCampaign,
  publicFlow,
  publicJob,
  recipientAddressIssues,
  attachmentErrorResponse,
  requireMutationSession,
  requireSession,
  responseError,
  routeParam,
  versionConfigFromInput,
} from "./helpers";
import {
  cleanupCampaignAttachments,
  loadCampaignAttachments,
  publicAttachmentFile,
  publicAttachmentSet,
} from "./attachments";
import { registerAuthRoutes } from "./routes/auth";

export type { MailFlowAppEnv, MailFlowContext } from "./context";
export { cleanupCampaignAttachments, loadCampaignAttachments } from "./attachments";

const app = new Hono<MailFlowAppEnv>();

// API responses are personalized and campaign state changes in the
// background. Prevent browsers and intermediary caches from replaying the
// initial validated/queued snapshot when a member revisits a campaign.
app.use("/api/*", async (context, next) => {
  await next();
  context.header("Cache-Control", "private, no-store, max-age=0");
  context.header("Pragma", "no-cache");
});

registerAuthRoutes(app);

// --- Campaign attachment sets --------------------------------------------

app.post("/api/attachment-sets", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  if (!attachmentInfrastructureAvailable(context)) {
    return responseError(context, 409, "attachments_unavailable", "Attachments require SMTP delivery.");
  }
  if (!(await smtpAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before adding attachments.");
  }
  if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before adding attachments.");
  }
  const input = await parseOrError(context, attachmentSetCreateSchema);
  if (input instanceof Response) return input;
  const repo = repositories(context);
  const service = attachmentServiceFor(context, repo);
  if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
  try {
    const result = await service.createSet(authenticated.user.id, input.idempotencyKey);
    return context.json({ attachmentSet: publicAttachmentSet(result.set) }, result.created ? 201 : 200);
  } catch (error) {
    return attachmentErrorResponse(context, error);
  }
});

app.post("/api/attachment-sets/:id/files", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  if (!attachmentInfrastructureAvailable(context)) {
    return responseError(context, 409, "attachments_unavailable", "Attachments require SMTP delivery.");
  }
  if (!(await smtpAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before adding attachments.");
  }
  if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before adding attachments.");
  }
  const contentLengthHeader = context.req.header("Content-Length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    // Allow a bounded multipart envelope while rejecting obviously oversized
    // requests before form-data parsing allocates their body in the Worker.
    if (Number.isFinite(contentLength) && contentLength > ATTACHMENT_MAX_BYTES + 64 * 1024) {
      return responseError(context, 413, "attachment_size_limit_exceeded", "The combined attachment size exceeds 20 MiB.");
    }
  }
  const repo = repositories(context);
  const service = attachmentServiceFor(context, repo);
  if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
  let uploaded: FormDataEntryValue | null = null;
  try {
    uploaded = (await context.req.raw.formData()).get("file");
  } catch {
    return responseError(context, 422, "invalid_input", "Choose an attachment file and try again.");
  }
  if (!uploaded || typeof uploaded === "string" || typeof uploaded.arrayBuffer !== "function" || typeof uploaded.name !== "string") {
    return responseError(context, 422, "invalid_input", "Choose an attachment file and try again.");
  }
  if (typeof uploaded.size === "number" && uploaded.size > ATTACHMENT_MAX_BYTES) {
    return responseError(context, 413, "attachment_size_limit_exceeded", "This attachment exceeds the campaign attachment size limit.");
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await uploaded.arrayBuffer();
  } catch {
    return responseError(context, 422, "invalid_input", "The attachment could not be read. Choose it again and try again.");
  }
  try {
    const result = await service.addFile(authenticated.user.id, routeParam(context, "id"), {
      filename: uploaded.name,
      contentType: uploaded.type || null,
      bytes,
    });
    return context.json({
      file: publicAttachmentFile(result.file),
      attachmentSet: publicAttachmentSet(result.set),
    }, 201);
  } catch (error) {
    return attachmentErrorResponse(context, error);
  }
});

app.delete("/api/attachment-sets/:id/files/:fileId", async (context) => {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before changing attachments.");
  }
  const repo = repositories(context);
  const service = attachmentServiceFor(context, repo);
  if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
  try {
    const removed = await service.removeFile(authenticated.user.id, routeParam(context, "id"), routeParam(context, "fileId"));
    if (!removed) return responseError(context, 404, "attachment_file_not_found", "That attachment is not available.");
    return context.body(null, 204);
  } catch (error) {
    return attachmentErrorResponse(context, error);
  }
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
  if (await repo.flows.getByNameForOwner(authenticated.user.id, input.name)) {
    return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
  }
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
  try {
    await repo.flows.create(flow);
  } catch (errorValue) {
    if (await repo.flows.getByNameForOwner(authenticated.user.id, input.name)) {
      return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
    }
    throw errorValue;
  }
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
  if (input.name !== undefined) {
    const sameName = await repo.flows.getByNameForOwner(authenticated.user.id, input.name);
    if (sameName && sameName.id !== flow.id) {
      return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
    }
  }
  const updated: FlowRecord = { ...flow, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.societyName !== undefined ? { societyName: input.societyName } : {}), ...(input.state !== undefined ? { state: input.state } : {}), updatedAt: nowIso() };
  try {
    if (!(await repo.flows.update(updated))) return responseError(context, 409, "flow_changed", "The flow changed in another session. Refresh and try again.");
  } catch (errorValue) {
    if (input.name !== undefined) {
      const sameName = await repo.flows.getByNameForOwner(authenticated.user.id, input.name);
      if (sameName && sameName.id !== flow.id) {
        return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
      }
    }
    throw errorValue;
  }
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
    const existingAttachmentSet = await repo.attachments.getSetByCampaignId(existingCampaign.id);
    const requestedAttachmentSetId = input.attachmentSetId ?? null;
    const existingAttachmentSetId = existingAttachmentSet?.id ?? null;
    if (requestedAttachmentSetId !== existingAttachmentSetId) {
      return responseError(context, 409, "campaign_attachment_conflict", "This request key already belongs to a campaign with a different attachment set.");
    }
    return context.json({
      campaign: publicCampaign(existingCampaign),
      counts: await repo.recipientJobs.counts(existingCampaign.id),
    });
  }
  const flow = await repo.flows.getByIdForOwner(input.flowId, authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "Save the flow before creating a campaign.");
  if (input.attachmentSetId) {
    if (resolveMailTransport(context.env.MAIL_TRANSPORT) !== "smtp") {
      return responseError(context, 409, "attachments_require_smtp", "This campaign uses attachments and must be sent with SMTP delivery.");
    }
    if (!(await smtpAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before creating an attachment campaign.");
    }
    if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before creating an attachment campaign.");
    }
    const service = attachmentServiceFor(context, repo);
    if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
    const attachmentSet = await repo.attachments.getSetByIdForOwner(input.attachmentSetId, authenticated.user.id);
    if (!attachmentSet) return responseError(context, 404, "attachment_set_not_found", "That attachment set is not available.");
    if (attachmentSet.state !== "open" || attachmentSet.campaignId) {
      return responseError(context, 409, "attachment_set_immutable", "That attachment set can no longer be changed.");
    }
    if (attachmentSet.fileCount < 1) {
      return responseError(context, 422, "attachment_set_empty", "Add at least one attachment before creating the campaign.");
    }
    try {
      const payloads = await service.readSet(authenticated.user.id, attachmentSet.id);
      const totalBytes = payloads.reduce((total, payload) => total + payload.bytes.byteLength, 0);
      if (payloads.length !== attachmentSet.fileCount || totalBytes !== attachmentSet.totalBytes) {
        return attachmentErrorResponse(context, new AttachmentError("integrity_error", "The campaign attachment metadata does not match its files"));
      }
    } catch (error) {
      return attachmentErrorResponse(context, error);
    }
  }
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
    importance: input.recipientConfiguration.importance,
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
    await repo.campaigns.create(campaign, jobs, input.attachmentSetId);
  } catch (errorValue) {
    const message = errorValue instanceof Error ? errorValue.message : "";
    if (/unique|constraint/iu.test(message)) {
      const concurrentCampaign = await repo.campaigns.getByIdempotencyKey(authenticated.user.id, input.idempotencyKey);
      if (concurrentCampaign) {
        const concurrentAttachmentSet = await repo.attachments.getSetByCampaignId(concurrentCampaign.id);
        if ((input.attachmentSetId ?? null) !== (concurrentAttachmentSet?.id ?? null)) {
          return responseError(context, 409, "campaign_attachment_conflict", "This request key already belongs to a campaign with a different attachment set.");
        }
        return context.json({
          campaign: publicCampaign(concurrentCampaign),
          counts: await repo.recipientJobs.counts(concurrentCampaign.id),
        });
      }
      if (input.attachmentSetId) {
        return responseError(context, 409, "attachment_set_changed", "The attachment set changed while the campaign was being created. Upload the files again and review the campaign.");
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
    const attachmentSet = await repo.attachments.getSetByCampaignId(campaign.id);
    let attachments: readonly MailAttachment[] = [];
    if (attachmentSet) {
      const service = attachmentServiceFor(context, repo);
      if (!service) throw new AttachmentError("storage_error", "Campaign attachments are temporarily unavailable");
      attachments = await loadCampaignAttachments(repo, service, campaign);
    }
    const { auth, graph, smtp, mailTransport } = configFor(context);
    const tokens = await auth.refreshUserAccessToken(authenticated.user.id);
    const inputValue = {
      subject: subject.subject,
      bodyHtml: body.html,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      importance: input.importance,
      attachments,
    };
    const result = mailTransport === "smtp"
      ? await sendProviderTestToSelf(delegatedSmtpMailProvider(smtp, tokens.accessToken, authenticated.user.mailboxAddress), authenticated.user.mailboxAddress, inputValue)
      : await sendTestToSelf(graph, tokens.accessToken, inputValue);
    return context.json({ result });
  } catch (errorValue) {
    if (errorValue instanceof AttachmentError) return attachmentErrorResponse(context, errorValue);
    const message = errorValue instanceof GraphApiError || errorValue instanceof AuthFlowError || errorValue instanceof OAuthProviderError || errorValue instanceof TestSendError
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
  const attachmentSet = await repo.attachments.getSetByCampaignId(campaign.id);
  if (attachmentSet && resolveMailTransport(context.env.MAIL_TRANSPORT) !== "smtp") {
    return responseError(context, 409, "attachments_require_smtp", "Switch this deployment back to SMTP delivery before starting an attachment campaign.");
  }
  if (attachmentSet && !(await smtpAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before starting this attachment campaign.");
  }
  if (attachmentSet && !(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
    return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before starting this attachment campaign.");
  }
  const attachmentService = attachmentServiceFor(context, repo);
  if (attachmentSet && !attachmentService) {
    const error = new AttachmentError("storage_error", "Campaign attachments are temporarily unavailable");
    const failed = await repo.campaigns.fail(campaign.id, nowIso(), "The campaign attachments could not be verified. No message was sent.");
    const latest = failed ? null : await repo.campaigns.getById(campaign.id);
    if (failed || latest?.state === "completed" || latest?.state === "failed") {
      try {
        await cleanupCampaignAttachments(repo, attachmentService, campaign.id);
      } catch {
        // Scheduled cleanup will retry when storage is available again.
      }
    }
    return attachmentErrorResponse(context, error);
  }
  if (attachmentSet && attachmentService) {
    try {
      await loadCampaignAttachments(repo, attachmentService, campaign);
    } catch (error) {
      const failed = await repo.campaigns.fail(campaign.id, nowIso(), "The campaign attachments could not be verified. No message was sent.");
      const latest = failed ? null : await repo.campaigns.getById(campaign.id);
      if (failed || latest?.state === "completed" || latest?.state === "failed") {
        try {
          await cleanupCampaignAttachments(repo, attachmentService, campaign.id);
        } catch {
          // Scheduled cleanup will retry when storage is available again.
        }
      }
      return attachmentErrorResponse(context, error);
    }
  }
  if (!(await repo.campaigns.queue(campaign.id, authenticated.user.id, nowIso()))) return responseError(context, 409, "campaign_changed", "The campaign changed in another session. Refresh and try again.");
  try {
    await enqueueTick(context, campaign.id);
  } catch {
    const failed = await repo.campaigns.fail(campaign.id, nowIso(), "The campaign queue is unavailable. No message was sent.");
    const latest = failed ? null : await repo.campaigns.getById(campaign.id);
    if (failed || latest?.state === "completed" || latest?.state === "failed") {
      try {
        await cleanupCampaignAttachments(repo, attachmentService, campaign.id);
      } catch {
        // Scheduled cleanup will retry when storage is available again.
      }
    }
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
  let attachmentService: AttachmentService | null = null;
  for (const message of batch.messages) {
    if (!isCampaignTickMessage(message.body)) {
      message.ack();
      continue;
    }
    try {
      if (!authServices) {
        authServices = configFor(queueContext);
        attachmentService = authServices.mailTransport === "smtp"
          ? createAttachmentService(
              repo.attachments,
              new OneDriveAppFolderAttachmentStore(async (ownerUserId) => (await authServices!.storageAuth.refreshUserAccessToken(ownerUserId)).accessToken),
            )
          : null;
      }
      const result = await handleCampaignQueueMessage(message.body, {
        campaigns: repo.campaigns,
        recipientJobs: repo.recipientJobs,
        queue: cloudflareQueueAdapter(bindings.CAMPAIGN_QUEUE),
        attachmentLoader: async (campaign) => {
          const set = await repo.attachments.getSetByCampaignId(campaign.id);
          if (!set) return [];
          if (!attachmentService) throw new AttachmentError("storage_error", "Campaign attachments are temporarily unavailable");
          return loadCampaignAttachments(repo, attachmentService, campaign);
        },
        attachmentCleanup: async (campaignId) => {
          await cleanupCampaignAttachments(repo, attachmentService, campaignId);
        },
        mailProvider: async (campaign) => {
          return authServices!.mailTransport === "smtp"
            ? delegatedSmtpMailProvider(authServices!.smtp, async () => (await authServices!.auth.refreshUserAccessToken(campaign.ownerUserId)).accessToken, campaign.senderAddress)
            : delegatedGraphMailProvider(authServices!.graph, async () => (await authServices!.auth.refreshUserAccessToken(campaign.ownerUserId)).accessToken);
        },
      });
      if (result.kind === "persistence_error") message.retry({ delaySeconds: 60 });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}

/** Run the hourly OneDrive App Folder retention sweep for orphan sets. */
export async function processAttachmentCleanup(bindings: MailFlowBindings): Promise<void> {
  if (resolveMailTransport(bindings.MAIL_TRANSPORT) !== "smtp") return;
  const repo = createD1Repositories(bindings.DB);
  const queueContext = {
    env: bindings,
    req: { url: textEnv(bindings.PUBLIC_ORIGIN, "https://mailflow.invalid") } as MailFlowContext["req"],
  } as MailFlowContext;
  const { storageAuth } = configFor(queueContext);
  const service = createAttachmentService(
    repo.attachments,
    new OneDriveAppFolderAttachmentStore(async (ownerUserId) => (await storageAuth.refreshUserAccessToken(ownerUserId)).accessToken),
  );
  await service.cleanupExpiredOrphans(100);
}

export async function fetchMailFlow(request: Request, bindings: MailFlowBindings, executionContext?: MailFlowExecutionContext): Promise<Response> {
  // The route layer does not schedule detached work. Passing no context also
  // keeps this adapter framework-neutral for local unit tests; the Worker
  // entrypoint still retains the execution context for future waitUntil work.
  void executionContext;
  return app.fetch(request, bindings);
}
