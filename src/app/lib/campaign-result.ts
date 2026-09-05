import type { CampaignCounts, CampaignRecord } from "../../domain/types";
import { formatSchedulerNotice } from "./format";

export const ineffectiveCancellationNote = "Cancellation was requested, but no rows were stopped.";

/** Derive the visible outcome without rewriting the cancellation audit/state. */
export function finishedWithoutCancelledRows(
  campaign: Pick<CampaignRecord, "state" | "totalRecipients">,
  counts: CampaignCounts | null | undefined,
): boolean {
  if (!counts || campaign.state !== "cancelled" || campaign.totalRecipients <= 0) return false;
  return counts.pending === 0 && counts.claimed === 0 && counts.sending === 0
    && counts.accepted + counts.failed + counts.unknown + counts.skipped === campaign.totalRecipients;
}

// Presentation only: completed is the scheduler's terminal processing state.
export function completedResult(unknown: number, failed: number, skipped: number, verified = 0) {
  if (unknown > verified) return { label: "Finished, receipt unverified", tone: "unknown" };
  if (failed > 0) return { label: "Finished with recipient failures", tone: "failed" };
  if (unknown > 0) return { label: "Finished, receipt verified", tone: "completed" };
  if (skipped > 0) return { label: "Finished with skipped rows", tone: "paused" };
  return { label: "Completed", tone: "completed" };
}

/** One activity presentation for history and the campaign monitor. */
export function campaignActivity(campaign: Pick<CampaignRecord, "state" | "schedulerMessage" | "schedulerNextAttemptAt">) {
  if (campaign.state === "queued") return { label: "Queued", tone: "queued", detail: "Waiting for its turn in this mailbox." };
  if (campaign.state === "paused") return { label: "Paused", tone: "paused", detail: "Resume adds this campaign to the back of the queue." };
  if (campaign.state === "cancelled") return { label: "Cancelled", tone: "cancelled", detail: "Remaining rows will not be sent. Submitted mail cannot be withdrawn." };
  if (campaign.state === "cancelling") return { label: "Cancelling", tone: "cancelling", detail: "Stopping future submissions. Waiting for the current attempt to settle." };
  if (campaign.state === "failed") return { label: "Campaign failed", tone: "failed", detail: "No further rows will be sent." };
  if (campaign.state === "running") {
    const message = campaign.schedulerMessage;
    if (message && !message.startsWith("Mailbox pacing is active.")) {
      return { label: "Waiting", tone: "waiting", detail: formatSchedulerNotice(message,
        message === "Waiting for the current mailbox submission to finish." ? null : campaign.schedulerNextAttemptAt) };
    }
    return { label: "Sending", tone: "running", detail: "Sending at this mailbox's configured pace." };
  }
  return { label: campaign.state === "completed" ? "Completed" : campaign.state === "validated" ? "Validated" : "Draft", tone: campaign.state, detail: "" };
}
