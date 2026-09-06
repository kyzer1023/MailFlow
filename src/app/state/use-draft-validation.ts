import { useMemo } from "react";
import {
  mapSpreadsheetRows,
  extractPlaceholders,
  validateClientCampaign,
} from "../../client";
import type {
  ClientMapping,
  ClientValidationSummary,
  SpreadsheetTable,
} from "../../client/types";
import type { ApiConfig, ApiUser } from "../api";
import { bodyHtmlFromDraft } from "../lib/editor-dom";
import { matchColumn } from "../lib/template-reuse";
import type { AddressRuleMode, DraftState } from "./types";

export function useDraftValidation(
  draft: DraftState,
  table: SpreadsheetTable | null,
  user: ApiUser | null,
  config: ApiConfig,
  skipInvalidRows: boolean,
) {
  const bodyHtml = useMemo(() => bodyHtmlFromDraft(draft.body), [draft.body]);
  const mapping = useMemo<ClientMapping>(() => {
    const source = (key: "cc" | "bcc" | "replyTo") => {
      const mode = draft[`${key}Mode` as keyof DraftState] as AddressRuleMode;
      const column = draft[`${key}Column` as keyof DraftState] as string;
      if (mode === "column" && column)
        return { kind: "column" as const, field: column };
      return { kind: "fixed" as const, value: draft[key] || "" };
    };
    return {
      toField: draft.toField || "",
      cc: source("cc"),
      bcc: source("bcc"),
      replyTo: source("replyTo"),
      importance: draft.importance || "normal",
      separator: "auto",
      placeholders: Object.fromEntries(
        extractPlaceholders(draft.subject, bodyHtml).map((key) => [
          key,
          Object.hasOwn(draft.mappings, key)
            ? draft.mappings[key]
            : matchColumn(key, table),
        ]),
      ),
    };
  }, [draft, bodyHtml, table]);
  const { rows: mappedRows, issues: mappingIssues } = useMemo(
    () =>
      table ? mapSpreadsheetRows(table, mapping) : { rows: [], issues: [] },
    [table, mapping],
  );
  const validation = useMemo<ClientValidationSummary | null>(
    () =>
      table
        ? validateClientCampaign({
            senderAddress: user?.mailboxAddress || user?.principalName || "",
            subjectTemplate: draft.subject,
            bodyHtml,
            rows: mappedRows,
            mappedFields: mapping.placeholders,
            separator: "auto",
            maxRecipients: config.maxCampaignRecipients,
            pacePerMinute: config.defaultPacePerMinute,
            mappingIssues,
          })
        : null,
    [table, user, draft, bodyHtml, mapping, mappedRows, mappingIssues, config],
  );
  const campaignValidation = useMemo<ClientValidationSummary | null>(() => {
    if (!validation || !skipInvalidRows || validation.ok) return validation;
    const rowOnly =
      validation.issues.length > 0 &&
      validation.issues.every((issue) => issue.row !== undefined);
    return rowOnly ? { ...validation, ok: true, issues: [] } : validation;
  }, [validation, skipInvalidRows]);
  return { bodyHtml, mapping, mappedRows, validation, campaignValidation };
}
