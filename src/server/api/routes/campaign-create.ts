import type { Hono } from "hono";
import { makeSendKey, validateRecipientRows } from "../../../domain";
import type {
  CampaignRecord,
  RecipientJobRecord,
} from "../../../domain/types";
import {
  AttachmentError,
} from "../../attachments";
import { resolveMailTransport } from "../../microsoft";
import type { MailFlowAppEnv } from "../context";
import {
  attachmentServiceFor,
  integerEnv,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
} from "../dependencies";
import {
  audit,
  createTemplateVersion,
  id,
  nowIso,
  parseOrError,
  publicCampaign,
  recipientAddressIssues,
  attachmentErrorResponse,
  requireMutationSession,
  responseError,
  versionConfigFromInput,
} from "../helpers";
import { campaignCreateSchema } from "../schemas";
import {
  safeSourceFilename,
  templatePlaceholders,
  validateTemplateHtml,
  validateTemplateSubject,
} from "../security";

/** Register campaign creation between the campaign list and detail routes. */
export function registerCampaignCreateRoute(app: Hono<MailFlowAppEnv>): void {
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
}
