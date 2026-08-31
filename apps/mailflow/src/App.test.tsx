import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError, getCampaigns, getFlows, getMe, logout } from "./app/api";

vi.mock("./app/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app/api")>();
  return {
    ...actual,
    getMe: vi.fn(),
    getFlows: vi.fn(),
    getCampaigns: vi.fn(),
    logout: vi.fn(),
  };
});

const mockedGetMe = vi.mocked(getMe);
const mockedGetFlows = vi.mocked(getFlows);
const mockedGetCampaigns = vi.mocked(getCampaigns);
const mockedLogout = vi.mocked(logout);

describe("landing actions", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    window.history.replaceState({}, "", "/");
    mockedGetFlows.mockResolvedValue({ flows: [] });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [] });
    mockedLogout.mockResolvedValue({ ok: true });
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
    expect(screen.getByText(/No sample recipients are preloaded\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to template/ })).toBeDisabled();
    expect(screen.queryByText("recipients.xlsx")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex Tan")).not.toBeInTheDocument();
  });
});
