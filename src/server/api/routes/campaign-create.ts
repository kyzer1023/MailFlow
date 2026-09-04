import type { Hono } from "hono";
import { MAX_CAMPAIGN_CREATE_BODY_BYTES, emptyCampaignCounts, makeSendKey, validateRecipientRows } from "../../../domain";
import type {
  CampaignRecord,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../../../domain/types";
import {
  AttachmentError,
} from "../../attachments";
import { resolveMailTransport } from "../../microsoft";
import type { MailFlowAppEnv } from "../context";
import { campaignCreateFingerprint, campaignReplayFingerprint } from "../campaign-create-control";
import {
  attachmentServiceFor,
  integerEnv,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
} from "../dependencies";
import {
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

function templateMatches(
  templateVersion: TemplateVersionRecord,
  subject: string,
  bodyHtml: string,
  recipientConfiguration: TemplateVersionRecord["recipientConfiguration"],
): boolean {
  const storedConfiguration = versionConfigFromInput(templateVersion.recipientConfiguration);
  const storedMappings = Object.fromEntries(Object.entries(storedConfiguration.placeholderMappings ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const requestedMappings = Object.fromEntries(Object.entries(recipientConfiguration.placeholderMappings ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  return templateVersion.subjectTemplate === subject
    && templateVersion.bodyHtml === bodyHtml
    && JSON.stringify({ ...storedConfiguration, placeholderMappings: storedMappings })
      === JSON.stringify({ ...recipientConfiguration, placeholderMappings: requestedMappings });
}

/** Register campaign creation between the campaign list and detail routes. */
export function registerCampaignCreateRoute(app: Hono<MailFlowAppEnv>): void {
  app.post("/api/campaigns", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    const input = await parseOrError(context, campaignCreateSchema, {
      maxBytes: MAX_CAMPAIGN_CREATE_BODY_BYTES,
      tooLargeCode: "campaign_request_too_large",
      tooLargeMessage: "The campaign request is too large. Reduce the message size or split the campaign.",
    });
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
    const recipientConfiguration = versionConfigFromInput(input.recipientConfiguration);
    const sourceFilename = safeSourceFilename(input.sourceFilename);
    const requestFingerprint = await campaignCreateFingerprint({
      request: input,
      subjectTemplate: subject.subject,
      bodyHtml: body.html,
      recipientConfiguration,
      sourceFilename,
      pacePerMinute,
    });
    const repo = repositories(context);
    const existingCampaign = await repo.campaigns.getByIdempotencyKey(authenticated.user.id, input.idempotencyKey);
    if (existingCampaign) {
      if (campaignReplayFingerprint(existingCampaign.requestFingerprint, requestFingerprint) === "conflict") {
        return responseError(context, 409, "campaign_key_reused", "This campaign request key was already used for different content. Refresh Review and try again.");
      }
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
    if (flow.state !== "active") return responseError(context, 409, "flow_archived", "This flow was removed and cannot start a new campaign.");
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
    let templateVersion = input.templateVersionId
      ? await repo.templateVersions.getById(input.templateVersionId)
      : flow.currentTemplateVersionId
        ? await repo.templateVersions.getById(flow.currentTemplateVersionId)
        : null;
    if (templateVersion && templateVersion.flowId !== flow.id) return responseError(context, 404, "template_not_found", "That template version is not available.");
    if (templateVersion && !templateMatches(templateVersion, subject.subject, body.html, recipientConfiguration) && input.templateVersionId) {
      return responseError(context, 422, "template_changed", "The selected template changed after validation. Review and save it again.");
    }
    if (templateVersion && !templateMatches(templateVersion, subject.subject, body.html, recipientConfiguration)) templateVersion = null;
    if (!templateVersion && !input.templateVersionId) {
      templateVersion = (await repo.templateVersions.listByFlow(flow.id)).find((version) => (
        templateMatches(version, subject.subject, body.html, recipientConfiguration)
      )) ?? null;
    }
    if (!templateVersion) {
      try {
        templateVersion = await createTemplateVersion(repo, flow, {
          subjectTemplate: subject.subject,
          bodyHtml: body.html,
          placeholderManifest: placeholders,
          recipientConfiguration,
        });
      } catch (errorValue) {
        const concurrentVersion = (await repo.templateVersions.listByFlow(flow.id)).find((version) => (
          templateMatches(version, subject.subject, body.html, recipientConfiguration)
        ));
        if (concurrentVersion) {
          templateVersion = concurrentVersion;
        } else {
          const message = "The template could not be saved. Try again shortly.";
          return responseError(context, 422, "invalid_template", message);
        }
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
      sourceFilename,
      totalRecipients: input.totalRecipients,
      validRecipients: input.validRecipients,
      skippedRecipients: input.skippedRecipients,
      pacePerMinute,
      state: "validated",
      pauseReason: null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      createdAt,
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: createdAt,
    };
    try {
      await repo.campaigns.create(campaign, jobs, input.attachmentSetId, [
        {
          id: id("audit"),
          actorUserId: authenticated.user.id,
          campaignId: campaign.id,
          recipientJobId: null,
          eventType: "campaign.created",
          metadata: { totalRecipients: campaign.totalRecipients, validRecipients: campaign.validRecipients, skippedRecipients: campaign.skippedRecipients },
          createdAt,
        },
        {
          id: id("audit"),
          actorUserId: authenticated.user.id,
          campaignId: campaign.id,
          recipientJobId: null,
          eventType: "campaign.validated",
          metadata: {},
          createdAt,
        },
      ]);
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : "";
      const concurrentCampaign = await repo.campaigns.getByIdempotencyKey(authenticated.user.id, input.idempotencyKey);
      if (concurrentCampaign) {
        if (campaignReplayFingerprint(concurrentCampaign.requestFingerprint, requestFingerprint) === "conflict") {
          return responseError(context, 409, "campaign_key_reused", "This campaign request key was already used for different content. Refresh Review and try again.");
        }
        const concurrentAttachmentSet = await repo.attachments.getSetByCampaignId(concurrentCampaign.id);
        if ((input.attachmentSetId ?? null) !== (concurrentAttachmentSet?.id ?? null)) {
          return responseError(context, 409, "campaign_attachment_conflict", "This request key already belongs to a campaign with a different attachment set.");
        }
        return context.json({
          campaign: publicCampaign(concurrentCampaign),
          counts: await repo.recipientJobs.counts(concurrentCampaign.id),
        });
      }
      if (input.attachmentSetId && /mailbox_coordination_guard\.singleton/iu.test(message)) {
        return responseError(context, 409, "attachment_set_changed", "The attachment set changed while the campaign was being created. Upload the files again and review the campaign.");
      }
      throw errorValue;
    }
    const counts = emptyCampaignCounts();
    counts.pending = jobs.length;
    return context.json({ campaign: publicCampaign(campaign), counts }, 201);
  });
}
