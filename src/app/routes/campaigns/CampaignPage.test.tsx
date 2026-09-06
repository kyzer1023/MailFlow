import "@testing-library/jest-dom/vitest";
import { formatTimestamp } from "../../lib/format";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  CampaignCounts,
  CampaignRecord,
  RecipientJobRecord,
} from "../../../domain/types";
import { CampaignPage } from "./CampaignPage";

const mocks = vi.hoisted(() => ({
  campaign: {} as CampaignRecord,
  jobs: [] as RecipientJobRecord[],
  counts: {} as CampaignCounts,
  verify: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../../api", async (original) => ({
  ...(await original<typeof import("../../api")>()),
  getCampaign: async () => ({ campaign: mocks.campaign, counts: mocks.counts }),
  getCampaignJobs: async () => ({ jobs: mocks.jobs, counts: mocks.counts }),
  verifyDelivery: mocks.verify,
  cancelCampaign: mocks.cancel,
}));
vi.mock("../../state/api-context", () => ({
  useApi: () => ({
    csrfToken: "synthetic",
    user: { displayName: "Member" },
    refreshDashboard: async () => {},
  }),
}));
vi.mock("../../components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
beforeEach(() => {
  mocks.campaign = {
    id: "synthetic",
    state: "completed",
    totalRecipients: 3,
    pacePerMinute: 12,
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:02:00.000Z",
  } as CampaignRecord;
  mocks.counts = {
    pending: 0,
    claimed: 0,
    sending: 0,
    accepted: 1,
    failed: 1,
    skipped: 0,
    unknown: 1,
  };
  mocks.jobs = ["accepted", "failed", "unknown"].map((status, index) => ({
    id: `job-${index}`,
    campaignId: "synthetic",
    sourceRow: index + 2,
    recipient: `member-${index}@example.test`,
    status,
    attemptCount: 1,
    updatedAt: "2026-09-05T00:02:00.000Z",
  })) as RecipientJobRecord[];
  mocks.verify.mockReset();
  mocks.cancel.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
function mount() {
  render(
    <MemoryRouter initialEntries={["/campaigns/synthetic"]}>
      <Routes>
        <Route path="/campaigns/:campaignId" element={<CampaignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("campaign outcome reporting", () => {
  it("offers same-account Microsoft recovery without treating pending rows as failed", async () => {
    mocks.campaign.state = "paused";
    mocks.campaign.mailIssueCode = "mail_authorization_required";
    mocks.counts = { ...mocks.counts, pending: 1, failed: 0 };
    mount();
    const reconnect = await screen.findByRole("link", { name: "Reconnect Microsoft" });
    expect(reconnect).toHaveAttribute("href", "/auth/microsoft/start?returnTo=%2Fcampaigns%2Fsynthetic");
    expect(screen.getByText(/Reconnect the same Microsoft account/)).toHaveTextContent("Accepted and unknown rows will not be sent again");
    expect(screen.getByRole("button", { name: "Resume pending rows" })).toBeEnabled();
    expect(screen.queryByText("Campaign-level failure")).not.toBeInTheDocument();
  });
  it.each(["running", "completed"] as const)(
    "keeps Unknown separate from Failed when %s",
    async (state) => {
      mocks.campaign.state = state;
      mount();
      await screen.findByText("member-2@example.test");
      const failed = screen.getByText("Recipient failed").closest(".count")!;
      expect(failed).toHaveTextContent("1");
      expect(
        screen
          .getByText("Unknown", { selector: ".count small" })
          .closest(".count"),
      ).toHaveTextContent("1");
      expect(screen.getByText(/3 of 3 rows processed/)).toBeInTheDocument();
      expect(
        screen.getByText(/Check receipt before considering any resend/),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(formatTimestamp("2026-09-05T00:02:00.000Z")).length,
      ).toBeGreaterThan(0);
      if (state === "completed") {
        expect(screen.getByText("Finished, receipt unverified")).toBeInTheDocument();
        expect(screen.queryByText("Completed")).not.toBeInTheDocument();
        expect(screen.getByText(/Processing finished: 1 accepted by Microsoft, 1 failed, 1 unknown, 0 skipped/)).toBeInTheDocument();
        expect(screen.queryByText(/minutes remaining/)).not.toBeInTheDocument();
      }
    },
  );
  it("requires explicit receipt confirmation and shows a separate saved result", async () => {
    mocks.verify.mockImplementation(async () => {
      mocks.jobs = mocks.jobs.map((j) =>
        j.status === "unknown"
          ? {
              ...j,
              deliveryVerifiedAt: "2026-09-05T01:00:00.000Z",
              deliveryVerificationNote: "Receipt checked",
              deliveryVerifiedBy: "owner",
            }
          : j,
      );
      return { job: mocks.jobs[2] };
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark delivery verified" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Confirm delivery verified" }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Receipt checked" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm delivery verified" }),
    );
    await waitFor(() =>
      expect(mocks.verify).toHaveBeenCalledWith(
        "synthetic",
        "job-2",
        "Receipt checked",
        "synthetic",
      ),
    );
    expect(
      await screen.findByText("Delivery verified by you"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Member-reported receipt. Provider outcome remains Unknown.",
      ),
    ).toBeInTheDocument();
    expect(mocks.jobs[2]).toMatchObject({
      status: "unknown",
      attemptCount: 1,
      updatedAt: "2026-09-05T00:02:00.000Z",
    });
  });
  it("retains an actionable error after a failed verification request", async () => {
    mocks.verify.mockRejectedValue(new Error("private backend detail"));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark delivery verified" }),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm delivery verified" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "confirmation could not be saved",
    );
    expect(
      screen.queryByText(/private backend detail/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm delivery verified" }),
    ).toBeEnabled();
  });
});


describe("campaign cancellation and activity clarity", () => {
  it("shows Completed when cancellation stopped no rows and retains its audit timestamp", async () => {
    mocks.campaign.state = "cancelled";
    mocks.campaign.cancelRequestedAt = "2026-09-05T00:01:58.000Z";
    mocks.counts = { pending: 0, claimed: 0, sending: 0, accepted: 3, failed: 0, skipped: 0, unknown: 0 };
    mocks.jobs.forEach(job => { job.status = "accepted"; });
    mount();
    expect(await screen.findByText("Completed", { selector: ".status" })).toBeInTheDocument();
    expect(screen.getByText(/All 3 emails were submitted successfully to Microsoft/)).toBeInTheDocument();
    expect(screen.getByText("Cancellation was requested, but no rows were stopped.")).toBeInTheDocument();
    expect(screen.getByText("Cancellation requested")).toBeInTheDocument();
    expect(screen.queryByText("This campaign was cancelled.")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 rows will not be sent/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume|Pause campaign|Cancel campaign/ })).not.toBeInTheDocument();
    expect(mocks.campaign.state).toBe("cancelled");
  });

  it("confirms permanent cancellation and keeps an in-flight outcome visible", async () => {
    mocks.campaign.state = "running";
    mocks.campaign.completedAt = null;
    mocks.counts = { pending: 1, claimed: 0, sending: 1, accepted: 1, failed: 0, skipped: 0, unknown: 0 };
    mocks.jobs[1].status = "pending";
    mocks.jobs[2].status = "sending";
    mocks.cancel.mockImplementation(async () => {
      mocks.campaign = { ...mocks.campaign, state: "cancelling", cancelRequestedAt: "2026-09-05T00:01:00.000Z" };
      return { campaign: mocks.campaign };
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel campaign" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm cancellation" });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/cannot withdraw submitted mail/)).toBeInTheDocument();
    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("synthetic", "synthetic"));
    expect(await screen.findByText("Cancelling", { selector: ".status" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume|Pause campaign|Cancel campaign/ })).not.toBeInTheDocument();
    expect(screen.getByText("Sending", { selector: ".count small" }).closest(".count")).toHaveTextContent("1");
    expect(screen.getByText("Not sent because this campaign was cancelled")).toBeInTheDocument();
    expect(screen.getByText("Accepted by Microsoft")).toBeInTheDocument();
    expect(document.querySelector(".campaign-identity")).toHaveFocus();
  });

  it("can dismiss cancellation without a request and retains a retryable error", async () => {
    mocks.campaign.state = "paused";
    mount();
    const open = await screen.findByRole("button", { name: "Cancel campaign" });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Keep campaign" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.cancel.mockRejectedValue(new Error("The campaign could not be updated."));
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("could not be updated");
    expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
  });

  it("clearly completes an all-accepted run without claiming delivery", async () => {
    mocks.counts = { pending: 0, claimed: 0, sending: 0, accepted: 3, failed: 0, skipped: 0, unknown: 0 };
    mocks.jobs.forEach(job => { job.status = "accepted"; });
    mount();
    expect(await screen.findByText("Completed", { selector: ".status" })).toBeInTheDocument();
    expect(screen.getByText(/All 3 emails were submitted successfully to Microsoft/)).toBeInTheDocument();
    expect(screen.getAllByText("Accepted by Microsoft")).toHaveLength(3);
    expect(screen.getByText(/does not confirm inbox delivery/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel campaign" })).not.toBeInTheDocument();
  });

  it("converts legacy recipient waiting notes into the member's local timezone", async () => {
    mocks.campaign.state = "running";
    mocks.jobs[1].status = "pending";
    mocks.jobs[1].lastErrorMessage = "Sending will continue after 5 Sep 2026, 1:28 AM (Malaysia time, GMT+8).";
    mount();
    expect(await screen.findByText(`Sending will continue after ${formatTimestamp("2026-09-04T17:28:00.000Z")}.`)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Malaysia time");
  });
});
