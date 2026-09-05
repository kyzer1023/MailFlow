import {
  ArrowRight,
  CheckCircle,
  FileArrowUp,
  FileCsv,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState, type ChangeEvent } from "react";
import {
  getHeaderRowCandidates,
  mapSpreadsheetRows,
  parseSpreadsheet,
  selectSpreadsheetTable,
} from "../../../client";
import { validateMappedRecipientRows } from "../../../client/validation";
import { SPREADSHEET_MAX_BYTES } from "../../../client/spreadsheet";
import type { ParsedSpreadsheet } from "../../../client/types";
import { columnOptions, findColumn } from "../../lib/view-models";
import { matchColumn } from "../../lib/template-reuse";
import { Field } from "../../components/common/Field";
import { WizardShell } from "../../components/wizard/WizardShell";
import { useDraft } from "../../state/draft-context";

export function DataFirstPage() {
  const { draft, setDraft, workbook, setWorkbook, table, setTable } =
    useDraft();
  const navigate = useNavigate();
  const [uploadState, setUploadState] = useState<"ready" | "loading" | "error">(
    "ready",
  );
  const [uploadError, setUploadError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [page, setPage] = useState(0);
  const options = columnOptions(table);
  const worksheet =
    workbook?.worksheets.find((item) => item.name === draft.worksheet) ||
    workbook?.worksheets[0];
  const headerCandidates = worksheet ? getHeaderRowCandidates(worksheet) : [];
  const check = useMemo(
    () =>
      table
        ? validateMappedRecipientRows(
            mapSpreadsheetRows(table, {
              toField: draft.toField,
              placeholders: {},
              separator: "auto",
            }).rows,
            "auto",
          )
        : null,
    [table, draft.toField],
  );

  const rebuildTable = (
    source: ParsedSpreadsheet | null,
    worksheetName: string,
    headerRow: number | "auto",
  ) => {
    if (!source) return;
    try {
      const nextTable = selectSpreadsheetTable(source, {
        worksheet: worksheetName,
        headerRow,
      });
      setTable(nextTable);
      setDraft((current) => ({
        ...current,
        worksheet: nextTable.worksheetName,
        headerRow: `Row ${nextTable.headerRow}`,
        rowCount: nextTable.rows.length,
        toField:
          matchColumn(current.toField, nextTable) ||
          findColumn(nextTable, ["email", "mail"]),
        mappings: Object.fromEntries(
          Object.entries(current.mappings).map(([key, value]) => [
            key,
            matchColumn(value || key, nextTable) || matchColumn(key, nextTable),
          ]),
        ),
      }));
      setPage(0);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "We could not select that worksheet.",
      );
    }
  };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadState("loading");
    setUploadError("");
    try {
      if (file.size > SPREADSHEET_MAX_BYTES)
        throw new Error("Spreadsheet files must be 20 MiB or smaller.");
      const parsed = await parseSpreadsheet(await file.arrayBuffer(), {
        fileName: file.name,
      });
      const first =
        parsed.worksheets.find((item) => item.visibility === "visible") ||
        parsed.worksheets[0];
      if (!first) throw new Error("This file has no worksheets.");
      setWorkbook(parsed);
      rebuildTable(parsed, first.name, "auto");
      setDraft((value) => ({
        ...value,
        fileName: file.name,
        fileSize: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      }));
      setShowIssues(false);
      setUploadState("ready");
    } catch (error) {
      setUploadState("error");
      setUploadError(
        error instanceof Error ? error.message : "We could not read that file.",
      );
    }
  };
  const filteredRows =
    table?.rows.filter(
      (row) => !showIssues || check?.invalidRows.includes(row.sourceRow),
    ) || [];
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredRows.length / 5) - 1),
  );
  const previewRows = filteredRows.slice(safePage * 5, safePage * 5 + 5);
  const attention = check?.invalidRows.length || 0;
  return (
    <WizardShell
      current={0}
      title="Who are you writing to?"
      subtitle="Upload a spreadsheet. Each row becomes a separate email."
      actions={
        <button
          className="button button--coral"
          onClick={() => navigate("/flows/new/template")}
          disabled={!table || !draft.toField || uploadState === "loading"}
        >
          Continue to message <ArrowRight />
        </button>
      }
    >
      <div className="data-layout familiar-layout">
        <section className="panel recipient-import">
          <div className="upload-card">
            <span className="upload-icon">
              <FileCsv weight="duotone" />
            </span>
            <div>
              <h2>{draft.fileName || "Upload CSV or Excel"}</h2>
              <p>
                {table
                  ? `${table.rows.length} rows imported`
                  : "Choose a .csv or .xlsx file, up to 20 MiB."}
              </p>
            </div>
            <label className="button button--text file-button">
              {uploadState === "loading" ? (
                <SpinnerGap className="spin" />
              ) : null}
              {table ? "Replace file" : "Choose file"}
              <input
                aria-label="Recipient spreadsheet"
                type="file"
                accept=".csv,.xlsx"
                disabled={uploadState === "loading"}
                onChange={onFile}
              />
            </label>
          </div>
          {uploadError && (
            <p className="notice notice--danger" role="alert">
              <WarningCircle />
              {uploadError}
              {table && " Your previous file is still connected."}
            </p>
          )}
          {table ? (
            <>
              <div className="import-settings">
                <Field label="Email addresses are in">
                  <select
                    value={draft.toField}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        toField: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose a column</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <details className="sheet-options">
                  <summary>Worksheet and header row</summary>
                  <div className="sheet-controls">
                    <Field label="Worksheet">
                      <select
                        value={draft.worksheet}
                        onChange={(event) =>
                          rebuildTable(workbook, event.target.value, "auto")
                        }
                      >
                        {workbook?.worksheets.map((item) => (
                          <option key={item.name}>{item.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Header row">
                      <select
                        value={draft.headerRow}
                        onChange={(event) =>
                          rebuildTable(
                            workbook,
                            draft.worksheet,
                            Number(event.target.value.replace(/\D/gu, "")),
                          )
                        }
                      >
                        {headerCandidates.map((row) => (
                          <option key={row}>Row {row}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </details>
              </div>
              {showIssues && (
                <div className="issue-filter">
                  <strong>Rows needing attention</strong>
                  <button
                    className="button button--text"
                    onClick={() => {
                      setShowIssues(false);
                      setPage(0);
                    }}
                  >
                    Show all rows
                  </button>
                </div>
              )}
              <div className="preview-table table-wrap">
                <table>
                  <thead>
                    <tr>
                      {showIssues && <th>Row</th>}
                      {table.columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      {showIssues && <th>What to fix</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr
                        key={row.sourceRow}
                        className={
                          check?.invalidRows.includes(row.sourceRow)
                            ? "row-error"
                            : ""
                        }
                      >
                        {showIssues && <td>{row.sourceRow}</td>}
                        {table.columns.map((column) => (
                          <td key={column.key}>
                            {row.values[column.key] ||
                              (column.key === draft.toField ? (
                                <span className="error-text">
                                  Missing email
                                </span>
                              ) : (
                                ""
                              ))}
                          </td>
                        ))}
                        {showIssues && (
                          <td>
                            {check?.issues
                              .filter((issue) => issue.row === row.sourceRow)
                              .map((issue) => issue.message)
                              .join(" ")}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-table-footer">
                <span>
                  Showing {previewRows.length} of {filteredRows.length} rows
                </span>
                <div>
                  <button
                    aria-label="Previous recipient rows"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </button>
                  <button
                    aria-label="Next recipient rows"
                    disabled={(safePage + 1) * 5 >= filteredRows.length}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="upload-empty">
              <FileArrowUp size={40} />
              <h3>Start with your recipient list</h3>
              <p>
                Include a column of email addresses and any details you want to
                use in your message, such as a name or session.
              </p>
              <span>
                <CheckCircle weight="fill" /> Your spreadsheet is read in this
                browser.
              </span>
            </div>
          )}
        </section>
        <aside className="recipient-check">
          <h2>Your recipient check</h2>
          {table ? (
            <>
              <div className="recipient-stat">
                <CheckCircle weight="fill" />
                <div>
                  <strong>{check?.validRows.length || 0}</strong>
                  <span>Ready to receive</span>
                </div>
              </div>
              <div className="recipient-stat recipient-stat--warn">
                <WarningCircle weight="fill" />
                <div>
                  <strong>{attention}</strong>
                  <span>Need attention</span>
                </div>
              </div>
              {attention > 0 && (
                <div className="notice notice--warn">
                  <WarningCircle weight="fill" />
                  <div>
                    <strong>{attention} rows need an email check</strong>
                    <button
                      className="button button--text"
                      onClick={() => {
                        setShowIssues(true);
                        setPage(0);
                      }}
                    >
                      Review {attention} rows <ArrowRight />
                    </button>
                  </div>
                </div>
              )}
              <p>
                You can write your message now.
                <br />
                Fix or skip flagged rows before sending.
              </p>
              <details>
                <summary>Columns found in your file</summary>
                <div className="detected-field-list">
                  {options.map((option) => (
                    <span className="detected-field-name" key={option.value}>
                      {option.label}
                    </span>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <p>
              After you choose a file, we will check email addresses and
              highlight missing, invalid, or duplicate recipients.
            </p>
          )}
        </aside>
      </div>
    </WizardShell>
  );
}
