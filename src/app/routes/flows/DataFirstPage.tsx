import { SPREADSHEET_MAX_BYTES } from "../../../client/spreadsheet";
import { ArrowLeft, ArrowRight, CheckCircle, FileArrowUp, FileCsv, Rows, SpinnerGap, Users, WarningCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useState, type ChangeEvent } from "react";
import {
  extractPlaceholders,
  getHeaderRowCandidates,
  mappingsForCurrentTable,
  parseSpreadsheet,
  selectSpreadsheetTable,
} from "../../../client";
import type { ParsedSpreadsheet } from "../../../client/types";
import { bodyHtmlFromDraft, dynamicFieldLabel } from "../../lib/editor-dom";
import { columnOptions, findColumn } from "../../lib/view-models";
import { Field } from "../../components/common/Field";
import { WizardShell } from "../../components/wizard/WizardShell";
import { useDraft } from "../../state/draft-context";

export function DataFirstPage() {
  const { draft, setDraft, workbook, setWorkbook, table, setTable, validation } = useDraft();
  const navigate = useNavigate();
  const [uploadState, setUploadState] = useState<"ready" | "loading" | "error">("ready");
  const [uploadError, setUploadError] = useState("");
  const options = columnOptions(table);
  const worksheet = workbook?.worksheets.find((item) => item.name === draft.worksheet) || workbook?.worksheets[0];
  const headerCandidates = worksheet ? getHeaderRowCandidates(worksheet) : [];
  const templateFields = extractPlaceholders(draft.subject, bodyHtmlFromDraft(draft.body));
  const mappingFields = templateFields.length > 0 ? templateFields : Object.keys(draft.mappings || {});

  const rebuildTable = (sourceWorkbook: ParsedSpreadsheet | null, worksheetName: string, headerRow: number | "auto") => {
    try {
      const nextTable = selectSpreadsheetTable(sourceWorkbook as ParsedSpreadsheet, { worksheet: worksheetName, headerRow });
      const nextMappings = mappingsForCurrentTable(nextTable);
      const nextTo = draft.toField && nextTable.columns.some((column) => column.key === draft.toField) ? draft.toField : findColumn(nextTable, ["email", "mail"]);
      setTable(nextTable);
      setDraft((current) => ({ ...current, worksheet: nextTable.worksheetName, headerRow: `Row ${nextTable.headerRow}`, rowCount: nextTable.rows.length, toField: nextTo, mappings: nextMappings }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "We could not select that worksheet.");
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorkbook(null);
    setTable(null);
    setUploadState("loading");
    setUploadError("");
    try {
      if (file.size > SPREADSHEET_MAX_BYTES) throw new Error("Spreadsheet files must be 20 MiB or smaller.");
      const parsed = await parseSpreadsheet(await file.arrayBuffer(), { fileName: file.name });
      setWorkbook(parsed);
      const first = parsed.worksheets.find((item) => item.visibility === "visible") || parsed.worksheets[0];
      rebuildTable(parsed, first!.name, "auto");
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
                    {workbook!.worksheets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
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
