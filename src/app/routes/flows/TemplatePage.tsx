import {
  ArrowLeft,
  ArrowRight,
  CaretDown,
  CheckCircle,
  Files,
  Info,
  Paperclip,
  Plus,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  createFlow,
  createTemplateVersion,
  getFlow,
  updateFlow,
} from "../../api";
import {
  extractPlaceholders,
  mappingToRecipientConfiguration,
  sanitizeTemplateHtml,
} from "../../../client";
import type { FlowRecord, TemplateVersionRecord } from "../../../domain/types";
import { DynamicValueChip } from "../../components/common/DynamicValueChip";
import {
  TokenMessageEditor,
  type TokenMessageEditorHandle,
} from "../../components/editor/TokenMessageEditor";
import { SubjectEditor } from "../../components/editor/SubjectEditor";
import { TemplatePicker } from "../../components/editor/TemplatePicker";
import { SaveTemplateDialog } from "../../components/editor/SaveTemplateDialog";
import { FieldResolutionPanel } from "../../components/editor/FieldResolutionPanel";
import { Modal } from "../../components/common/Modal";
import { AttachmentPicker } from "../../components/attachments/AttachmentPicker";
import { SendingOptions } from "../../components/recipients/SendingOptions";
import { AppShell } from "../../components/shell/AppShell";
import { WizardShell } from "../../components/wizard/WizardShell";
import { bodyHtmlFromDraft, dynamicFieldLabel } from "../../lib/editor-dom";
import { applyTemplate, missingMessageFields } from "../../lib/template-reuse";
import { columnOptions } from "../../lib/view-models";
import { useApi } from "../../state/api-context";
import { emptyDraft, useDraft } from "../../state/draft-context";

export function TemplatePage({
  standalone = false,
}: {
  readonly standalone?: boolean;
}) {
  const state = useDraft();
  const { draft, updateDraft, flowId, mapping, setFlowId, table, setDraft } =
    state;
  const { csrfToken, refreshDashboard, config } = useApi();
  const navigate = useNavigate();
  const { flowId: editingFlowId } = useParams();
  const editing = Boolean(editingFlowId) || standalone;
  const bodyRef = useRef<TokenMessageEditorHandle>(null);
  const subjectRef = useRef<TokenMessageEditorHandle>(null);
  const valuesRef = useRef<HTMLElement>(null);
  const targetRef = useRef<"subject" | "body">("body");
  const [dialog, setDialog] = useState<"picker" | "save" | "scratch" | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const placeholders = extractPlaceholders(
    draft.subject,
    bodyHtmlFromDraft(draft.body),
  );
  const dynamicOptions = table
    ? columnOptions(table)
    : placeholders.map((key) => ({
        value: key,
        label: dynamicFieldLabel(key),
      }));
  const missing = missingMessageFields(draft, table);
  const safeBody = sanitizeTemplateHtml(bodyHtmlFromDraft(draft.body));
  const hasContent = Boolean(
    draft.subject.trim() && safeBody.replace(/<[^>]*>/gu, "").trim(),
  );
  const canContinue =
    hasContent &&
    missing.length === 0 &&
    state.attachmentsReady &&
    Boolean(table);
  const recipientConfiguration = mappingToRecipientConfiguration({
    ...mapping,
    toField: mapping.toField || "email",
  });
  const templateSignature = (name: string) =>
    JSON.stringify([name, draft.subject, safeBody, recipientConfiguration]);
  const isTemplateSaved = savedSignature === templateSignature(draft.name);
  const save = async (name: string, update: boolean) => {
    if (saving || !hasContent) return;
    setSaving(true);
    setSaveError("");
    const payload = {
      subjectTemplate: draft.subject,
      bodyHtml: safeBody,
      placeholderManifest: placeholders,
      recipientConfiguration,
    };
    let renamed = false;
    try {
      if (update && flowId) {
        if (name !== draft.name) {
          await updateFlow(flowId, { name }, csrfToken);
          renamed = true;
        }
        await createTemplateVersion(flowId, payload, csrfToken);
      } else {
        const response = await createFlow({ name, ...payload }, csrfToken);
        setFlowId(response.flow.id);
      }
      updateDraft("name", name);
      setSavedSignature(templateSignature(name));
      setSavedNotice(
        `Saved as “${name}”. Recipients and attachment files stay with this send.`,
      );
      setDialog(null);
      void refreshDashboard();
    } catch (error) {
      setSaveError(
        `${renamed ? "The name was updated, but the message was not saved. " : ""}${error instanceof Error ? error.message : "The template could not be saved."}`,
      );
    } finally {
      setSaving(false);
    }
  };
  const useTemplate = (flow: FlowRecord, version: TemplateVersionRecord) => {
    setDraft((current) => applyTemplate(current, flow, version, table));
    setFlowId(flow.id);

    setSavedNotice("");
    setDialog(null);
  };
  const clearMessage = () => {
    const blank = emptyDraft();
    setDraft((current) => ({
      ...current,
      name: "",
      subject: "",
      body: "",
      mappings: {},
      cc: "",
      bcc: "",
      replyTo: "",
      ccColumn: "",
      bccColumn: "",
      replyToColumn: "",
      ccMode: blank.ccMode,
      bccMode: blank.bccMode,
      replyToMode: blank.replyToMode,
      importance: "normal",
    }));
    setFlowId(null);

    setSavedNotice("");
    setDialog(null);
  };
  if (!table && !editing)
    return (
      <AppShell>
        <div className="route-gate" role="status">
          <WarningCircle />
          <h1>Import your recipients first.</h1>
          <p>Then choose a saved template or write your message.</p>
          <Link className="button button--coral" to="/flows/new/data">
            Choose a recipient file
          </Link>
        </div>
      </AppShell>
    );
  const actions = (
    <>
      <button
        className="button button--outline"
        onClick={() => navigate(editing ? "/flows" : "/flows/new/data")}
      >
        <ArrowLeft />
        {editing ? "Back to templates" : "Back to recipients"}
      </button>
      <button
        className={`button button--text${isTemplateSaved ? " template-save--saved" : ""}`}
        disabled={!hasContent || state.snapshotLocked || saving}
        aria-busy={saving}
        title={
          isTemplateSaved
            ? "This version is saved. Open save options."
            : undefined
        }
        onClick={() => {
          setSaveError("");
          setDialog("save");
        }}
      >
        {saving ? (
          <SpinnerGap className="spin" />
        ) : isTemplateSaved ? (
          <CheckCircle weight="fill" />
        ) : (
          <Files />
        )}
        <span aria-live="polite">
          {saving
            ? "Saving template…"
            : isTemplateSaved
              ? "Template saved"
              : "Save as template"}
        </span>
      </button>
      {!editing && (
        <button
          className="button button--coral"
          disabled={!canContinue}
          onClick={() => navigate("/flows/new/review")}
        >
          Continue to review <ArrowRight />
        </button>
      )}
    </>
  );
  const content = (
    <>
      {savedNotice && isTemplateSaved && (
        <p className="notice template-save-notice" role="status">
          {savedNotice}
        </p>
      )}
      <div
        className={`template-layout familiar-layout${missing.length ? " field-resolution-layout" : ""}`}
      >
        <div className="message-main">
          <div className="message-options">
            {!editing && (
              <details className="panel message-disclosure">
                <summary>
                  <Paperclip /> Attachments <small>Optional</small>
                  <span>
                    {state.attachments.length
                      ? `${state.attachments.length} ${state.attachments.length === 1 ? "file" : "files"}`
                      : "Add files"}
                  </span>
                  <CaretDown className="disclosure-caret" />
                </summary>
                <div>
                  {config.attachmentsEnabled ? (
                    <AttachmentPicker />
                  ) : (
                    <div className="notice">
                      <Info />
                      <span>
                        {config.attachmentsSmtpAuthorizationRequired
                          ? "Reconnect Microsoft to authorize attachments."
                          : config.attachmentsOneDriveAuthorizationRequired
                            ? "Connect OneDrive to add attachment files."
                            : "Attachments are available when this deployment uses SMTP."}
                        {(config.attachmentsSmtpAuthorizationRequired ||
                          config.attachmentsOneDriveAuthorizationRequired) && (
                          <a
                            href={
                              config.attachmentsSmtpAuthorizationRequired
                                ? "/auth/microsoft/start?returnTo=%2Fflows%2Fnew%2Ftemplate"
                                : "/auth/microsoft/onedrive/start?returnTo=%2Fflows%2Fnew%2Ftemplate"
                            }
                          >
                            {config.attachmentsOneDriveAuthorizationRequired
                              ? "Connect OneDrive"
                              : "Reconnect Microsoft"}
                          </a>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </details>
            )}
            <details className="panel message-disclosure">
              <summary>
                Sending options <small>CC, BCC, Reply-to and importance</small>
                <CaretDown className="disclosure-caret" />
              </summary>
              <SendingOptions />
            </details>
          </div>
          <section className="panel editor-card">
            {!editing && (
              <div className="template-choice">
                <span>Start from a saved template</span>
                <div>
                  <button
                    className="template-choice-button"
                    onClick={() => setDialog("picker")}
                  >
                    {flowId ? draft.name : "Choose a saved template"}
                    <Files />
                  </button>
                  <button
                    className="button button--text"
                    onClick={() =>
                      draft.subject || draft.body
                        ? setDialog("scratch")
                        : clearMessage()
                    }
                  >
                    Write from scratch
                  </button>
                </div>
                <p>Your spreadsheet is already connected.</p>
              </div>
            )}
            <div className="field">
              <span>Subject</span>
              <SubjectEditor
                ref={subjectRef}
                missingFields={missing}
                value={draft.subject}
                options={dynamicOptions}
                onFocus={() => {
                  targetRef.current = "subject";
                }}
                onChange={(value) => {
                  updateDraft("subject", value);
                  setSavedNotice("");
                }}
              />
            </div>
            <div className="field">
              <span className="sr-only">Message body</span>
              <TokenMessageEditor
                ref={bodyRef}
                missingFields={missing}
                value={draft.body}
                onFocus={() => {
                  targetRef.current = "body";
                }}
                onChange={(value) => {
                  updateDraft("body", value);
                  setSavedNotice("");
                }}
                options={dynamicOptions}
                placeholder="Write your message here."
              />
            </div>
          </section>
        </div>
        <aside
          className="message-values"
          ref={valuesRef}
          tabIndex={-1}
          aria-label="Message values"
        >
          {table && placeholders.length > 0 && (
            <FieldResolutionPanel
              fields={placeholders}
              missingFields={missing}
              onReplace={() =>
                valuesRef.current?.focus({ preventScroll: true })
              }
            />
          )}
          {missing.length === 0 && (
            <div className="message-value-insertion">
              <h2>Add a spreadsheet value</h2>
              <p>Click in the subject or message, then insert a value.</p>
              <div className="message-token-list">
                {dynamicOptions.map((option) => (
                  <button
                    key={option.value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      (targetRef.current === "subject"
                        ? subjectRef
                        : bodyRef
                      ).current?.insertToken(option.value)
                    }
                  >
                    <Plus />
                    <DynamicValueChip
                      value={option.value}
                      options={dynamicOptions}
                    />
                  </button>
                ))}
              </div>
              {dynamicOptions.length === 0 && (
                <p>This message has no spreadsheet values yet.</p>
              )}
            </div>
          )}
          {table ? (
            <div
              className={`connected-file${missing.length ? " connected-file--compact" : ""}`}
            >
              <h2>Connected recipient file</h2>
              <strong>{draft.fileName}</strong>
              <p>
                {state.validation?.validRecipientCount || 0} ready ·{" "}
                {state.validation?.invalidRows.length || 0} to review
              </p>
              <Link to="/flows/new/data">Review recipient issues</Link>
            </div>
          ) : (
            <div className="notice">
              <Info />
              <span>
                You can edit and save this template without a recipient file.
                Values are connected when you use it for a send.
              </span>
            </div>
          )}
        </aside>
      </div>
      {dialog === "picker" && (
        <TemplatePicker onClose={() => setDialog(null)} onUse={useTemplate} />
      )}
      {dialog === "save" && (
        <SaveTemplateDialog
          currentName={draft.name}
          existing={Boolean(flowId)}
          saving={saving}
          error={saveError}
          onClose={() => setDialog(null)}
          onSave={(name, update) => void save(name, update)}
        />
      )}
      {dialog === "scratch" && (
        <Modal title="Write a new message?" onClose={() => setDialog(null)}>
          <p>
            This clears the current message and sending rules. Your recipient
            file and attachments stay connected.
          </p>
          <footer>
            <button
              className="button button--outline"
              onClick={() => setDialog(null)}
            >
              Keep message
            </button>
            <button className="button button--coral" onClick={clearMessage}>
              Write from scratch
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
  return editing ? (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <h1>
              {editingFlowId ? "Edit saved template" : "Create a template"}
            </h1>
            <p>A reusable message for your next send.</p>
          </div>
        </header>
        {content}
        <div className="template-edit-actions header-actions">{actions}</div>
      </div>
    </AppShell>
  ) : (
    <WizardShell
      current={1}
      title={
        missing.length
          ? "Connect your message values."
          : "What would you like to say?"
      }
      subtitle={
        missing.length
          ? "Choose a column or replace each missing value with text."
          : "Choose a saved template or write a new message."
      }
      actions={actions}
    >
      {content}
    </WizardShell>
  );
}

export function EditFlowTemplatePage() {
  const { flowId: routeFlowId } = useParams();
  const { hydrateSavedFlow } = useDraft();
  const [loadedId, setLoadedId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!routeFlowId) return;
    let active = true;
    setError("");
    void getFlow(routeFlowId)
      .then((response) => {
        if (!active) return;
        hydrateSavedFlow(response.flow, response.templateVersion);
        setLoadedId(routeFlowId);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "This template could not be opened.",
          );
      });
    return () => {
      active = false;
    };
  }, [routeFlowId, hydrateSavedFlow]);
  if (loadedId !== routeFlowId)
    return (
      <AppShell>
        <div className="route-gate" role={error ? "alert" : "status"}>
          {error ? <WarningCircle /> : <SpinnerGap className="spin" />}
          <h1>
            {error
              ? "This template could not be opened."
              : "Opening your template..."}
          </h1>
          {error && <p>{error}</p>}
          <Link to="/flows">Back to templates</Link>
        </div>
      </AppShell>
    );
  return <TemplatePage />;
}
