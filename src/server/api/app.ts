import { Hono } from "hono";
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
  pauseSchema,
  testSendSchema,
} from "./schemas";
import type { MailFlowBindings, MailFlowExecutionContext, QueueBatch } from "./contracts";
import { isCampaignTickMessage } from "./contracts";
import { validateTemplateHtml, validateTemplateSubject } from "./security";
import type { MailFlowAppEnv, MailFlowContext } from "./context";
import {
  attachmentServiceFor,
  configFor,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
  textEnv,
} from "./dependencies";
import {
  audit,
  enqueueTick,
  nowIso,
  parseOrError,
  publicCampaign,
  attachmentErrorResponse,
  requireMutationSession,
  responseError,
  routeParam,
} from "./helpers";
import {
  cleanupCampaignAttachments,
  loadCampaignAttachments,
} from "./attachments";
import { registerAuthRoutes } from "./routes/auth";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerFlowRoutes } from "./routes/flows";
import { registerCampaignDetailRoutes, registerCampaignListRoute } from "./routes/campaign-reads";
import { registerCampaignCreateRoute } from "./routes/campaign-create";

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
registerAttachmentRoutes(app);
registerFlowRoutes(app);
registerCampaignListRoute(app);

// --- Campaigns ------------------------------------------------------------

registerCampaignCreateRoute(app);
registerCampaignDetailRoutes(app);

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
