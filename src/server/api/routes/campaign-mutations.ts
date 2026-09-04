import type { Hono } from "hono";
import { AuthFlowError } from "../../auth/service";
import {
  delegatedSmtpMailProvider,
  GraphApiError,
  resolveMailTransport,
  sendProviderTestToSelf,
  sendTestToSelf,
  TestSendError,
} from "../../microsoft";
import { AttachmentError } from "../../attachments";
import type { MailAttachment } from "../../../domain/mail-provider";
import { OAuthProviderError } from "../../microsoft/oauth";
import { createD1PublicControlStore } from "../../database/d1-public-controls";
import type { MailFlowAppEnv, MailFlowContext } from "../context";
import {
  attachmentServiceFor,
  configFor,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
} from "../dependencies";
import {
  audit,
  attachmentErrorResponse,
  enqueueTick,
  nowIso,
  parseOrError,
  publicCampaign,
  requireMutationSession,
  responseError,
  routeParam,
} from "../helpers";
import {
  acknowledgementSchema,
  pauseSchema,
  testSendSchema,
} from "../schemas";
import {
  cleanupCampaignAttachments,
  loadCampaignAttachments,
} from "../attachments";
import { validateTemplateHtml, validateTemplateSubject } from "../security";
import { ControlledTestSendError, executeControlledTestSend, type ClassifiedTestSendFailure } from "../test-send-control";

function testSendFailure(errorValue: unknown): ClassifiedTestSendFailure {
  if (errorValue instanceof AttachmentError) {
    const status = errorValue.code === "not_found" ? 404
      : errorValue.code === "immutable" || errorValue.code === "already_associated" ? 409
        : errorValue.code === "size_limit_exceeded" ? 413
          : errorValue.code === "storage_error" || errorValue.code === "integrity_error" ? 503
            : 422;
    return {
      safeToRetry: true,
      failure: {
        status,
        code: `attachment_${errorValue.code}`,
        message: errorValue.code === "storage_error" || errorValue.code === "integrity_error"
          ? "Campaign attachments are temporarily unavailable. Try again shortly."
          : errorValue.message,
      },
    };
  }
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
  const safeToRetry = errorValue instanceof TestSendError
    ? errorValue.safeToRetry
    : errorValue instanceof AuthFlowError || errorValue instanceof OAuthProviderError
      ? true
      : errorValue instanceof GraphApiError
        ? errorValue.retryable && !errorValue.ambiguous
        : false;
  return { safeToRetry, failure: { status, code: "test_send_failed", message } };
}

/** Register campaign test-send and state mutation routes. */
export function registerCampaignMutationRoutes(app: Hono<MailFlowAppEnv>): void {
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
    const recipientJob = await repo.recipientJobs.getByCampaignAndSourceRow(campaign.id, input.sourceRow);
    if (!recipientJob) return responseError(context, 404, "test_sample_not_found", "That reviewed sample is not part of this campaign.");
    if (
      recipientJob.renderedSubject !== subject.subject
      || recipientJob.renderedBodyHtml !== body.html
      || (recipientJob.importance ?? "normal") !== input.importance
    ) {
      return responseError(context, 409, "campaign_snapshot_changed", "The reviewed message no longer matches this campaign. Return to Data and prepare a new campaign.");
    }
    const attachmentSet = await repo.attachments.getSetByCampaignId(campaign.id);
    try {
      const controlled = await executeControlledTestSend({
        store: createD1PublicControlStore(context.env.DB),
        input: {
          ownerUserId: authenticated.user.id,
          campaignId: campaign.id,
          idempotencyKey: input.idempotencyKey,
          subject: recipientJob.renderedSubject,
          bodyHtml: recipientJob.renderedBodyHtml,
          importance: recipientJob.importance ?? "normal",
          attachmentSetId: attachmentSet?.id ?? null,
        },
        audit: ({ eventType, campaignId, actorUserId, metadata }) => audit(repo, eventType, {
          actorUserId,
          campaignId,
          metadata: { ...metadata },
        }),
        classifyFailure: testSendFailure,
        send: async (sendKey) => {
          let attachments: readonly MailAttachment[] = [];
          if (attachmentSet) {
            const service = attachmentServiceFor(context, repo);
            if (!service) throw new AttachmentError("storage_error", "Campaign attachments are temporarily unavailable");
            attachments = await loadCampaignAttachments(repo, service, campaign);
          }
          const { auth, graph, smtp, mailTransport } = configFor(context);
          const tokens = await auth.refreshUserAccessToken(authenticated.user.id);
          const inputValue = {
            subject: recipientJob.renderedSubject,
            bodyHtml: recipientJob.renderedBodyHtml,
            importance: recipientJob.importance ?? "normal",
            attachments,
          };
          return mailTransport === "smtp"
            ? sendProviderTestToSelf(
                delegatedSmtpMailProvider(smtp, tokens.accessToken, authenticated.user.mailboxAddress),
                authenticated.user.mailboxAddress,
                inputValue,
                sendKey,
              )
            : sendTestToSelf(graph, tokens.accessToken, inputValue);
        },
      });
      return context.json(controlled);
    } catch (errorValue) {
      if (errorValue instanceof ControlledTestSendError) {
        if (errorValue.failure.status === 429) context.header("Retry-After", "600");
        return responseError(context, errorValue.failure.status, errorValue.failure.code, errorValue.failure.message);
      }
      const failure = testSendFailure(errorValue);
      return responseError(context, failure.failure.status, failure.failure.code, failure.failure.message);
    }
  });

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
}

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
