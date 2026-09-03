import { Hono } from "hono";
import { createD1Repositories } from "../database/d1";
import {
  delegatedGraphMailProvider,
  delegatedSmtpMailProvider,
  resolveMailTransport,
} from "../microsoft";
import {
  AttachmentError,
  createAttachmentService,
  OneDriveAppFolderAttachmentStore,
  type AttachmentService,
} from "../attachments";
import { handleCampaignQueueMessage, cloudflareQueueAdapter } from "../queue";
import type { MailFlowBindings, MailFlowExecutionContext, QueueBatch } from "./contracts";
import { isCampaignTickMessage } from "./contracts";
import type { MailFlowAppEnv, MailFlowContext } from "./context";
import { configFor, textEnv } from "./dependencies";
import { responseError } from "./helpers";
import {
  cleanupCampaignAttachments,
  loadCampaignAttachments,
} from "./attachments";
import { registerAuthRoutes } from "./routes/auth";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerFlowRoutes } from "./routes/flows";
import { registerCampaignDetailRoutes, registerCampaignListRoute } from "./routes/campaign-reads";
import { registerCampaignCreateRoute } from "./routes/campaign-create";
import { registerCampaignMutationRoutes } from "./routes/campaign-mutations";

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
registerCampaignMutationRoutes(app);

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
