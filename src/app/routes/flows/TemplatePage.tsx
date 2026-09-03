import { ArrowLeft, ArrowRight, Files, Info, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  createFlow as createFlowRequest,
  createTemplateVersion as createTemplateVersionRequest,
  getFlow,
  updateFlow as updateFlowRequest,
} from "../../api";
import { extractPlaceholders, mappingToRecipientConfiguration, sanitizeTemplateHtml } from "../../../client";
import { DynamicValueChip } from "../../components/common/DynamicValueChip";
import { Field } from "../../components/common/Field";
import { TokenMessageEditor, type TokenMessageEditorHandle } from "../../components/editor/TokenMessageEditor";
import { AppShell } from "../../components/shell/AppShell";
import { WizardShell } from "../../components/wizard/WizardShell";
import { bodyHtmlFromDraft, dynamicFieldLabel } from "../../lib/editor-dom";
import { columnOptions } from "../../lib/view-models";
import { useApi } from "../../state/api-context";
import { useDraft } from "../../state/draft-context";
import type { DraftState } from "../../state/types";

type SaveState = "idle" | "saving" | "saved" | "error";

export function TemplatePage() {
  const { draft, updateDraft, flowId, mapping, setFlowId, setTemplateVersionId, table } = useDraft();
  const { csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const { flowId: editingFlowId } = useParams();
  const bodyRef = useRef<TokenMessageEditorHandle | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [nameError, setNameError] = useState("");
  const dynamicOptions = columnOptions(table);
  const dynamicFields = dynamicOptions.map((option) => option.value);
  const editingExisting = Boolean(editingFlowId) && !table;
  const sanitizedDraftBody = useMemo(() => sanitizeTemplateHtml(bodyHtmlFromDraft(draft.body)), [draft.body]);
  const canSave = Boolean(draft.name.trim() && draft.subject.trim() && sanitizedDraftBody.trim() && mapping.toField);

  const editDraft = (key: keyof DraftState, value: DraftState[keyof DraftState]) => {
    updateDraft(key, value);
    setSaveState("idle");
    setSaveError("");
    if (key === "name") setNameError("");
  };

  const insertDynamicField = (key: string) => {
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

export function EditFlowTemplatePage() {
  const { flowId: routeFlowId } = useParams();
  const { flowId, hydrateSavedFlow } = useDraft();
  const [loadState, setLoadState] = useState<{ readonly status: "idle" | "loading" | "ready" | "error"; readonly error: string }>({ status: "idle", error: "" });

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
