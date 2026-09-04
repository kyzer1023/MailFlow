import { validateAttachmentInput } from "../../domain/attachment-policy";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createAttachmentSet as createAttachmentSetRequest,
  deleteAttachmentFile as deleteAttachmentFileRequest,
  uploadAttachmentFile as uploadAttachmentFileRequest,
} from "../api";
import type { CampaignResponse } from "../api";
import {
  mapSpreadsheetRows,
  recipientConfigurationToClientMapping,
  validateClientCampaign,
} from "../../client";
import type {
  CampaignAttachment,
  ClientMapping,
  ClientValidationSummary,
  MappedRecipientRow,
  ParsedSpreadsheet,
  SpreadsheetTable,
} from "../../client/types";
import type { FlowRecord, TemplateVersionRecord } from "../../domain/types";
import { attachmentFileFromResponse } from "../lib/attachments";
import { bodyHtmlFromDraft } from "../lib/editor-dom";
import { requestKey } from "../lib/ids";
import { fallbackConfig, useApi } from "./api-context";
import type {
  AddressRuleMode,
  DraftContextValue,
  DraftState,
} from "./types";

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
  pace: fallbackConfig.defaultPacePerMinute,
  importance: "normal",
  toField: "",
  separator: "auto",
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
  const [templateVersionId, setTemplateVersionId] = useState<string | null>(null);
  const [campaignResponse, setCampaignResponse] = useState<CampaignResponse | null>(null);
  // Attachment bytes are held by the upload request and this ref only while
  // retry is possible. They are deliberately not part of draft state or any
  // campaign payload.
  const [attachments, setAttachments] = useState<CampaignAttachment[]>([]);
  const [attachmentSetId, setAttachmentSetId] = useState<string | null>(null);
  const attachmentSetIdRef = useRef<string | null>(null);
  const [attachmentSetRequestKey, setAttachmentSetRequestKey] = useState(() => `attachment-${requestKey()}`);
  const attachmentSourcesRef = useRef<Map<string, File>>(new Map());
  const attachmentSetPromiseRef = useRef<{ generation: number; promise: Promise<string> } | null>(null);
  const attachmentUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentGenerationRef = useRef(0);
  const [skipInvalidRows, setSkipInvalidRows] = useState(false);
  const [campaignRequestKey, setCampaignRequestKey] = useState(requestKey);
  const [testSendRequestKey, setTestSendRequestKey] = useState(() => `test-${requestKey()}`);
  const bodyHtml = useMemo(() => bodyHtmlFromDraft(draft.body), [draft.body]);
  const mapping = useMemo<ClientMapping>(() => {
    const source = (key: "cc" | "bcc" | "replyTo") => {
      const mode = draft[`${key}Mode` as keyof DraftState] as AddressRuleMode;
      const column = draft[`${key}Column` as keyof DraftState] as string;
      if (mode === "column" && column) return { kind: "column" as const, field: column };
      return { kind: "fixed" as const, value: draft[key] || "" };
    };
    return {
      toField: draft.toField || "",
      cc: source("cc"),
      bcc: source("bcc"),
      replyTo: source("replyTo"),
      importance: draft.importance || "normal",
      separator: draft.separator || "auto",
      placeholders: draft.mappings,
    };
  }, [draft]);
  const mappedRows = useMemo<readonly MappedRecipientRow[]>(() => table ? mapSpreadsheetRows(table, mapping).rows : [], [table, mapping]);
  const mappingIssues = useMemo(() => table ? mapSpreadsheetRows(table, mapping).issues : [], [table, mapping]);
  const validation = useMemo<ClientValidationSummary | null>(() => table ? validateClientCampaign({
    senderAddress: user?.mailboxAddress || user?.principalName || "",
    subjectTemplate: draft.subject,
    bodyHtml,
    rows: mappedRows,
    mappedFields: draft.mappings,
    separator: draft.separator || "auto",
    maxRecipients: config.maxCampaignRecipients,
    pacePerMinute: draft.pace,
    mappingIssues,
  }) : null, [table, user, draft, bodyHtml, mappedRows, mappingIssues, config]);
  const campaignValidation = useMemo<ClientValidationSummary | null>(() => {
    if (!validation || !skipInvalidRows || validation.ok) return validation;
    const rowOnly = validation.issues.length > 0 && validation.issues.every((issue) => issue.row !== undefined);
    return rowOnly ? { ...validation, ok: true, issues: [] } : validation;
  }, [validation, skipInvalidRows]);
  const updateDraft = useCallback((key: keyof DraftState, value: DraftState[keyof DraftState]) => setDraft((current) => ({ ...current, [key]: value })), []);
  const ensureAttachmentSet = useCallback(async () => {
    if (attachmentSetIdRef.current) return attachmentSetIdRef.current;
    const generation = attachmentGenerationRef.current;
    const currentRequest = attachmentSetPromiseRef.current;
    if (currentRequest && currentRequest.generation === generation) return currentRequest.promise;
    const promise = createAttachmentSetRequest(attachmentSetRequestKey, csrfToken).then((response) => {
      const id = response?.attachmentSet?.id;
      if (!id || attachmentGenerationRef.current !== generation) throw new Error("The attachment upload was cancelled. Choose the files again.");
      attachmentSetIdRef.current = id;
      setAttachmentSetId(id);
      return id;
    }).finally(() => {
      if (attachmentSetPromiseRef.current?.promise === promise) attachmentSetPromiseRef.current = null;
    });
    attachmentSetPromiseRef.current = { generation, promise };
    return promise;
  }, [attachmentSetRequestKey, csrfToken]);
  const performAttachmentUpload = useCallback(async (localId: string, file: File, generation: number) => {
    if (attachmentGenerationRef.current !== generation) return;
    setAttachments((current) => current.map((attachment) => attachment.id === localId
      ? { ...attachment, status: "uploading", error: undefined }
      : attachment));
    attachmentSourcesRef.current.set(localId, file);
    try {
      validateAttachmentInput({ filename: file.name, contentType: file.type, bytes: await file.arrayBuffer() });
      if (attachmentGenerationRef.current !== generation) return;
      const setId = await ensureAttachmentSet();
      if (attachmentGenerationRef.current !== generation) return;
      const response = await uploadAttachmentFileRequest(setId, file, csrfToken);
      if (attachmentGenerationRef.current !== generation) return;
      const next = attachmentFileFromResponse(response, file, localId);
      attachmentSourcesRef.current.delete(localId);
      setAttachments((current) => current.map((attachment) => attachment.id === localId ? next : attachment));
    } catch (error) {
      const message = error instanceof Error ? error.message : "This file could not be uploaded.";
      setAttachments((current) => current.map((attachment) => attachment.id === localId
        ? { ...attachment, status: "error", error: message }
        : attachment));
    }
  }, [csrfToken, ensureAttachmentSet]);
  const uploadAttachment = useCallback((localId: string, file: File) => {
    // One attachment set has one conditional file-count update. Serializing
    // the bounded five uploads prevents two browser requests from choosing
    // the same next position or racing that counter in D1.
    const generation = attachmentGenerationRef.current;
    const queued = attachmentUploadQueueRef.current.then(() => performAttachmentUpload(localId, file, generation));
    attachmentUploadQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [performAttachmentUpload]);
  const retryAttachment = useCallback((localId: string) => {
    const file = attachmentSourcesRef.current.get(localId);
    if (file) void uploadAttachment(localId, file);
  }, [uploadAttachment]);
  const removeAttachment = useCallback(async (localId: string) => {
    if (campaignResponse) return;
    const attachment = attachments.find((item) => item.id === localId);
    if (!attachment) return;
    const serverId = attachment.id && !attachment.id.startsWith("attachment-local-") ? attachment.id : "";
    try {
      if (serverId && attachmentSetId) await deleteAttachmentFileRequest(attachmentSetId, serverId, csrfToken);
      attachmentSourcesRef.current.delete(localId);
      setAttachments((current) => current.filter((item) => item.id !== localId));
    } catch (error) {
      setAttachments((current) => current.map((item) => item.id === localId
        ? { ...item, status: "error", error: error instanceof Error ? error.message : "This file could not be removed." }
        : item));
    }
  }, [attachmentSetId, attachments, campaignResponse, csrfToken]);
  const resetAttachmentState = useCallback(() => {
    attachmentGenerationRef.current += 1;
    attachmentSetPromiseRef.current = null;
    attachmentUploadQueueRef.current = Promise.resolve();
    attachmentSourcesRef.current.clear();
    setAttachments([]);
    attachmentSetIdRef.current = null;
    setAttachmentSetId(null);
    setAttachmentSetRequestKey(`attachment-${requestKey()}`);
  }, []);
  const attachmentsUploading = attachments.some((attachment) => attachment.status === "uploading");
  const attachmentsHaveErrors = attachments.some((attachment) => attachment.status === "error");
  const attachmentsReady = !attachmentsUploading && !attachmentsHaveErrors && attachments.every((attachment) => attachment.status === "ready");
  const resetWizardState = useCallback(() => {
    setDraft(emptyDraft());
    setWorkbook(null);
    setTable(null);
    setFlowId(null);
    setTemplateVersionId(null);
    setCampaignResponse(null);
    resetAttachmentState();
    setSkipInvalidRows(false);
    setCampaignRequestKey(requestKey());
    setTestSendRequestKey(`test-${requestKey()}`);
  }, [resetAttachmentState]);
  const hydrateSavedFlow = useCallback((flow: FlowRecord, templateVersion: TemplateVersionRecord | null) => {
    const savedMapping = templateVersion
      ? recipientConfigurationToClientMapping(templateVersion.recipientConfiguration)
      : { toField: "", cc: null, bcc: null, replyTo: null, separator: "auto" as const, placeholders: {} };
    const sourceFields = (value: ClientMapping["cc"]) => {
      if (value && typeof value === "object" && value.kind === "column") return { mode: "column" as const, fixed: "", column: value.field };
      if (value && typeof value === "object" && value.kind === "fixed") return { mode: "fixed" as const, fixed: value.value || "", column: "" };
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
      separator: savedMapping.separator ?? "auto",
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
    setTemplateVersionId(templateVersion?.id || null);
    setCampaignResponse(null);
    resetAttachmentState();
    setSkipInvalidRows(false);
    setCampaignRequestKey(requestKey());
    setTestSendRequestKey(`test-${requestKey()}`);
  }, [resetAttachmentState]);
  const value = useMemo<DraftContextValue>(() => ({ draft, setDraft, updateDraft, workbook, setWorkbook, table, setTable, flowId, setFlowId, templateVersionId, setTemplateVersionId, campaignResponse, setCampaignResponse, campaignRequestKey, testSendRequestKey, bodyHtml, mapping, mappedRows, validation, campaignValidation, skipInvalidRows, setSkipInvalidRows, config, hydrateSavedFlow, resetWizardState, attachments, setAttachments, attachmentSetId, attachmentSetRequestKey, attachmentsUploading, attachmentsHaveErrors, attachmentsReady, uploadAttachment, retryAttachment, removeAttachment }), [draft, updateDraft, workbook, table, flowId, templateVersionId, campaignResponse, campaignRequestKey, testSendRequestKey, bodyHtml, mapping, mappedRows, validation, campaignValidation, skipInvalidRows, config, hydrateSavedFlow, resetWizardState, attachments, attachmentSetId, attachmentSetRequestKey, attachmentsUploading, attachmentsHaveErrors, attachmentsReady, uploadAttachment, retryAttachment, removeAttachment]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  return useContext(DraftContext)!;
}
