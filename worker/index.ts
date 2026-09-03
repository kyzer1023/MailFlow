import { fetchMailFlow, processAttachmentCleanup, processQueueBatch } from "../src/server/api/app";
import type { MailFlowBindings, MailFlowExecutionContext, QueueBatch } from "../src/server/api/contracts";
import type { CampaignTickMessage } from "../src/server/queue/contracts";

/**
 * Cloudflare Worker entrypoint.  Static assets are handled by the ASSETS
 * binding, while Hono owns API and OAuth paths.  A document request that is
 * not an API/auth route gets the Vite SPA shell only after the asset binding
 * reports a miss; unknown API and write requests never become index.html.
 */
const worker = {
  async fetch(request: Request, env: MailFlowBindings, executionContext: MailFlowExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApiOrAuth = url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/auth" || url.pathname.startsWith("/auth/");
    if (isApiOrAuth) return fetchMailFlow(request, env, executionContext);

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const acceptsHtml = request.headers.get("accept")?.toLowerCase().includes("text/html") ?? false;
    if (!acceptsHtml || (request.method !== "GET" && request.method !== "HEAD")) return response;

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },

  async queue(batch: QueueBatch<CampaignTickMessage>, env: MailFlowBindings): Promise<void> {
    await processQueueBatch(batch as QueueBatch<unknown>, env);
  },

  async scheduled(_controller: unknown, env: MailFlowBindings): Promise<void> {
    await processAttachmentCleanup(env);
  },
};

export default worker;
