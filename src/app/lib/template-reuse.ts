import {
  extractPlaceholders,
  recipientConfigurationToClientMapping,
} from "../../client";
import type { SpreadsheetTable } from "../../client/types";
import type { FlowRecord, TemplateVersionRecord } from "../../domain/types";
import type { DraftState } from "../state/types";
import { bodyHtmlFromDraft } from "./editor-dom";

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");

export function matchColumn(
  key: string,
  table: SpreadsheetTable | null,
): string {
  const candidates =
    table?.columns.filter(
      (column) =>
        normalized(column.key) === normalized(key) ||
        normalized(column.label) === normalized(key),
    ) || [];
  return candidates.length === 1 ? candidates[0].key : "";
}

// A suggestion is never applied automatically. Ambiguous names stay unselected.
export function suggestColumn(
  key: string,
  table: SpreadsheetTable | null,
): string {
  const name = normalized(key);
  if (name.length < 3) return "";
  const candidates =
    table?.columns.filter((column) => {
      const label = normalized(column.label);
      return label !== name && (label.includes(name) || name.includes(label));
    }) || [];
  return candidates.length === 1 ? candidates[0].key : "";
}

export function applyTemplate(
  current: DraftState,
  flow: FlowRecord,
  version: TemplateVersionRecord,
  table: SpreadsheetTable | null,
): DraftState {
  const saved = recipientConfigurationToClientMapping(
    version.recipientConfiguration,
  );
  const result = {
    ...current,
    name: flow.name,
    subject: version.subjectTemplate,
    body: version.bodyHtml,
    importance: saved.importance || "normal",
    separator: saved.separator || "auto",
  };
  for (const key of ["cc", "bcc", "replyTo"] as const) {
    const rule = saved[key];
    const column =
      rule && typeof rule !== "string" && rule.kind === "column"
        ? rule.field
        : "";
    Object.assign(result, {
      [key]:
        rule && typeof rule !== "string" && rule.kind === "fixed"
          ? rule.value
          : "",
      [`${key}Mode`]: column ? "column" : "fixed",
      [`${key}Column`]: column ? matchColumn(column, table) || column : "",
    });
  }
  return {
    ...result,
    mappings: Object.fromEntries(
      extractPlaceholders(result.subject, result.body).map((key) => [
        key,
        matchColumn(saved.placeholders?.[key] || key, table) ||
          matchColumn(key, table),
      ]),
    ),
  };
}

export function missingMessageFields(
  draft: DraftState,
  table: SpreadsheetTable | null,
): readonly string[] {
  if (!table) return [];
  return extractPlaceholders(
    draft.subject,
    bodyHtmlFromDraft(draft.body),
  ).filter(
    (key) =>
      !table.columns.some(
        (column) =>
          column.key ===
          (Object.hasOwn(draft.mappings, key)
            ? draft.mappings[key]
            : matchColumn(key, table)),
      ),
  );
}

export function replaceMessageField(
  draft: DraftState,
  key: string,
  text: string,
): DraftState {
  const replace = (source: string, value: string) =>
    source.replace(
      /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu,
      (token, field: string) => (field === key ? value : token),
    );
  const safeText = text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
  const mappings = { ...draft.mappings };
  delete mappings[key];
  return {
    ...draft,
    subject: replace(draft.subject, text),
    body: replace(bodyHtmlFromDraft(draft.body), safeText),
    mappings,
  };
}
