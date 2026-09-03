import { useCallback } from "react";
import {
  createCampaign as createCampaignRequest,
  createFlow as createFlowRequest,
  createTemplateVersion as createTemplateVersionRequest,
} from "../api";
import type { CampaignResponse } from "../api";
import { createCampaignPayload, mappingToRecipientConfiguration } from "../../client";
import { useApi } from "../state/api-context";
import { useDraft } from "../state/draft-context";

export function useEnsureCampaign(): () => Promise<CampaignResponse | null> {
  const api = useApi(); const draftState = useDraft();
  return useCallback(async () => {
    if (!api.isLive) return null;
    if (draftState.campaignResponse) return draftState.campaignResponse;
    if (!draftState.attachmentsReady) throw new Error("Finish uploading attachments or remove attachment errors before continuing.");
    const attachmentSetId = draftState.attachments.length > 0 ? draftState.attachmentSetId : null;
    if (draftState.attachments.length > 0 && !attachmentSetId) throw new Error("The attachment set is not ready. Upload the files again before continuing.");
    if (!draftState.table || !draftState.campaignValidation) throw new Error("Import and validate a recipient file before creating the campaign.");
    if (!draftState.campaignValidation.ok) throw new Error("Review and fix the flagged rows before starting the campaign.");
    let currentFlowId = draftState.flowId;
    if (!currentFlowId) {
      const flowResponse = await createFlowRequest({ name: draftState.draft.name }, api.csrfToken);
      currentFlowId = flowResponse.flow.id;
      draftState.setFlowId(currentFlowId);
    }
    // Save the final mapping and body as a new immutable version at campaign
    // creation time. A draft saved before the workbook was selected may have
    // used a placeholder column, so reusing it could make the server reject a
    // valid campaign as changed.
    let currentVersionId: string | null = null;
    const recipientConfiguration = mappingToRecipientConfiguration(draftState.mapping);
    if (!currentVersionId) {
      const versionResponse = await createTemplateVersionRequest(currentFlowId, {
        subjectTemplate: draftState.draft.subject,
        bodyHtml: draftState.campaignValidation.sanitizedBodyHtml,
        placeholderManifest: draftState.campaignValidation.placeholders,
        recipientConfiguration,
      }, api.csrfToken);
      currentVersionId = versionResponse.version.id;
      draftState.setTemplateVersionId(currentVersionId);
    }
    const payload = createCampaignPayload({
      idempotencyKey: draftState.campaignRequestKey,
      attachmentSetId,
      flowId: currentFlowId,
      templateVersionId: currentVersionId,
      sourceFilename: draftState.draft.fileName,
      subjectTemplate: draftState.draft.subject,
      bodyHtml: draftState.bodyHtml,
      mapping: draftState.mapping,
      pacePerMinute: draftState.draft.pace,
      rows: draftState.mappedRows,
      validation: draftState.campaignValidation,
    });
    const response = await createCampaignRequest(payload, api.csrfToken);
    draftState.setCampaignResponse(response);
    void api.refreshDashboard();
    return response;
  }, [api, draftState]);
}
