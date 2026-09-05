import { useEffect, useState } from "react";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { getFlow, getFlows, type FlowResponse } from "../../api";
import type { FlowRecord, TemplateVersionRecord } from "../../../domain/types";
import { buildPreviewSrcDoc, extractPlaceholders } from "../../../client";
import { dynamicFieldLabel } from "../../lib/editor-dom";
import { Modal } from "../common/Modal";
import { useDraft } from "../../state/draft-context";
import { applyTemplate, suggestColumn } from "../../lib/template-reuse";

export function TemplatePicker({
  onClose,
  onUse,
}: {
  readonly onClose: () => void;
  readonly onUse: (flow: FlowRecord, version: TemplateVersionRecord) => void;
}) {
  const { draft, table } = useDraft();
  const [flows, setFlows] = useState<readonly FlowRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<FlowResponse | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void getFlows()
      .then((response) => {
        if (active)
          setFlows(
            response.flows.filter(
              (flow) =>
                flow.state === "active" && flow.currentTemplateVersionId,
            ),
          );
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Templates could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setSelected(null);
    setError("");
    void getFlow(selectedId)
      .then((response) => {
        if (active) setSelected(response);
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
  }, [selectedId, retry]);
  const version = selected?.templateVersion;
  const fields = version
    ? extractPlaceholders(version.subjectTemplate, version.bodyHtml)
    : [];
  const previewDraft =
    selected && version
      ? applyTemplate(draft, selected.flow, version, table)
      : null;
  const compatibility = fields.map((key) => {
    const connected = previewDraft?.mappings[key];
    const suggestion = connected ? "" : suggestColumn(key, table);
    const column = table?.columns.find(
      (item) => item.key === (connected || suggestion),
    );
    return { key, connected, suggestion, label: column?.label };
  });
  return (
    <Modal title="Choose a saved template" wide onClose={onClose}>
      <p className="dialog-intro">
        Preview a message before using it. Your recipient file stays connected.
      </p>
      {error && (
        <div role="alert" className="notice notice--danger">
          <WarningCircle />
          {error}
          <button onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </div>
      )}
      <div className="template-picker-layout">
        <section>
          <input
            aria-label="Search saved templates"
            placeholder="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="template-picker-list">
            {!flows && !error ? (
              <p role="status">
                <SpinnerGap className="spin" /> Loading templates...
              </p>
            ) : (
              flows
                ?.filter((flow) =>
                  flow.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((flow) => (
                  <button
                    key={flow.id}
                    className={selectedId === flow.id ? "selected" : ""}
                    onClick={() => setSelectedId(flow.id)}
                    aria-pressed={selectedId === flow.id}
                  >
                    <strong>{flow.name}</strong>
                    <small>
                      Updated {new Date(flow.updatedAt).toLocaleDateString()}
                    </small>
                  </button>
                ))
            )}
            {flows?.length === 0 && (
              <p>
                No saved templates yet. Write your message, then choose Save as
                template.
              </p>
            )}
            {flows &&
              flows.length > 0 &&
              !flows.some((flow) =>
                flow.name.toLowerCase().includes(query.toLowerCase()),
              ) && <p>No templates match your search.</p>}
          </div>
        </section>
        <section className="template-picker-preview">
          {version ? (
            <>
              <span className="section-kicker">MESSAGE PREVIEW</span>
              <h3>
                {version.subjectTemplate.replace(
                  /\{\{\s*([^}]+)\s*\}\}/gu,
                  (_, key: string) => dynamicFieldLabel(key.trim()),
                )}
              </h3>
              <iframe
                title="Saved template preview"
                sandbox=""
                srcDoc={buildPreviewSrcDoc(
                  version.bodyHtml.replace(
                    /\{\{\s*([^}]+)\s*\}\}/gu,
                    (_, key: string) => dynamicFieldLabel(key.trim()),
                  ),
                )}
              />
              <div className="template-fields">
                <strong>Values in your recipient file</strong>
                {fields.length ? (
                  <dl className="template-compatibility">
                    {compatibility.map((field) => (
                      <div key={field.key}>
                        <dt>{dynamicFieldLabel(field.key)}</dt>
                        <dd
                          className={
                            field.connected ? "field-match" : "field-missing"
                          }
                        >
                          {field.connected
                            ? `Connected to ${field.label}`
                            : field.suggestion
                              ? `Suggested: ${field.label}`
                              : "Not in this file"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>No spreadsheet values needed.</p>
                )}
              </div>
              {compatibility.some((field) => !field.connected) && (
                <p>
                  You can connect or replace missing values after choosing this
                  template.
                </p>
              )}
              <p>
                Sending rules, including fixed CC, BCC, and Reply-to addresses,
                are also copied. Review them before sending.
              </p>
            </>
          ) : (
            <div className="empty-state">
              {selectedId && !error
                ? "Opening preview..."
                : "Select a template to preview its message."}
            </div>
          )}
        </section>
      </div>
      <footer>
        <button className="button button--outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button--coral"
          disabled={!version}
          onClick={() => {
            if (selected && version) onUse(selected.flow, version);
          }}
        >
          Use this template
        </button>
      </footer>
    </Modal>
  );
}
