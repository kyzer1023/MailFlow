import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CampaignResponse } from "../api";
import { recipientConfigurationToClientMapping } from "../../client";
import type {
  ClientMapping,
  ParsedSpreadsheet,
  SpreadsheetTable,
} from "../../client/types";
import type { FlowRecord, TemplateVersionRecord } from "../../domain/types";
import { requestKey } from "../lib/ids";
import { useApi } from "./api-context";
import type { DraftContextValue, DraftState } from "./types";

import { useDraftAttachments } from "./use-draft-attachments";
import { useDraftValidation } from "./use-draft-validation";

export const emptyDraft = (): DraftState => ({
  name: "",
  subject: "",
  cc: "",
  bcc: "",
  replyTo: "",
  body: "",
  fileName: "",
  fileSize: "",
  rowCount: 0,
  worksheet: "",
  headerRow: "Row 1",
  importance: "normal",
  toField: "",
  ccMode: "fixed",
  bccMode: "fixed",
  replyToMode: "fixed",
  ccColumn: "",
  bccColumn: "",
  replyToColumn: "",
  mappings: {},
});

export const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ children }: { readonly children: ReactNode }) {
  const { user, config, csrfToken } = useApi();
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [workbook, setWorkbook] = useState<ParsedSpreadsheet | null>(null);
  const [table, setTable] = useState<SpreadsheetTable | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [campaignResponse, setCampaignResponse] =
    useState<CampaignResponse | null>(null);
  const [snapshotLocked, setSnapshotLocked] = useState(false);
  const testRequest = useRef<DraftContextValue["testRequest"]["current"]>(null);
  const preparation = useRef<DraftContextValue["preparation"]["current"]>(null);
  const lockSnapshot = useCallback(() => setSnapshotLocked(true), []);
  const [skipInvalidRows, setSkipInvalidRows] = useState(false);
  const [campaignRequestKey, setCampaignRequestKey] = useState(requestKey);
  const [testSendRequestKey, setTestSendRequestKey] = useState(
    () => `test-${requestKey()}`,
  );
  const { bodyHtml, mapping, mappedRows, validation, campaignValidation } =
    useDraftValidation(draft, table, user, config, skipInvalidRows);
  const {
    attachments,
    setAttachments,
    attachmentSetId,
    attachmentSetRequestKey,
    attachmentsUploading,
    attachmentsHaveErrors,
    attachmentsReady,
    uploadAttachment,
    retryAttachment,
    removeAttachment,
    resetAttachmentState,
  } = useDraftAttachments(csrfToken, Boolean(campaignResponse));
  const updateDraft = useCallback(
    <K extends keyof DraftState>(key: K, value: DraftState[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    [],
  );
  const resetWizardState = useCallback(() => {
    testRequest.current = null;
    preparation.current = null;
    setSnapshotLocked(false);
    setDraft(emptyDraft());
    setWorkbook(null);
    setTable(null);
    setFlowId(null);
    setCampaignResponse(null);
    resetAttachmentState();
    setSkipInvalidRows(false);
    setCampaignRequestKey(requestKey());
    setTestSendRequestKey(`test-${requestKey()}`);
  }, [resetAttachmentState]);
  const restartFromMessage = useCallback(() => {
    testRequest.current = null;
    preparation.current = null;
    setSnapshotLocked(false);
    setCampaignResponse(null);
    resetAttachmentState();
    setCampaignRequestKey(requestKey());
    setTestSendRequestKey(`test-${requestKey()}`);
  }, [resetAttachmentState]);
  const hydrateSavedFlow = useCallback(
    (flow: FlowRecord, templateVersion: TemplateVersionRecord | null) => {
      testRequest.current = null;
      preparation.current = null;
      setSnapshotLocked(false);
      const savedMapping = templateVersion
        ? recipientConfigurationToClientMapping(
            templateVersion.recipientConfiguration,
          )
        : {
            toField: "",
            cc: null,
            bcc: null,
            replyTo: null,
            separator: "auto" as const,
            placeholders: {},
          };
      const sourceFields = (value: ClientMapping["cc"]) => {
        if (value && typeof value === "object" && value.kind === "column")
          return { mode: "column" as const, fixed: "", column: value.field };
        if (value && typeof value === "object" && value.kind === "fixed")
          return {
            mode: "fixed" as const,
            fixed: value.value || "",
            column: "",
          };
        return { mode: "fixed" as const, fixed: "", column: "" };
      };
      const cc = sourceFields(savedMapping.cc);
      const bcc = sourceFields(savedMapping.bcc);
      const replyTo = sourceFields(savedMapping.replyTo);
      setDraft({
        ...emptyDraft(),
        name: flow.name,
        subject: templateVersion?.subjectTemplate || "",
        body: templateVersion?.bodyHtml || "",
        cc: cc.fixed,
        bcc: bcc.fixed,
        replyTo: replyTo.fixed,
        importance: savedMapping.importance || "normal",
        fileName: "",
        fileSize: "",
        rowCount: 0,
        worksheet: "",
        headerRow: "Row 1",
        toField: savedMapping.toField,
        ccMode: cc.mode,
        bccMode: bcc.mode,
        replyToMode: replyTo.mode,
        ccColumn: cc.column,
        bccColumn: bcc.column,
        replyToColumn: replyTo.column,
        mappings: { ...savedMapping.placeholders },
      });
      setWorkbook(null);
      setTable(null);
      setFlowId(flow.id);
      setCampaignResponse(null);
      resetAttachmentState();
      setSkipInvalidRows(false);
      setCampaignRequestKey(requestKey());
      setTestSendRequestKey(`test-${requestKey()}`);
    },
    [resetAttachmentState],
  );
  const value = useMemo<DraftContextValue>(
    () => ({
      testRequest,
      snapshotLocked,
      lockSnapshot,
      restartFromMessage,
      preparation,
      draft,
      setDraft,
      updateDraft,
      workbook,
      setWorkbook,
      table,
      setTable,
      flowId,
      setFlowId,
      campaignResponse,
      setCampaignResponse,
      campaignRequestKey,
      testSendRequestKey,
      bodyHtml,
      mapping,
      mappedRows,
      validation,
      campaignValidation,
      skipInvalidRows,
      setSkipInvalidRows,
      config,
      hydrateSavedFlow,
      resetWizardState,
      attachments,
      setAttachments,
      attachmentSetId,
      attachmentSetRequestKey,
      attachmentsUploading,
      attachmentsHaveErrors,
      attachmentsReady,
      uploadAttachment,
      retryAttachment,
      removeAttachment,
    }),
    [
      snapshotLocked,
      lockSnapshot,
      restartFromMessage,
      draft,
      updateDraft,
      workbook,
      table,
      flowId,
      campaignResponse,
      campaignRequestKey,
      testSendRequestKey,
      bodyHtml,
      mapping,
      mappedRows,
      validation,
      campaignValidation,
      skipInvalidRows,
      config,
      hydrateSavedFlow,
      resetWizardState,
      attachments,
      attachmentSetId,
      attachmentSetRequestKey,
      attachmentsUploading,
      attachmentsHaveErrors,
      attachmentsReady,
      uploadAttachment,
      retryAttachment,
      removeAttachment,
    ],
  );
  return (
    <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
  );
}

export function useDraft(): DraftContextValue {
  return useContext(DraftContext)!;
}
