import type { Hono } from "hono";
import type { MailFlowAppEnv } from "../context";
import { repositories } from "../dependencies";
import {
  nowIso,
  parseOrError,
  publicJob,
  requireMutationSession,
  responseError,
  routeParam,
} from "../helpers";
import { deliveryVerificationSchema } from "../schemas";

export function registerDeliveryVerificationRoute(
  app: Hono<MailFlowAppEnv>,
): void {
  app.post(
    "/api/campaigns/:id/jobs/:jobId/delivery-verification",
    async (context) => {
      const session = await requireMutationSession(context);
      if (session instanceof Response) return session;
      const input = await parseOrError(context, deliveryVerificationSchema, {
        maxBytes: 4096,
      });
      if (input instanceof Response) return input;
      const repo = repositories(context);
      const campaignId = routeParam(context, "id");
      const campaign = await repo.campaigns.getByIdForOwner(
        campaignId,
        session.user.id,
      );
      if (!campaign)
        return responseError(
          context,
          404,
          "campaign_not_found",
          "That campaign is not available.",
        );
      const job = await repo.recipientJobs.verifyDelivery(
        routeParam(context, "jobId"),
        campaignId,
        session.user.id,
        nowIso(),
        input.note || null,
      );
      if (!job)
        return responseError(
          context,
          409,
          "verification_unavailable",
          "Only an unknown outcome in this campaign can be marked delivery verified.",
        );
      return context.json({ job: publicJob(job) });
    },
  );
}
