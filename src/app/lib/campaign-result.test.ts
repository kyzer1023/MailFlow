import { describe, expect, it } from "vitest";
import { completedResult, campaignActivity } from "./campaign-result";

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
