import "@testing-library/jest-dom/vitest";
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
}));
vi.mock("../../api", async (original) => ({
  ...(await original<typeof import("../../api")>()),
  getCampaign: async () => ({ campaign: mocks.campaign, counts: mocks.counts }),
  getCampaignJobs: async () => ({ jobs: mocks.jobs, counts: mocks.counts }),
  verifyDelivery: mocks.verify,
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
        screen.getAllByText("05 Sept 2026, 08:02:00 MYT (UTC+8)").length,
      ).toBeGreaterThan(0);
      if (state === "completed")
        expect(screen.queryByText(/minutes remaining/)).not.toBeInTheDocument();
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
