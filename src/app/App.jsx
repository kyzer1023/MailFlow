import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CaretLeft, CaretRight, Check, CheckCircle, Clock,
  DownloadSimple, Envelope, FileArrowUp, FileCsv, Files, FlowArrow, Gauge,
  Info,
  MinusCircle, Paperclip, PaperPlaneTilt, Pause, Play,
  Rows, SpinnerGap, TextAlignCenter, TextAlignLeft, TextAlignRight, TextB,
  Users, WarningCircle, X,
} from "@phosphor-icons/react";
import {
  ApiRequestError,
  createCampaign as createCampaignRequest,
  createFlow as createFlowRequest,
  createTemplateVersion as createTemplateVersionRequest,
  downloadCampaignExport,
  getCampaign,
  getCampaignJobs,
  getFlow,
  pauseCampaign,
  resumeCampaign,
  sendCampaignTest,
  startCampaign,
  updateFlow as updateFlowRequest,
} from "./api";
import {
  buildPreviewSrcDoc,
  buildMessagePreviews,
  createCampaignPayload,
  extractPlaceholders,
  getHeaderRowCandidates,
  mappingsForCurrentTable,
  mappingToRecipientConfiguration,
  parseSpreadsheet,
  selectSpreadsheetTable,
  sanitizeTemplateHtml,
} from "../client";
import { attachmentSummaryText } from "./lib/attachments";
import { bodyHtmlFromDraft, dynamicFieldLabel } from "./lib/editor-dom";
import { formatDate } from "./lib/format";
import { splitFixedAddresses, uniqueValidationIssues, validationIssueAction } from "./lib/review";
import { columnOptions, findColumn } from "./lib/view-models";
import { AttachmentPicker } from "./components/attachments/AttachmentPicker";
import { AddressRuleField } from "./components/recipients/AddressRuleField";
import { DynamicValueChip } from "./components/common/DynamicValueChip";
import { Field } from "./components/common/Field";
import { StatusChip } from "./components/common/StatusChip";
import { AppShell } from "./components/shell/AppShell";
import { TokenMessageEditor } from "./components/editor/TokenMessageEditor";
import { WizardShell } from "./components/wizard/WizardShell";
import { AppDataProvider, useApi } from "./state/api-context";
import { DraftProvider, useDraft } from "./state/draft-context";
import { RequireProductSession } from "./routing/RequireProductSession";
import { LandingPage } from "./routes/public/LandingPage";
import { CampaignsPage } from "./routes/overview/CampaignsPage";
import { DashboardPage } from "./routes/overview/DashboardPage";
import { FlowsPage } from "./routes/overview/FlowsPage";

function TemplatePage() {
  const { draft, updateDraft, flowId, mapping, setFlowId, setTemplateVersionId, table } = useDraft();
  const { csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const { flowId: editingFlowId } = useParams();
  const bodyRef = useRef(null);
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [nameError, setNameError] = useState("");
  const dynamicOptions = columnOptions(table);
  const dynamicFields = dynamicOptions.map((option) => option.value);
  const editingExisting = Boolean(editingFlowId) && !table;
  const sanitizedDraftBody = useMemo(() => sanitizeTemplateHtml(bodyHtmlFromDraft(draft.body)), [draft.body]);
  const canSave = Boolean(draft.name.trim() && draft.subject.trim() && sanitizedDraftBody.trim() && mapping.toField);

  const editDraft = (key, value) => {
    updateDraft(key, value);
    setSaveState("idle");
    setSaveError("");
    if (key === "name") setNameError("");
  };

  const insertDynamicField = (key) => {
    bodyRef.current?.insertToken(key);
  };

  const saveFlowDraft = async (destination = "") => {
    if (!canSave) {
      setSaveError("Add a flow name, subject, message body, and primary recipient before saving.");
      return;
    }
    setSaveState("saving"); setSaveError(""); setNameError("");
    let flowNameSaved = false;
    try {
      const bodyHtml = sanitizedDraftBody;
      updateDraft("body", bodyHtml);
      const recipientConfiguration = mappingToRecipientConfiguration(mapping);
      const templatePayload = { subjectTemplate: draft.subject, bodyHtml, placeholderManifest: extractPlaceholders(draft.subject, bodyHtml), recipientConfiguration };
      if (!flowId) {
        const response = await createFlowRequest({ name: draft.name, ...templatePayload }, csrfToken);
        setFlowId(response.flow.id);
        setTemplateVersionId(response.templateVersion?.id || null);
      } else {
        await updateFlowRequest(flowId, { name: draft.name }, csrfToken);
        flowNameSaved = true;
        const response = await createTemplateVersionRequest(flowId, templatePayload, csrfToken);
        setTemplateVersionId(response.version.id);
      }
      await refreshDashboard();
      setSaveState("saved");
      if (destination) navigate(destination);
    } catch (error) {
      setSaveState("error");
      if (error instanceof ApiRequestError && error.code === "flow_name_conflict") {
        setNameError(error.message);
      } else {
        const message = error instanceof Error ? error.message : "The flow could not be saved.";
        setSaveError(flowNameSaved ? `The flow name was saved, but the message changes were not saved. ${message}` : message);
      }
    }
  };
  const nextDestination = editingExisting ? "/flows" : "/flows/new/recipients";
  if (!table && !editingExisting) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>Import your data first.</h1><p>The template editor builds its dynamic fields from your spreadsheet headers.</p><Link className="button button--coral" to="/flows/new/data">Start with data</Link></div></AppShell>;
  }
  return <WizardShell current={1} title="Compose the reusable message." subtitle="Your spreadsheet headers are ready to use as dynamic fields." actions={<><button className="button button--outline" onClick={() => navigate(editingExisting ? "/flows" : "/flows/new/data")}><ArrowLeft /> Back</button><button className="button button--text" onClick={() => void saveFlowDraft()} disabled={saveState === "saving" || !canSave}><Files /> {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save draft"}</button><button className="button button--coral" onClick={() => void saveFlowDraft(nextDestination)} disabled={saveState === "saving" || !canSave}>{editingExisting ? "Save changes" : "Continue to recipients"} <ArrowRight /></button></>}>
    <div className="template-layout">
      <section className="panel editor-card">
        {saveError && <div className="notice notice--warn template-save-error" role="alert"><WarningCircle weight="fill" /><span><strong>Changes were not fully saved.</strong>{saveError}</span></div>}
        <Field label="Flow name" error={nameError} errorId="flow-name-error"><input value={draft.name} onChange={(event) => editDraft("name", event.target.value)} placeholder="For example, Event invitation" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "flow-name-error" : undefined} /></Field>
        <Field label="Subject"><input value={draft.subject} onChange={(event) => editDraft("subject", event.target.value)} placeholder="Add a clear email subject" /></Field>
        <div className="field"><span>Message body</span><TokenMessageEditor ref={bodyRef} value={draft.body} onChange={(value) => editDraft("body", value)} options={dynamicOptions} placeholder="Write the reusable message here." /><small>Use the code button to switch between visual formatting and the sanitized HTML source.</small></div>
      </section>
      <aside className="panel dynamic-panel"><h2>Dynamic values</h2><p>Detected from your spreadsheet headers</p>{dynamicFields.length > 0 ? <div className="token-stack">{dynamicFields.map((key) => <button type="button" key={key} onClick={() => insertDynamicField(key)} aria-label={`Insert ${dynamicFieldLabel(key, dynamicOptions)}`}><DynamicValueChip value={key} options={dynamicOptions} /></button>)}</div> : <div className="empty-state empty-state--compact">No fields are available. Return to Data and import a spreadsheet.</div>}<div className="notice"><Info weight="fill" /><span>Click a value to insert it in the message. Highlighted text is replaced.</span></div><div className="envelope-preview"><img src="/assets/mailflow-logo-horizontal.png" alt="" /><strong>Safe preview</strong><small>HTML is cleaned before preview. Unsafe elements are removed before sending.</small></div></aside>
    </div>
  </WizardShell>;
}

function EditFlowTemplatePage() {
  const { flowId: routeFlowId } = useParams();
  const { flowId, hydrateSavedFlow } = useDraft();
  const [loadState, setLoadState] = useState({ status: "idle", error: "" });

  useEffect(() => {
    if (!routeFlowId || flowId === routeFlowId) return undefined;
    let active = true;
    setLoadState({ status: "loading", error: "" });
    void getFlow(routeFlowId).then((response) => {
      if (!active) return;
      hydrateSavedFlow(response.flow, response.templateVersion);
      setLoadState({ status: "ready", error: "" });
    }).catch((error) => {
      if (!active) return;
      setLoadState({ status: "error", error: error instanceof Error ? error.message : "The saved flow could not be opened." });
    });
    return () => { active = false; };
  }, [routeFlowId, flowId, hydrateSavedFlow]);

  if (routeFlowId && flowId !== routeFlowId) {
    return <AppShell><div className="route-gate" role={loadState.status === "error" ? "alert" : "status"}>{loadState.status === "error" ? <WarningCircle weight="fill" /> : <SpinnerGap className="spin" />}<h1>{loadState.status === "error" ? "This flow could not be opened." : "Opening your flow..."}</h1>{loadState.error && <p>{loadState.error}</p>}{loadState.status === "error" && <Link className="button button--outline" to="/flows">Return to flows</Link>}</div></AppShell>;
  }
  return <TemplatePage />;
}

function DataFirstPage() {
  const { draft, setDraft, workbook, setWorkbook, table, setTable, validation, mappedRows } = useDraft();
  const navigate = useNavigate();
  const [uploadState, setUploadState] = useState("ready");
  const [uploadError, setUploadError] = useState("");
  const options = columnOptions(table);
  const worksheet = workbook?.worksheets.find((item) => item.name === draft.worksheet) || workbook?.worksheets[0];
  const headerCandidates = worksheet ? getHeaderRowCandidates(worksheet) : [];
  const templateFields = extractPlaceholders(draft.subject, bodyHtmlFromDraft(draft.body));
  const mappingFields = templateFields.length > 0 ? templateFields : Object.keys(draft.mappings || {});

  const rebuildTable = (sourceWorkbook, worksheetName, headerRow) => {
    try {
      const nextTable = selectSpreadsheetTable(sourceWorkbook, { worksheet: worksheetName, headerRow });
      const nextMappings = mappingsForCurrentTable(nextTable);
      const nextTo = draft.toField && nextTable.columns.some((column) => column.key === draft.toField) ? draft.toField : findColumn(nextTable, ["email", "mail"]);
      setTable(nextTable);
      setDraft((current) => ({ ...current, worksheet: nextTable.worksheetName, headerRow: `Row ${nextTable.headerRow}`, rowCount: nextTable.rows.length, toField: nextTo, mappings: nextMappings }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "We could not select that worksheet.");
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState("loading");
    setUploadError("");
    try {
      const parsed = await parseSpreadsheet(await file.arrayBuffer(), { fileName: file.name });
      setWorkbook(parsed);
      const first = parsed.worksheets.find((item) => item.visibility === "visible") || parsed.worksheets[0];
      rebuildTable(parsed, first.name, "auto");
      setDraft((value) => ({ ...value, fileName: file.name, fileSize: `${Math.max(1, Math.round(file.size / 1024))} KB` }));
      setUploadState("ready");
    } catch (error) {
      setUploadState("error");
      setUploadError(error instanceof Error ? error.message : "We could not read that file.");
    }
  };

  const previewColumns = table?.columns.slice(0, 6) || [];
  const previewRows = table?.rows.slice(0, 8) || [];
  const readyCount = validation?.validRecipientCount ?? 0;
  const attentionCount = validation?.invalidRows.length ?? 0;
  const firstIssue = validation?.issues.find((issue) => issue.row !== undefined) || null;
  const canContinue = Boolean(table && draft.toField);
  const subtitle = table ? `We found ${draft.rowCount} rows in ${draft.fileName}.` : "Start with a CSV or Excel file so we can discover its dynamic fields.";

  return (
    <WizardShell
      current={0}
      title="Bring in the recipient data."
      subtitle={subtitle}
      actions={(
        <>
          <button className="button button--outline" onClick={() => navigate("/flows")}><ArrowLeft /> Back to flows</button>
          <button className="button button--coral" onClick={() => navigate("/flows/new/template")} disabled={!canContinue}>Continue to template <ArrowRight /></button>
        </>
      )}
    >
      <div className={`data-layout ${!table ? "data-layout--empty" : ""}`}>
        <section className="panel upload-panel">
          <div className="upload-card">
            <span className="upload-icon"><FileArrowUp weight="duotone" /></span>
            <div>
              <h2>{draft.fileName || "Upload CSV or Excel"}</h2>
              <p>{draft.fileName ? `${draft.fileSize} · ${draft.rowCount} rows` : "Choose a .csv or .xlsx file. It stays in this browser until you confirm the campaign."}</p>
              {uploadError && <p className="error-text" role="alert"><WarningCircle /> {uploadError}</p>}
            </div>
            <label className="button button--outline file-button">
              {uploadState === "loading" ? <SpinnerGap className="spin" /> : <FileCsv />}
              {draft.fileName ? "Replace file" : "Choose file"}
              <input type="file" accept=".csv,.xlsx" onChange={onFile} />
            </label>
          </div>
          {table ? (
            <>
              <div className="sheet-controls">
                <Field label="Worksheet">
                  <select value={draft.worksheet} onChange={(event) => rebuildTable(workbook, event.target.value, Number.parseInt(draft.headerRow.replace(/\D/gu, ""), 10) || "auto")}>
                    {workbook.worksheets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="Header row">
                  <select value={draft.headerRow} onChange={(event) => rebuildTable(workbook, draft.worksheet, Number.parseInt(event.target.value.replace(/\D/gu, ""), 10) || "auto")}>
                    {headerCandidates.map((row) => <option key={row}>Row {row}</option>)}
                  </select>
                </Field>
                <div className="validation-badge">
                  <CheckCircle weight="fill" />
                  <span><strong>{readyCount} ready</strong><small>{attentionCount} rows need attention</small></span>
                </div>
              </div>
              <div className="preview-table table-wrap">
                <table>
                  <thead><tr><th>Row</th>{previewColumns.map((column) => <th key={column.key}>{column.label || column.key}</th>)}</tr></thead>
                  <tbody>
                    {previewRows.map((row) => {
                      const invalid = validation?.invalidRows.includes(row.sourceRow);
                      return (
                        <tr key={row.sourceRow} className={invalid ? "row-error" : ""}>
                          <td>{row.sourceRow}</td>
                          {previewColumns.map((column) => <td key={column.key}>{row.values[column.key]}{invalid && column.key === draft.toField && <WarningCircle />}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {firstIssue && (
                <div className="issue-strip">
                  <WarningCircle weight="fill" />
                  <span><strong>Row {firstIssue.row}. Recipient data needs attention</strong><small>{firstIssue.message}</small></span>
                  <span>{attentionCount} flagged {attentionCount === 1 ? "row" : "rows"}</span>
                </div>
              )}
            </>
          ) : (
            <div className="upload-empty">
              <h3>Your file defines the flow.</h3>
              <p>Once imported, the header row becomes the set of dynamic fields available in the template. No sample recipients are preloaded.</p>
              <span><CheckCircle weight="fill" /> Parsed locally in your browser</span>
            </div>
          )}
        </section>
        <aside className="panel mapping-panel">
          <div className="section-heading">
            <div>
              <h2>{table ? "Map your spreadsheet" : "Why data comes first"}</h2>
              <p>{table ? "Choose the email column, then match each message value to a column." : "The message editor should only offer values that truly exist in your file."}</p>
            </div>
            <Rows />
          </div>
          {table ? (
            <>
              <Field label="Recipient email column">
                <select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}>
                  <option value="">Choose a column</option>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              {templateFields.length > 0 && mappingFields.map((key) => (
                <Field key={key} label={`${dynamicFieldLabel(key, options)} in message`}>
                  <select value={draft.mappings[key] || ""} onChange={(event) => setDraft((value) => ({ ...value, mappings: { ...value.mappings, [key]: event.target.value } }))}>
                    <option value="">Choose a column</option>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
              ))}
              <div className="detected-field-group">
                <span className="detected-field-group__label">Columns found in your file</span>
                <div className="detected-field-list">
                  {options.map((option) => <span className="detected-field-name" key={option.value}>{option.label}</span>)}
                </div>
              </div>
              <div className="validation-metrics">
                <span><CheckCircle weight="fill" /><strong>{readyCount}</strong><small>ready</small></span>
                <span><WarningCircle weight="fill" /><strong>{attentionCount}</strong><small>attention</small></span>
                <span><Users weight="fill" /><strong>{validation?.duplicateRecipients.length ?? 0}</strong><small>duplicate</small></span>
              </div>
              <div className="locked-note"><CheckCircle weight="fill" /> Nothing is sent until Review.</div>
            </>
          ) : (
            <ol className="data-first-list">
              <li>Import the file.</li>
              <li>Confirm the header row.</li>
              <li>Use those headers in the message.</li>
            </ol>
          )}
        </aside>
      </div>
    </WizardShell>
  );
}

function RecipientsPage() {
  const { draft, setDraft, updateDraft, table, validation, attachmentsReady } = useDraft();
  const { user, config } = useApi();
  const navigate = useNavigate();
  const options = columnOptions(table);
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const updateRule = (fieldKey, property, value) => setDraft((current) => ({ ...current, [property === "mode" ? `${fieldKey}Mode` : property === "column" ? `${fieldKey}Column` : fieldKey]: value }));
  const ruleProps = (fieldKey, label, hint) => ({
    fieldKey,
    label,
    hint,
    value: draft[fieldKey],
    mode: draft[`${fieldKey}Mode`],
    column: draft[`${fieldKey}Column`],
    options,
    onValue: (value) => updateRule(fieldKey, "value", value),
    onMode: (value) => updateRule(fieldKey, "mode", value),
    onColumn: (value) => updateRule(fieldKey, "column", value),
  });

  return <WizardShell current={2} title="Set the sending rules." subtitle="Recipients stay scoped to this file and this flow. Your USM Outlook remains the sender." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/template")}><ArrowLeft /> Back</button><button className="button button--coral" onClick={() => navigate("/flows/new/review")} disabled={!table || !draft.toField || !attachmentsReady} title={!attachmentsReady ? "Finish attachment uploads before continuing." : undefined}>Continue to review <ArrowRight /></button></>}>
    <div className="recipients-layout">
      <section className="panel recipient-card">
        <div className="locked-sender"><span><Envelope weight="fill" /></span><div><small>Sender, locked by Microsoft</small><strong>{sender}</strong><p>Every spreadsheet row produces one separate message from this mailbox.</p></div><CheckCircle weight="fill" /></div>
        <Field label="Primary recipient column"><select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}><option value="">Choose a column</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <div className="two-fields recipient-address-grid"><AddressRuleField {...ruleProps("cc", "CC")} /><AddressRuleField {...ruleProps("bcc", "BCC")} /></div>
        <div className="two-fields recipient-bottom-grid">
          <AddressRuleField {...ruleProps("replyTo", "Reply-to", "The address members will use when replying. Leave empty to use your sender mailbox.")} />
          <Field label="Importance" hint="Sets the priority flag shown by supported email clients."><select value={draft.importance} onChange={(event) => updateDraft("importance", event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></Field>
        </div>
        {validation && !validation.ok && <div className="notice notice--warn"><WarningCircle weight="fill" /><span>Flagged recipient rows can be skipped during Review. Template-level issues must be resolved before sending.</span></div>}
        {config.attachmentsEnabled
          ? <AttachmentPicker />
          : config.attachmentsSmtpAuthorizationRequired
            ? <div className="notice notice--warn"><Info weight="fill" /><span>Reconnect Microsoft to authorize SMTP attachments.</span><a className="button button--text" href="/auth/microsoft/start?returnTo=%2Fflows%2Fnew%2Frecipients">Reconnect Microsoft</a></div>
            : config.attachmentsOneDriveAuthorizationRequired
              ? <div className="notice notice--warn"><Info weight="fill" /><span>Connect your OneDrive to store attachment files in your MailFlow app folder.</span><a className="button button--text" href="/auth/microsoft/onedrive/start?returnTo=%2Fflows%2Fnew%2Frecipients">Connect OneDrive</a></div>
              : <div className="notice"><Info weight="fill" /><span>Attachments become available when this deployment uses SMTP delivery.</span></div>}
      </section>
      <aside className="panel pace-card"><Gauge weight="duotone" /><h2>Paced for safety</h2><p>Mail Flow sends one personalized message at a time and records the result for every row.</p><Field label={`${draft.pace} messages per minute`}><input type="range" min="6" max="20" value={draft.pace} onChange={(event) => updateDraft("pace", Number(event.target.value))} /></Field><div className="pace-facts"><span><strong>{validation?.totalRows ?? draft.rowCount}</strong>Total rows</span><span><strong>About {Math.ceil((validation?.validRecipientCount ?? draft.rowCount) / draft.pace)} min</strong>Estimated time</span></div><div className="notice"><Info weight="fill" /><span>Accepted rows are never sent twice. An uncertain Microsoft response is marked Unknown for manual review.</span></div></aside>
    </div>
  </WizardShell>;
}

function useEnsureCampaign() {
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
    let currentVersionId = null;
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

function ReviewPage() {
  const state = useDraft();
  const { user, csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const [sampleIndex, setSampleIndex] = useState(0);
  const [ack, setAck] = useState(false);
  const [testState, setTestState] = useState("idle");
  const [actionError, setActionError] = useState("");
  const ensureCampaign = useEnsureCampaign();
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const displayName = user?.displayName || "USM member";
  const rows = state.validation?.validRows || [];
  const attachments = state.attachments || [];
  const previews = useMemo(() => buildMessagePreviews({ senderAddress: sender, subjectTemplate: state.draft.subject, bodyHtml: state.bodyHtml, rows, fieldMappings: state.draft.mappings }), [sender, state.draft.subject, state.draft.mappings, state.bodyHtml, rows]);
  const safeIndex = Math.min(sampleIndex, Math.max(0, previews.length - 1));
  const message = previews[safeIndex] || null;
  const canSkip = Boolean(state.validation && !state.validation.ok && state.validation.issues.length > 0 && state.validation.issues.every((issue) => issue.row !== undefined));
  const blockingIssues = uniqueValidationIssues(state.campaignValidation?.issues || []);
  const attachmentBlocker = state.attachmentsUploading
    ? "Finish uploading attachments before continuing."
    : state.attachmentsHaveErrors
      ? "Remove failed attachments or retry before continuing."
      : !state.attachmentsReady
        ? "Finish preparing attachments before continuing."
        : "";
  const ready = Boolean(state.table && message && ack && state.campaignValidation?.ok && state.attachmentsReady);
  const actionBlocker = blockingIssues.length > 0
    ? `Resolve ${blockingIssues.length} validation ${blockingIssues.length === 1 ? "issue" : "issues"} first.`
    : attachmentBlocker || (!ack ? "Check the final acknowledgement first." : "");

  const sendTest = async () => {
    if (!message || !state.campaignValidation?.ok || !state.attachmentsReady) return;
    setTestState("sending");
    setActionError("");
    try {
      const response = await ensureCampaign();
      await sendCampaignTest(response.campaign.id, {
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        importance: state.draft.importance,
      }, csrfToken);
      setTestState("accepted");
    } catch (error) {
      setTestState("error");
      setActionError(error instanceof Error ? error.message : "The test message could not be accepted by Microsoft.");
    }
  };

  const start = async () => {
    if (!ready) return;
    setActionError("");
    try {
      const response = await ensureCampaign();
      await startCampaign(response.campaign.id, csrfToken);
      void refreshDashboard();
      navigate(`/campaigns/${response.campaign.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The campaign could not be started.");
    }
  };

  if (!state.table) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>Import a recipient file first.</h1><p>Review only becomes available after Data, Template, and Recipients are complete.</p><Link className="button button--coral" to="/flows/new/data">Start with data</Link></div></AppShell>;
  }

  const previewDocument = message ? buildPreviewSrcDoc(message.bodyHtml) : "";
  return <WizardShell current={3} title="Review every detail before it leaves." subtitle="Check representative rows, send a test to yourself, then confirm the paced campaign." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/recipients")}><ArrowLeft /> Back</button><button className="button button--outline" onClick={() => void sendTest()} disabled={testState === "sending" || !message || !state.campaignValidation?.ok || !state.attachmentsReady} title={actionBlocker || undefined} aria-describedby={actionBlocker ? "review-blockers" : undefined}>{testState === "sending" ? <SpinnerGap className="spin" /> : <Envelope />} Send test to me</button><button className="button button--coral" disabled={!ready} onClick={() => void start()} title={actionBlocker || undefined} aria-describedby={actionBlocker ? "review-blockers" : undefined}>Confirm &amp; start <PaperPlaneTilt weight="fill" /></button></>}><div className="review-layout"><aside className="panel sample-card"><span className="section-kicker">SAMPLE ROWS</span><h2>Who are you checking?</h2>{previews.slice(0, 3).map((preview, index) => <button key={`${preview.position}-${preview.sourceRow}`} className={index === safeIndex ? "selected" : ""} onClick={() => setSampleIndex(index)}><span>{["First", "Middle", "Last"][index]}</span><strong>{preview.to}</strong><small>Row {preview.sourceRow}</small></button>)}{previews.length === 0 && <p className="empty-state">No valid recipient rows are available yet.</p>}<footer><button aria-label="Previous sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + previews.length - 1) % previews.length)}><CaretLeft /></button><span>{previews.length ? `${safeIndex + 1} of ${Math.min(3, previews.length)}` : "0 of 0"}</span><button aria-label="Next sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + 1) % previews.length)}><CaretRight /></button></footer></aside><section className="panel mailbox-preview">{message ? <><div className="mail-toolbar"><span>Personalized preview</span></div><div className="mail-meta"><span className="avatar">{displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{displayName}</strong><small>{sender}</small></span><StatusChip status="ready">Preview</StatusChip></div><dl><div><dt>To</dt><dd>{message.to}</dd></div>{message.cc.length > 0 && <div><dt>CC</dt><dd>{message.cc.join(", ")}</dd></div>}{message.bcc.length > 0 && <div><dt>BCC</dt><dd>{message.bcc.join(", ")}</dd></div>}{message.replyTo.length > 0 && <div><dt>Reply-to</dt><dd>{message.replyTo.join(", ")}</dd></div>}<div><dt>Subject</dt><dd>{message.subject}</dd></div>{attachments.length > 0 && <div><dt>Attachments</dt><dd className="mail-attachment-summary">{attachmentSummaryText(attachments)}</dd></div>}</dl><iframe title={`Email preview for ${message.to}`} sandbox="allow-same-origin" srcDoc={previewDocument} /></> : <div className="empty-state">Resolve the recipient issues to generate a preview.</div>}</section><aside className="panel review-summary"><span className="section-kicker">FINAL CHECK</span><h2>Review summary</h2>{[[Envelope, "Sender", sender], [Users, "Recipients", `${state.validation?.validRecipientCount ?? 0} valid, ${state.validation?.skippedRecipientCount ?? 0} skipped`], [Envelope, "CC", state.draft.cc || "None"], [Paperclip, "Attachments", attachmentSummaryText(attachments)], [Gauge, "Pacing", `${state.draft.pace} messages per minute`], [Clock, "Estimated duration", `About ${Math.ceil((state.validation?.validRecipientCount ?? 0) / state.draft.pace)} minutes`], [CheckCircle, "Validation", state.campaignValidation?.ok ? "Ready to queue" : `${blockingIssues.length} issues to review`]].map(([Icon, label, value]) => <div className="fact" key={label}><span><Icon weight="fill" /></span><div><small>{label}</small><strong>{value}</strong></div></div>)}{(blockingIssues.length > 0 || attachmentBlocker) && <section className="review-blockers" id="review-blockers" role="alert"><div><WarningCircle weight="fill" /><h3>Fix these before sending</h3></div>{blockingIssues.length > 0 && <ul>{blockingIssues.map((issue) => { const action = validationIssueAction(issue); return <li key={`${issue.code}:${issue.field || ""}:${issue.row || ""}:${issue.message}`}><span>{issue.message}</span><Link to={action.to}>{action.label}</Link></li>; })}</ul>}{attachmentBlocker && <p className="review-attachment-blocker">{attachmentBlocker} <Link to="/flows/new/recipients">Manage attachments</Link></p>}</section>}{canSkip && <label className="ack"><input type="checkbox" checked={state.skipInvalidRows} onChange={(event) => state.setSkipInvalidRows(event.target.checked)} /><span>Skip the flagged rows and continue with valid recipients only.</span></label>}<label className="ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I have checked the sender, recipients, and personalized message.</span></label><div className="accepted-note"><Info weight="fill" /> Microsoft acceptance means the request was received. It is not a delivery receipt.</div><p className="test-status" aria-live="polite">{testState === "accepted" && <><CheckCircle weight="fill" /> Test accepted by Microsoft</>}{testState === "sending" && "Sending one message to your mailbox..."}{testState === "error" && <><WarningCircle weight="fill" /> {actionError}</>}{actionError && testState !== "error" && <><WarningCircle weight="fill" /> {actionError}</>}</p></aside></div></WizardShell>;
}

function CampaignPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { csrfToken, user, refreshDashboard } = useApi();
  const [campaignState, setCampaignState] = useState(null);
  const [counts, setCounts] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionState, setActionState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const sequence = ++loadSequence.current;
    try {
      const [campaignResponse, jobsResponse] = await Promise.all([getCampaign(campaignId), getCampaignJobs(campaignId, 100, 0)]);
      if (sequence !== loadSequence.current) return;
      setCampaignState(campaignResponse.campaign);
      setCounts(campaignResponse.counts);
      setJobs(jobsResponse.jobs);
      setLoadError("");
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setCampaignState(null);
      setCounts(null);
      setJobs(null);
      setLoadError(error instanceof Error ? error.message : "The campaign could not be loaded.");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    if (!campaignId) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      loadSequence.current += 1;
      window.clearInterval(timer);
    };
  }, [load, campaignId]);

  if (!campaignId) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>No campaign selected.</h1><p>Choose a campaign from Campaign history.</p><Link className="button button--outline" to="/campaigns">View campaigns</Link></div></AppShell>;
  }

  const paused = campaignState?.state === "paused";
  const activeCounts = counts || { pending: 0, claimed: 0, sending: 0, accepted: 0, skipped: 0, failed: 0, unknown: 0 };
  const total = campaignState?.totalRecipients || 0;
  const processed = activeCounts.accepted + activeCounts.failed + activeCounts.skipped + activeCounts.unknown;
  const progress = campaignState ? Math.min(100, Math.round((processed / Math.max(1, total)) * 100)) : 0;
  const routeCounts = [["Total", total, Rows], ["Pending", activeCounts.pending, Clock], ["Sending", activeCounts.sending + activeCounts.claimed, PaperPlaneTilt], ["Accepted", activeCounts.accepted, Check], ["Skipped", activeCounts.skipped, MinusCircle], ["Failed", activeCounts.failed + activeCounts.unknown, WarningCircle]];
  const displayJobs = jobs || [];
  const sender = campaignState?.senderAddress || user?.mailboxAddress || "Sender not available";
  const statusKind = campaignState?.state || "unknown";
  const statusLabel = statusKind === "paused" ? "Paused safely" : statusKind === "completed" ? "Completed" : statusKind === "failed" ? "Failed" : statusKind === "queued" ? "Queued" : statusKind === "validated" ? "Validated" : statusKind === "draft" ? "Draft" : loadError ? "Unavailable" : "Loading";

  const updateAction = async (action) => {
    if (actionState !== "idle" || !campaignId || !["queued", "running", "paused"].includes(campaignState?.state)) return;
    setActionState(action);
    setLoadError("");
    try {
      const response = action === "pause"
        ? await pauseCampaign(campaignId, csrfToken)
        : await resumeCampaign(campaignId, csrfToken);
      setCampaignState(response.campaign);
      void refreshDashboard();
      await load();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The campaign could not be updated.");
      await load();
    } finally {
      setActionState("idle");
    }
  };

  const exportRows = async () => {
    try {
      const blob = await downloadCampaignExport(campaignId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${campaignId}-results.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The result export could not be prepared.");
    }
  };

  const copyCampaignId = async () => {
    try {
      await navigator.clipboard.writeText(campaignId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setLoadError("The campaign ID could not be copied. Select it manually instead.");
    }
  };

  return <AppShell><div className="page campaign-page"><header className="page-header campaign-header"><div><span className="section-kicker">CAMPAIGN</span><h1>The campaign can leave without you.</h1><p>Mail Flow keeps pacing and recording each row even after this page closes.</p></div><div className="header-actions"><button className="button button--outline" onClick={() => void updateAction(paused ? "resume" : "pause")} disabled={actionState !== "idle" || !["queued", "running", "paused"].includes(campaignState?.state)}>{actionState !== "idle" ? <SpinnerGap className="spin" /> : paused ? <Play weight="fill" /> : <Pause weight="fill" />}{paused ? "Resume campaign" : "Pause campaign"}</button><button className="button button--outline" onClick={() => navigate("/campaigns")}>Campaign history <X /></button></div></header>{loadError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {loadError}</div>}<div className="campaign-identity"><span className="mini-mark"><Envelope weight="fill" /></span><div><h2>{campaignState?.sourceFilename || "Campaign details"}</h2><code>{sender}</code></div><StatusChip status={statusKind}>{statusLabel}</StatusChip></div><section className="panel route-summary" aria-live="polite"><div className="route-counts">{routeCounts.map(([label, count, Icon]) => <div className={`count count--${label.toLowerCase()}`} key={label}><span><Icon weight="bold" /></span><strong>{count}</strong><small>{label}</small></div>)}</div><div className="progress-meta"><span>{paused ? "Paused, accepted rows remain protected" : `${campaignState?.pacePerMinute || 12} messages/min · About ${Math.max(0, Math.ceil((total - processed) / Math.max(1, campaignState?.pacePerMinute || 12)))} minutes remaining`}</span><strong>{progress}%</strong></div><div className="progress-track" aria-label={`${progress}% processed`}><i style={{ width: `${progress}%` }} /></div></section><div className="campaign-lower"><section className="panel jobs-panel"><div className="section-heading"><div><h2>Recipient jobs</h2><p>Each spreadsheet row has one auditable outcome.</p></div><button className="button button--outline button--small" onClick={() => void exportRows()} disabled={!campaignState}><DownloadSimple /> Export results</button></div>{displayJobs.length > 0 ? <><div className="table-wrap"><table><thead><tr><th>Recipient</th><th>Row</th><th>Status</th><th>Attempts</th><th>Last update</th><th>Note</th></tr></thead><tbody>{displayJobs.slice(0, 5).map((job) => { const status = job.status; const note = job.lastErrorMessage || (status === "accepted" ? "Request accepted" : status === "pending" ? "Queued" : "Waiting for Microsoft"); return <tr key={`${job.recipient}-${job.sourceRow}`}><td><strong>{job.recipient}</strong></td><td>{job.sourceRow}</td><td><StatusChip status={status}>{status === "accepted" ? "Accepted by Microsoft" : status[0].toUpperCase() + status.slice(1)}</StatusChip></td><td>{job.attemptCount}</td><td>{formatDate(job.updatedAt)}</td><td>{note}</td></tr>; })}</tbody></table></div><footer className="table-footer"><span>Showing 1-{Math.min(5, displayJobs.length)} of {total} rows</span></footer></> : <div className="empty-state">{campaignState ? "Recipient jobs will appear as the campaign starts." : "Loading recipient jobs..."}</div>}</section><aside className="campaign-aside"><section className="panel recovery-card"><span className="route-dot"><FlowArrow /></span><h2>If something interrupts</h2><p>Resume from the first unsent row.</p><strong>Accepted recipients are never sent twice.</strong></section><section className="panel campaign-details"><div className="section-heading"><div><span className="section-kicker">CAMPAIGN DETAILS</span><h2>Useful audit information</h2></div></div><dl><div><dt>Campaign ID</dt><dd><code>{campaignId}</code><button className="button button--text button--small" onClick={() => void copyCampaignId()}>{copied ? "Copied" : "Copy"}</button></dd></div><div><dt>Source file</dt><dd>{campaignState?.sourceFilename || "Not available"}</dd></div><div><dt>Flow</dt><dd><code>{campaignState?.flowId || "Not available"}</code></dd></div><div><dt>Template version</dt><dd><code>{campaignState?.templateVersionId || "Not available"}</code></dd></div><div><dt>Started</dt><dd>{formatDate(campaignState?.startedAt)}</dd></div><div><dt>Started by</dt><dd>{user?.displayName || "USM member"}</dd></div></dl></section></aside></div></div></AppShell>;
}

export function App() {
  const protectedRoute = (element) => <RequireProductSession>{element}</RequireProductSession>;
  return <BrowserRouter><AppDataProvider><DraftProvider><Routes><Route path="/" element={<LandingPage />} /><Route path="/dashboard" element={protectedRoute(<DashboardPage />)} /><Route path="/flows" element={protectedRoute(<FlowsPage />)} /><Route path="/flows/new/data" element={protectedRoute(<DataFirstPage />)} /><Route path="/flows/new/template" element={protectedRoute(<TemplatePage />)} /><Route path="/flows/:flowId/edit/template" element={protectedRoute(<EditFlowTemplatePage />)} /><Route path="/flows/new/recipients" element={protectedRoute(<RecipientsPage />)} /><Route path="/flows/new/review" element={protectedRoute(<ReviewPage />)} /><Route path="/campaigns" element={protectedRoute(<CampaignsPage />)} /><Route path="/campaigns/:campaignId" element={protectedRoute(<CampaignPage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></DraftProvider></AppDataProvider></BrowserRouter>;
}
