import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError, archiveFlow, getCampaign, getCampaigns, getFlows, getMe, logout } from "./app/api";

vi.mock("./app/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app/api")>();
  return {
    ...actual,
    archiveFlow: vi.fn(),
    getMe: vi.fn(),
    getFlows: vi.fn(),
    getCampaigns: vi.fn(),
    getCampaign: vi.fn(),
    logout: vi.fn(),
  };
});

const mockedGetMe = vi.mocked(getMe);
const mockedArchiveFlow = vi.mocked(archiveFlow);
const mockedGetFlows = vi.mocked(getFlows);
const mockedGetCampaigns = vi.mocked(getCampaigns);
const mockedGetCampaign = vi.mocked(getCampaign);
const mockedLogout = vi.mocked(logout);

describe("landing actions", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    window.history.replaceState({}, "", "/");
    mockedGetFlows.mockResolvedValue({ flows: [] });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [] });
    mockedLogout.mockResolvedValue({ ok: true });
    mockedArchiveFlow.mockResolvedValue({
      flow: {
        id: "flow-archive",
        ownerUserId: "user-1",
        societyName: null,
        name: "Archived flow",
        currentTemplateVersionId: null,
        state: "archived",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("offers Microsoft sign-in when there is no application session", async () => {
    mockedGetMe.mockRejectedValue(new ApiRequestError(401, { error: { code: "unauthenticated" } }));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Microsoft" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Import, review, send, and Microsoft acceptance workflow" })).not.toBeInTheDocument();
  });

  it("links both actions to the dashboard for an authenticated member", async () => {
    mockedGetMe.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Amina Tan",
        principalName: "amina@student.example",
        mailboxAddress: "amina@student.example",
      },
      csrfToken: "test-csrf-token",
      config: { defaultPacePerMinute: 12, maxCampaignRecipients: 300 },
    });

    render(<App />);

    expect(await screen.findByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });
});

describe("authenticated information architecture", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    mockedGetMe.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Amina Tan",
        principalName: "amina@student.example",
        mailboxAddress: "amina@student.example",
      },
      csrfToken: "test-csrf-token",
      config: { defaultPacePerMinute: 12, maxCampaignRecipients: 300 },
    });
    mockedGetFlows.mockResolvedValue({ flows: [] });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [] });
    mockedLogout.mockResolvedValue({ ok: true });
    mockedArchiveFlow.mockResolvedValue({
      flow: {
        id: "flow-archive",
        ownerUserId: "user-1",
        societyName: null,
        name: "Archived flow",
        currentTemplateVersionId: null,
        state: "archived",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps recipients inside the flow and shows a clean flow library", async () => {
    window.history.replaceState({}, "", "/flows");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Your reusable flows." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Flows" })).toHaveAttribute("href", "/flows");
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveAttribute("href", "/campaigns");
    expect(screen.queryByRole("link", { name: "Recipients" })).not.toBeInTheDocument();
    expect(screen.getByText("For student societies")).toBeInTheDocument();
    expect(screen.queryByText("USM Debate Society")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Help" })).not.toBeInTheDocument();
    expect(screen.getByText("No flows yet")).toBeInTheDocument();
    expect(screen.getByText(/Need help\? Contact us at/)).toBeInTheDocument();
  });

  it("starts a new flow with an empty data-first step", async () => {
    window.history.replaceState({}, "", "/flows/new/data");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Bring in the recipient data." })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 1 of 4" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/No sample recipients are preloaded\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to template/ })).toBeDisabled();
    expect(screen.queryByText("recipients.xlsx")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex Tan")).not.toBeInTheDocument();
  });

  it("requires confirmation before removing a flow and then archives it", async () => {
    window.history.replaceState({}, "", "/flows");
    const activeFlow = {
      id: "flow-archive",
      ownerUserId: "user-1",
      societyName: null,
      name: "Annual invitation",
      currentTemplateVersionId: "template-1",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    mockedGetFlows.mockResolvedValueOnce({ flows: [activeFlow] }).mockResolvedValue({ flows: [] });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Annual invitation" }));
    expect(mockedArchiveFlow).not.toHaveBeenCalled();
    expect(screen.getByText("Campaign history stays available.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Annual invitation" }));

    await waitFor(() => expect(mockedArchiveFlow).toHaveBeenCalledWith("flow-archive", "test-csrf-token"));
    expect(await screen.findByText("No flows yet")).toBeInTheDocument();
  });

  it("labels campaign history with the reusable flow name", async () => {
    window.history.replaceState({}, "", "/campaigns");
    const campaign = {
      id: "campaign_2ed31a40",
      flowId: "flow_y2_talent",
      templateVersionId: "template_1",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Y2 Student Email.xlsx",
      totalRecipients: 5,
      validRecipients: 5,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "paused" as const,
      pauseReason: "Paused by member",
      createdAt: "2026-09-01T01:00:00.000Z",
      queuedAt: "2026-09-01T01:00:01.000Z",
      startedAt: "2026-09-01T01:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-01T01:00:20.000Z",
    };
    const counts = { pending: 1, claimed: 0, sending: 0, accepted: 4, failed: 0, skipped: 0, unknown: 0 };
    mockedGetFlows.mockResolvedValue({
      flows: [{
        id: "flow_y2_talent",
        ownerUserId: "user-1",
        societyName: null,
        name: "Y2 Talent Recruitment",
        currentTemplateVersionId: "template_1",
        state: "active",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:30:00.000Z",
      }],
    });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [campaign] });
    mockedGetCampaign.mockResolvedValue({ campaign, counts });

    render(<App />);

    expect(await screen.findByText("Y2 Talent Recruitment")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText(/Campaign campaign_/)).not.toBeInTheDocument();
  });
});
