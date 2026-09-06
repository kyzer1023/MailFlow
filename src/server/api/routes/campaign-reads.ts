import type { Hono } from "hono";
import type { RecipientJobRecord } from "../../../domain/types";
import type { MailFlowAppEnv } from "../context";
import { integerEnv, repositories } from "../dependencies";
import { historyCursor, parseHistoryCursor } from "../campaign-pagination";
import {
  jobCsv,
  publicCampaign,
  publicJob,
  requireSession,
  responseError,
  routeParam,
} from "../helpers";

/** Register the campaign list route before campaign creation is registered. */
export function registerCampaignListRoute(app: Hono<MailFlowAppEnv>): void {
  app.get("/api/campaigns", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    const params = new URL(context.req.url).searchParams;
    const rawLimit = params.get("limit");
    const limit = rawLimit ? integerEnv(rawLimit, 50, 1, 200) : 50;
    let before;
    try { before = parseHistoryCursor(params.get("before")); }
    catch { return responseError(context, 400, "invalid_history_cursor", "Reload campaign history and try again."); }
    const candidates = await repositories(context).campaigns.listByOwner(authenticated.user.id, limit + 1, before);
    const campaigns = candidates.slice(0, limit);
    return context.json({ campaigns: campaigns.map(publicCampaign),
      nextCursor: candidates.length > limit ? historyCursor(campaigns[campaigns.length - 1]) : null });
  });
}

/** Register campaign detail, job listing, and CSV export routes after creation. */
export function registerCampaignDetailRoutes(app: Hono<MailFlowAppEnv>): void {
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
    return context.body(jobCsv(jobs, campaign));
  });
}
