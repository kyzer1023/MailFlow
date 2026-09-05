import { useCallback } from "react";
import {
  ApiRequestError,
  createCampaign,
  createFlow,
  getFlows,
  type CampaignResponse,
} from "../api";
import { createCampaignPayload } from "../../client";
import { useApi } from "../state/api-context";
import { useDraft } from "../state/draft-context";

export function useEnsureCampaign(): () => Promise<CampaignResponse | null> {
  const api = useApi();
  const state = useDraft();
  const { preparation } = state;
  return useCallback(async () => {
    if (!api.isLive) return null;
    const signature = JSON.stringify([
      state.draft,
      state.table,
      state.skipInvalidRows,
      state.attachmentSetId,
      state.attachments,
      state.config.defaultPacePerMinute,
    ]);
    if (preparation.current && preparation.current.signature !== signature) {
      throw new Error(
        "This send changed after preparation. Start a new send from this message and review it again.",
      );
    }
    if (state.campaignResponse) return state.campaignResponse;
    if (!state.attachmentsReady)
      throw new Error(
        "Finish uploading attachments or remove attachment errors before continuing.",
      );
    if (!state.table || !state.campaignValidation?.ok)
      throw new Error(
        "Resolve the message and recipient issues before continuing.",
      );
    const attachmentSetId = state.attachments.length
      ? state.attachmentSetId
      : null;
    if (state.attachments.length && !attachmentSetId)
      throw new Error(
        "The attachment set is not ready. Choose the files again.",
      );
    if (!preparation.current)
      preparation.current = {
        signature,
        flowId: state.flowId,
        response: null,
        pending: null,
      };
    const prepared = preparation.current;
    if (prepared.response) return prepared.response;
    if (prepared.pending) return prepared.pending;
    state.lockSnapshot();
    prepared.pending = (async () => {
      if (!prepared.flowId) {
        const name = `${(state.draft.name || state.draft.subject).trim().slice(0, 90)} (${state.campaignRequestKey.slice(-12)})`;
        try {
          const response = await createFlow({ name }, api.csrfToken);
          prepared.flowId = response.flow.id;
        } catch (error) {
          if (
            !(error instanceof ApiRequestError) ||
            error.code !== "flow_name_conflict"
          )
            throw error;
          const existing = (await getFlows()).flows.find(
            (flow) =>
              flow.name === name &&
              flow.state === "active" &&
              !flow.currentTemplateVersionId,
          );
          if (!existing) throw error;
          prepared.flowId = existing.id;
        }
      }
      // An exact retry must keep its payload, never create a new version ID.
      const payload = createCampaignPayload({
        idempotencyKey: state.campaignRequestKey,
        attachmentSetId,
        flowId: prepared.flowId,
        templateVersionId: null,
        sourceFilename: state.draft.fileName,
        subjectTemplate: state.draft.subject,
        bodyHtml: state.bodyHtml,
        mapping: state.mapping,
        pacePerMinute: state.config.defaultPacePerMinute,
        rows: state.mappedRows,
        validation: state.campaignValidation!,
      });
      const response = await createCampaign(payload, api.csrfToken);
      prepared.response = response;
      if (preparation.current === prepared) state.setCampaignResponse(response);
      void api.refreshDashboard();
      return response;
    })().finally(() => {
      prepared.pending = null;
    });
    return prepared.pending;
  }, [api, state, preparation]);
}
