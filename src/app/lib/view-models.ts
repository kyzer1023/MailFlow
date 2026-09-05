import type { CampaignCounts, CampaignRecord, FlowRecord } from "../../domain/types";
import type { SpreadsheetTable } from "../../client/types";
import type { CampaignViewModel, CampaignViewStatus, DynamicFieldOption, FlowViewModel } from "../state/types";
import { formatDate, formatTimestamp } from "./format";

export function columnOptions(table: SpreadsheetTable | null | undefined): readonly DynamicFieldOption[] {
  return table ? table.columns.map((column) => ({ value: column.key, label: column.label || column.key })) : [];
}

export function findColumn(table: SpreadsheetTable | null | undefined, words: readonly string[], fallback = ""): string {
  if (!table) return fallback;
  const match = table.columns.find((column) => {
    const haystack = `${column.key} ${column.label}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
  return match?.key || table.columns[0]?.key || fallback;
}

export function displayFlow(flow: FlowRecord): FlowViewModel {
  return {
    id: flow.id,
    name: flow.name,
    fields: ["Saved template"],
    metaLabel: `Updated ${formatDate(flow.updatedAt)}`,
    status: flow.state === "archived" ? "draft" : "ready",
  };
}

export function displayCampaign(
  campaign: Omit<CampaignRecord, "idempotencyKey"> | CampaignRecord,
  counts: CampaignCounts | null | undefined,
  flowName = "",
): CampaignViewModel {
  const status = campaign.state;
  const visibleStatuses: readonly CampaignViewStatus[] = ["completed", "paused", "running", "queued", "failed"];
  const resolvedStatus: CampaignViewStatus = visibleStatuses.includes(status as CampaignViewStatus)
    ? status as CampaignViewStatus
    : "queued";
  return {
    id: campaign.id,
    name: flowName.trim() || campaign.sourceFilename || "Campaign",
    date: formatTimestamp(campaign.createdAt),
    updated: formatTimestamp(campaign.updatedAt),
    status: resolvedStatus,
    accepted: counts?.accepted ?? 0,
    skipped: counts?.skipped ?? 0,
    deliveryVerifiedCount: campaign.deliveryVerifiedCount ?? 0,
    recipientFailed: counts?.failed ?? 0,
    unknown: counts?.unknown ?? 0,
    notSent: resolvedStatus === "failed"
      ? counts?.pending ?? 0
      : 0,
    total: campaign.totalRecipients,
  };
}
