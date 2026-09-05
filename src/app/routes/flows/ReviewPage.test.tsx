import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCampaignCounts } from "../../../domain/types";
import type { CampaignResponse } from "../../api";
import { logout, sendCampaignTest, startCampaign } from "../../api";
import { ApiContext } from "../../state/api-context";
import { DraftContext, emptyDraft } from "../../state/draft-context";
import type { ApiContextValue, DraftContextValue } from "../../state/types";
import { ReviewPage } from "./ReviewPage";

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    logout: vi.fn(),
    sendCampaignTest: vi.fn(),
    startCampaign: vi.fn(),
  };
});

const mockedLogout = vi.mocked(logout);
const mockedSendCampaignTest = vi.mocked(sendCampaignTest);
const mockedStartCampaign = vi.mocked(startCampaign);

const campaignResponse: CampaignResponse = {
  campaign: {
    id: "campaign-review",
    flowId: "flow-review",
    templateVersionId: "template-review",
    ownerUserId: "user-review",
    senderAddress: "amina@student.example",
    sourceFilename: "members.csv",
    totalRecipients: 1,
    validRecipients: 1,
    skippedRecipients: 0,
    pacePerMinute: 12,
    state: "validated",
    pauseReason: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-09-04T00:00:00.000Z",
  },
  counts: { ...emptyCampaignCounts(), pending: 1 },
};

const validation = {
  ok: true,
  issues: [],
  validRows: [{
    sourceRow: 2,
    to: "member@example.test",
    cc: [],
    bcc: [],
    replyTo: [],
    mergeData: { name: "Member" },
  }],
  invalidRows: [],
  duplicateRecipients: [],
  placeholders: [],
  sanitizedBodyHtml: "<p>Hello Member</p>",
  campaignLimit: 300,
  totalRows: 1,
  validRecipientCount: 1,
  skippedRecipientCount: 0,
  estimatedDurationSeconds: 5,
} as const;

function draftValue(): DraftContextValue {
  return {
    testRequest: { current: null },
    preparation: { current: null },
    snapshotLocked: false,
    lockSnapshot: vi.fn(),
    restartFromMessage: vi.fn(),
    draft: {
      ...emptyDraft(),
      name: "Review flow",
      subject: "Hello",
      body: "<p>Hello Member</p>",
      fileName: "members.csv",
      fileSize: "1 KB",
      rowCount: 1,
      worksheet: "members.csv",
      toField: "email",
      mappings: { name: "name" },
    },
    setDraft: vi.fn(),
    updateDraft: vi.fn(),
    workbook: null,
    setWorkbook: vi.fn(),
    table: {
      format: "csv",
      fileName: "members.csv",
      worksheetIndex: 0,
      worksheetName: "members.csv",
      headerRow: 1,
      columns: [
        { key: "email", label: "Email", sourceColumn: 1 },
        { key: "name", label: "Name", sourceColumn: 2 },
      ],
      rows: [{ sourceRow: 2, values: { email: "member@example.test", name: "Member" }, rawValues: ["member@example.test", "Member"] }],
    },
    setTable: vi.fn(),
    flowId: "flow-review",
    setFlowId: vi.fn(),
    campaignResponse,
    setCampaignResponse: vi.fn(),
    campaignRequestKey: "campaign-request",
    testSendRequestKey: "test-request",
    bodyHtml: "<p>Hello Member</p>",
    mapping: { toField: "email", placeholders: { name: "name" } },
    mappedRows: [{ sourceRow: 2, to: "member@example.test", cc: "", bcc: "", replyTo: "", mergeData: { name: "Member" } }],
    validation,
    campaignValidation: validation,
    skipInvalidRows: false,
    setSkipInvalidRows: vi.fn(),
    config: {
      defaultPacePerMinute: 12,
      maxCampaignRecipients: 300,
      mailTransport: "smtp",
      attachmentsEnabled: false,
    },
    hydrateSavedFlow: vi.fn(),
    resetWizardState: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    attachmentSetId: null,
    attachmentSetRequestKey: "attachment-request",
    attachmentsUploading: false,
    attachmentsHaveErrors: false,
    attachmentsReady: true,
    uploadAttachment: vi.fn(),
    retryAttachment: vi.fn(),
    removeAttachment: vi.fn(),
  };
}

function apiValue(): ApiContextValue {
  return {
    status: "authenticated",
    user: {
      id: "user-review",
      displayName: "Amina Tan",
      principalName: "amina@student.example",
      mailboxAddress: "amina@student.example",
    },
    csrfToken: "csrf-review",
    config: {
      defaultPacePerMinute: 12,
      maxCampaignRecipients: 300,
      mailTransport: "smtp",
      attachmentsEnabled: false,
    },
    isLive: true,
    dashboard: { status: "idle", flows: null, campaigns: null, error: "" },
    refreshDashboard: vi.fn().mockResolvedValue(undefined),
    setSession: vi.fn(),
  };
}

function renderReview(draft = draftValue()) {
  return render(
    <MemoryRouter initialEntries={["/flows/new/review"]}>
      <ApiContext.Provider value={apiValue()}>
        <DraftContext.Provider value={draft}>
          <Routes>
            <Route path="/flows/new/review" element={<ReviewPage />} />
            <Route path="/campaigns/:campaignId" element={<p>Campaign route</p>} />
          </Routes>
        </DraftContext.Provider>
      </ApiContext.Provider>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const acceptedResult = {
  result: {
    status: "accepted" as const,
    userMessage: "Accepted by Microsoft" as const,
    senderAddress: "amina@student.example",
    recipientAddress: "amina@student.example",
    smtpStatus: 250,
  },
};

describe("Review action feedback", () => {
  beforeEach(() => {
    mockedLogout.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the test pending label, prevents duplicate and cross-action calls, then marks acceptance complete", async () => {
    const request = deferred<typeof acceptedResult>();
    mockedSendCampaignTest.mockReturnValue(request.promise);
    renderReview();
    fireEvent.click(screen.getByLabelText(/I have checked the sender/));

    const idleButton = screen.getByRole("button", { name: "Send test to me" });
    fireEvent.click(idleButton);
    fireEvent.click(idleButton);

    const pendingButton = screen.getByRole("button", { name: "Sending test..." });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Confirm & start" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Sending test...");
    await waitFor(() => expect(mockedSendCampaignTest).toHaveBeenCalledTimes(1));

    await act(async () => request.resolve(acceptedResult));

    const completeButton = await screen.findByRole("button", { name: "Test accepted" });
    expect(completeButton).toBeDisabled();
    expect(completeButton).toHaveClass("review-action--complete");
    expect(screen.getByRole("status")).toHaveTextContent("Microsoft accepted the test request for your mailbox.");
  });

  it("reports a replay without implying that another message was sent", async () => {
    mockedSendCampaignTest.mockResolvedValue({ ...acceptedResult, replayed: true });
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));

    expect(await screen.findByRole("button", { name: "Already accepted" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("This test was already accepted. No new message was sent.");
  });

  it("restores a failed test for a controlled retry", async () => {
    mockedSendCampaignTest
      .mockRejectedValueOnce(new Error("Microsoft rejected this test before submission."))
      .mockResolvedValueOnce(acceptedResult);
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    expect(await screen.findByText("Microsoft rejected this test before submission.")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Send test to me" });
    expect(retryButton).toBeEnabled();

    fireEvent.click(retryButton);
    expect(await screen.findByRole("button", { name: "Test accepted" })).toBeDisabled();
    expect(mockedSendCampaignTest).toHaveBeenCalledTimes(2);
  });

  it("retries the same test sample after navigating previews and remounting Review", async () => {
    const draft = draftValue();
    const first = validation.validRows[0];
    const rows = [first, { ...first, sourceRow: 3, to: "second@example.test" }];
    const state = { ...draft, testRequest: { current: null }, validation: { ...validation, validRows: rows }, campaignValidation: { ...validation, validRows: rows } };
    mockedSendCampaignTest.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce(acceptedResult);
    const view = renderReview(state);
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await screen.findByText("Lost response");
    const originalPayload = mockedSendCampaignTest.mock.calls[0][1];
    view.unmount();
    renderReview(state);
    fireEvent.click(screen.getByRole("button", { name: "Next sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await screen.findByRole("button", { name: "Test accepted" });
    expect(mockedSendCampaignTest.mock.calls[1][1]).toEqual(originalPayload);
  });

  it("shows the start pending label, locks both actions, and restores retry after failure", async () => {
    const request = deferred<{ campaign: CampaignResponse["campaign"] }>();
    mockedStartCampaign.mockReturnValue(request.promise);
    renderReview();
    fireEvent.click(screen.getByLabelText(/I have checked the sender/));

    const idleButton = screen.getByRole("button", { name: "Confirm & start" });
    fireEvent.click(idleButton);
    fireEvent.click(idleButton);

    const pendingButton = screen.getByRole("button", { name: "Starting campaign..." });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Send test to me" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Starting campaign...");
    await waitFor(() => expect(mockedStartCampaign).toHaveBeenCalledTimes(1));

    await act(async () => request.reject(new Error("The campaign could not be queued.")));

    const retryButton = await screen.findByRole("button", { name: "Confirm & start" });
    expect(retryButton).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("The campaign could not be queued.");

    mockedStartCampaign.mockResolvedValue({ campaign: { ...campaignResponse.campaign, state: "queued" } });
    fireEvent.click(retryButton);
    await waitFor(() => expect(mockedStartCampaign).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Campaign route")).toBeInTheDocument();
  });
});
