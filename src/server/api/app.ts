import { Hono } from "hono";
import type { MailFlowBindings, MailFlowExecutionContext } from "./contracts";
import type { MailFlowAppEnv } from "./context";
import { responseError } from "./helpers";
import { registerAuthRoutes } from "./routes/auth";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerFlowRoutes } from "./routes/flows";
import { registerCampaignDetailRoutes, registerCampaignListRoute } from "./routes/campaign-reads";
import { registerCampaignCreateRoute } from "./routes/campaign-create";
import { registerCampaignMutationRoutes } from "./routes/campaign-mutations";

export type { MailFlowAppEnv, MailFlowContext } from "./context";
export { cleanupCampaignAttachments, loadCampaignAttachments } from "./attachments";
export { processAttachmentCleanup, processQueueBatch, processScheduledCleanup } from "./worker-runtime";

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

export async function fetchMailFlow(request: Request, bindings: MailFlowBindings, executionContext?: MailFlowExecutionContext): Promise<Response> {
  // The route layer does not schedule detached work. Passing no context also
  // keeps this adapter framework-neutral for local unit tests; the Worker
  // entrypoint still retains the execution context for future waitUntil work.
  void executionContext;
  return app.fetch(request, bindings);
}
