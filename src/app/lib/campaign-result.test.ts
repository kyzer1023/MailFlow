import { describe, expect, it } from "vitest";
import { completedResult, campaignActivity } from "./campaign-result";
import { finishedWithoutCancelledRows, ineffectiveCancellationNote } from "./campaign-result";
import { displayCampaign } from "./view-models";
import { emptyCampaignCounts, type CampaignRecord } from "../../domain/types";

describe("cancellation after the final submission", () => {
  const campaign = { state: "cancelled", totalRecipients: 5 } as CampaignRecord;
  const counts = { ...emptyCampaignCounts(), accepted: 5 };
  it("presents a fully settled campaign as completed while preserving raw evidence", () => {
    expect(finishedWithoutCancelledRows(campaign, counts)).toBe(true);
    expect(displayCampaign(campaign, counts)).toMatchObject({ status: "completed", cancellationNote: ineffectiveCancellationNote });
    expect(campaign.state).toBe("cancelled");
    expect(counts.accepted).toBe(5);
  });
  it("retains failure and unknown warnings when no rows were stopped", () => {
    const mixed = { ...counts, accepted: 3, failed: 1, unknown: 1 };
    const result = displayCampaign(campaign, mixed);
    expect(result.status).toBe("completed");
    expect(completedResult(result.unknown, result.recipientFailed, result.skipped ?? 0).label).toBe("Finished, receipt unverified");
  });
  it("requires complete settled counts and never masks prevented submissions", () => {
    for (const unsafe of [undefined, { ...counts, accepted: 4 }, { ...counts, accepted: 4, pending: 1 }, { ...counts, accepted: 4, sending: 1 }, { ...counts, accepted: 4, claimed: 1 }]) {
      expect(finishedWithoutCancelledRows(campaign, unsafe)).toBe(false);
    }
    expect(finishedWithoutCancelledRows({ ...campaign, state: "cancelling" }, counts)).toBe(false);
    expect(finishedWithoutCancelledRows({ ...campaign, totalRecipients: 0 }, emptyCampaignCounts())).toBe(false);
  });
});

describe("completed campaign presentation", () => {
  it("shows unresolved receipt for historical completed campaigns", () => {
    expect(completedResult(1, 0, 0)).toEqual({ label: "Finished, receipt unverified", tone: "unknown" });
  });
  it("retains failures after every unknown receipt is verified", () => {
    expect(completedResult(1, 1, 0, 1).label).toBe("Finished with recipient failures");
  });
  it("distinguishes owner verification, skipped rows and processing completion", () => {
    expect(completedResult(1, 0, 0, 1).label).toBe("Finished, receipt verified");
    expect(completedResult(0, 0, 1).label).toBe("Finished with skipped rows");
    expect(completedResult(0, 0, 0).label).toBe("Completed");
  });
});


describe("shared campaign activity labels", () => {
  it("keeps queued followers distinct from member-paused campaigns", () => {
    expect(campaignActivity({ state: "queued", schedulerMessage: "Legacy waiting text" }).label).toBe("Queued");
    expect(campaignActivity({ state: "paused" })).toMatchObject({ label: "Paused", detail: expect.stringContaining("back of the queue") });
  });
  it("calls normal pacing Sending and exceptional waits Waiting with their reason", () => {
    expect(campaignActivity({ state: "running" }).label).toBe("Sending");
    expect(campaignActivity({ state: "running", schedulerMessage: "Mailbox pacing is active." }).label).toBe("Sending");
    expect(campaignActivity({ state: "running", schedulerMessage: "The daily mailbox allowance is temporarily full." }))
      .toMatchObject({ label: "Waiting", detail: expect.stringContaining("daily mailbox allowance") });
    expect(campaignActivity({ state: "cancelling" }).label).toBe("Cancelling");
    expect(campaignActivity({ state: "cancelled" }).label).toBe("Cancelled");
  });
});
