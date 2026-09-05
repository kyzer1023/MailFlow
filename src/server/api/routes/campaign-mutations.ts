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
import {
  AttachmentError,
  classifyAttachmentLoadFailure,
  type AttachmentLoadFailure,
  type AttachmentService,
} from "../../attachments";
import type { MailAttachment } from "../../../domain/mail-provider";
import type { CampaignRecord } from "../../../domain/types";
import { OAuthProviderError } from "../../microsoft/oauth";
import { createD1PublicControlStore } from "../../database/d1-public-controls";
import type { MailFlowAppEnv, MailFlowContext } from "../context";
import {
  attachmentServiceFor,
  configFor,
  integerEnv,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
} from "../dependencies";
import {
  audit,
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
    const status = errorValue.code === "not_found" || errorValue.code === "missing_object" ? 404
      : errorValue.code === "immutable" || errorValue.code === "already_associated" ? 409
        : errorValue.code === "size_limit_exceeded" ? 413
          : errorValue.code === "storage_missing" || errorValue.code === "integrity_error" ? 409
            : ["authorization_error", "network_error", "throttled", "service_unavailable", "storage_error", "storage_temporary"].includes(errorValue.code) ? 503
            : 422;
    return {
      // Attachment loading is completed before the provider boundary, so a
      // deliberate retry with the same test-send key cannot duplicate mail.
      safeToRetry: true,
      retryAfter: errorValue.retryAfterSeconds,
      category: errorValue.code,
      failure: {
        status,
        code: `attachment_${errorValue.code}`,
        message: ["authorization_error", "network_error", "throttled", "service_unavailable", "storage_error", "storage_temporary"].includes(errorValue.code)
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
  const retryAfter = errorValue instanceof TestSendError
    ? errorValue.retryAfter
    : errorValue instanceof GraphApiError
      ? errorValue.retryAfterSeconds
      : null;
  const category = errorValue instanceof TestSendError
    ? errorValue.category
    : errorValue instanceof GraphApiError
      ? errorValue.category
      : null;
  return { safeToRetry, retryAfter, category, diagnosticId: errorValue instanceof TestSendError ? errorValue.diagnosticId : undefined, failure: { status, code: "test_send_failed", message } };
}

function attachmentIssueCode(failure: Extract<AttachmentLoadFailure, { disposition: "fail" }>) {
  return failure.category === "missing_object"
    ? "attachment_missing" as const
    : failure.category === "integrity"
      ? "attachment_integrity" as const
      : "attachment_storage_failure" as const;
}

async function failCampaignForAttachment(
  repo: ReturnType<typeof repositories>,
  campaign: CampaignRecord,
  failure: Extract<AttachmentLoadFailure, { disposition: "fail" }>,
  service: AttachmentService | null,
): Promise<void> {
  const failedAt = nowIso();
  const failed = await repo.campaigns.fail(campaign.id, failedAt, failure.userMessage, attachmentIssueCode(failure));
  if (!failed) return;
  try {
    await audit(repo, "campaign.attachment_failed", {
      actorUserId: campaign.ownerUserId,
      campaignId: campaign.id,
      metadata: { category: failure.category, disposition: failure.disposition },
    });
  } catch {
    // The conditional terminal transition remains authoritative if evidence storage is unavailable.
  }
  try {
    await cleanupCampaignAttachments(repo, service, campaign.id);
  } catch {
    // Scheduled cleanup retries terminal attachment deletion.
  }
}

function attachmentActionError(context: MailFlowContext, failure: AttachmentLoadFailure): Response {
  if (failure.disposition === "pause") {
    return responseError(context, 409, "onedrive_reconnect_required", failure.userMessage);
  }
  if (failure.disposition === "retry") {
    return responseError(context, 503, "attachment_temporarily_unavailable", "Campaign attachments are temporarily unavailable. Try again shortly.");
  }
  return responseError(context, 409, `attachment_${failure.category}`, failure.userMessage);
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
        mailboxDelivery: repo.mailboxDelivery,
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
        pacePerMinute: integerEnv(context.env.DEFAULT_CAMPAIGN_PACE, 12, 1, 600),
        send: async (sendKey) => {
          let attachments: readonly MailAttachment[] = [];
          if (attachmentSet) {
            const service = attachmentServiceFor(context, repo);
            if (!service) {
              throw new AttachmentError(
                "service_unavailable",
                "Campaign attachments are temporarily unavailable. Try again shortly",
                { transient: true },
              );
            }
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
        if (errorValue.failure.status === 429 && errorValue.retryAfterSeconds) {
          context.header("Retry-After", String(errorValue.retryAfterSeconds));
        }
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
    if (campaign.state !== "paused") return responseError(context, 409, "campaign_changed", "Only a paused campaign can be resumed.");
    const attachmentSet = await repo.attachments.getSetByCampaignId(campaign.id);
    if (attachmentSet) {
      if (resolveMailTransport(context.env.MAIL_TRANSPORT) !== "smtp" || !(await smtpAuthorizedFor(context, authenticated.user.id))) {
        return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before resuming this attachment campaign.");
      }
      if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
        return responseError(context, 409, "onedrive_reconnect_required", "Reconnect OneDrive, then resume from the pending rows.");
      }
      const service = attachmentServiceFor(context, repo);
      if (!service) return responseError(context, 503, "attachment_temporarily_unavailable", "Campaign attachments are temporarily unavailable. Try again shortly.");
      try {
        await loadCampaignAttachments(repo, service, campaign);
      } catch (errorValue) {
        const failure = classifyAttachmentLoadFailure(errorValue);
        if (failure.disposition === "fail") await failCampaignForAttachment(repo, campaign, failure, service);
        return attachmentActionError(context, failure);
      }
    }
    if (!(await repo.campaigns.resume(campaign.id, authenticated.user.id, nowIso()))) return responseError(context, 409, "campaign_changed", "Only a paused campaign can be resumed.");
    const wakeAt = nowIso();
    let published = false;
    try {
      published = (await enqueueTick(context, campaign.id, wakeAt, "Sending is ready to resume.")).published;
    } catch {
      // The campaign remains safely runnable. The hourly watchdog recreates the wake.
    }
    if (!published) {
      await repo.campaigns.markSchedulerWaiting(
        campaign.id,
        wakeAt,
        "The campaign is safe in storage and will continue when the background queue recovers.",
        nowIso(),
      );
    }
    await audit(repo, "campaign.resumed", { actorUserId: authenticated.user.id, campaignId: campaign.id, metadata: { queuePublished: published } });
    return context.json({ campaign: publicCampaign((await repo.campaigns.getById(campaign.id)) ?? campaign), queuePending: !published }, published ? 200 : 202);
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
    return attachmentActionError(context, classifyAttachmentLoadFailure(
      new AttachmentError(
        "service_unavailable",
        "Campaign attachments are temporarily unavailable",
        { transient: true },
      ),
    ));
  }
  if (attachmentSet && attachmentService) {
    try {
      await loadCampaignAttachments(repo, attachmentService, campaign);
    } catch (errorValue) {
      const failure = classifyAttachmentLoadFailure(errorValue);
      if (failure.disposition === "fail") await failCampaignForAttachment(repo, campaign, failure, attachmentService);
      return attachmentActionError(context, failure);
    }
  }
  if (!(await repo.campaigns.queue(campaign.id, authenticated.user.id, nowIso()))) return responseError(context, 409, "campaign_changed", "The campaign changed in another session. Refresh and try again.");
  const wakeAt = nowIso();
  let published = false;
  try {
    published = (await enqueueTick(context, campaign.id, wakeAt, "Sending is queued and will begin shortly.")).published;
  } catch {
    // The queued campaign remains safe and the hourly watchdog recreates the wake.
  }
  if (!published) {
    await repo.campaigns.markSchedulerWaiting(
      campaign.id,
      wakeAt,
      "The campaign is safe in storage and will begin when the background queue recovers.",
      nowIso(),
    );
  }
  await audit(repo, "campaign.queued", { actorUserId: authenticated.user.id, campaignId: campaign.id, metadata: { queuePublished: published } });
  return context.json({ campaign: publicCampaign((await repo.campaigns.getById(campaign.id)) ?? campaign), queuePending: !published }, published ? 200 : 202);
}
