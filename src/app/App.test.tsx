import { formatTimestamp } from "./lib/format";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { AttachmentFileResponse } from "./api";
import { ApiRequestError, archiveFlow, createAttachmentSet, createCampaign, createFlow, createTemplateVersion, deleteAttachmentFile, getCampaign, getCampaignJobs, getCampaigns, getFlow, getFlows, getMe, logout, sendCampaignTest, updateFlow, uploadAttachmentFile } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    archiveFlow: vi.fn(),
    createAttachmentSet: vi.fn(),
    createCampaign: vi.fn(),
    createFlow: vi.fn(),
    createTemplateVersion: vi.fn(),
    deleteAttachmentFile: vi.fn(),
    getMe: vi.fn(),
    getFlows: vi.fn(),
    getCampaigns: vi.fn(),
    getCampaign: vi.fn(),
    getCampaignJobs: vi.fn(),
    getFlow: vi.fn(),
    logout: vi.fn(),
    sendCampaignTest: vi.fn(),
    updateFlow: vi.fn(),
    uploadAttachmentFile: vi.fn(),
  };
});

const mockedGetMe = vi.mocked(getMe);
const mockedArchiveFlow = vi.mocked(archiveFlow);
const mockedCreateAttachmentSet = vi.mocked(createAttachmentSet);
const mockedCreateCampaign = vi.mocked(createCampaign);
const mockedCreateFlow = vi.mocked(createFlow);
const mockedCreateTemplateVersion = vi.mocked(createTemplateVersion);
const mockedDeleteAttachmentFile = vi.mocked(deleteAttachmentFile);
const mockedGetFlows = vi.mocked(getFlows);
const mockedGetCampaigns = vi.mocked(getCampaigns);
const mockedGetCampaign = vi.mocked(getCampaign);
const mockedGetCampaignJobs = vi.mocked(getCampaignJobs);
const mockedGetFlow = vi.mocked(getFlow);
const mockedLogout = vi.mocked(logout);
const mockedSendCampaignTest = vi.mocked(sendCampaignTest);
const mockedUpdateFlow = vi.mocked(updateFlow);
const mockedUploadAttachmentFile = vi.mocked(uploadAttachmentFile);

async function importRecipients() {
  const input = await screen.findByLabelText("Recipient spreadsheet");
  fireEvent.change(input, { target: { files: [new File(["Email\nmember@example.test\n"], "members.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: /Continue to message/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Continue to message/ }));
  await screen.findByRole("heading", { name: "What would you like to say?" });
}

async function openAttachments() {
  await importRecipients();
  fireEvent.click(screen.getByText("Attachments", { selector: "summary" }));
}

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
    mockedCreateTemplateVersion.mockResolvedValue({
      version: {
        id: "template-renamed",
        flowId: "flow-rename",
        version: 2,
        subjectTemplate: "Hello",
        bodyHtml: "<p>Hello</p>",
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
        placeholderManifest: [],
        createdAt: "2026-09-01T00:01:00.000Z",
      },
    });
    mockedUpdateFlow.mockResolvedValue({
      flow: {
        id: "flow-rename",
        ownerUserId: "user-1",
        societyName: null,
        name: "Renamed flow",
        currentTemplateVersionId: "template-renamed",
        state: "active",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:01:00.000Z",
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
    mockedCreateTemplateVersion.mockResolvedValue({
      version: {
        id: "template-renamed",
        flowId: "flow-rename",
        version: 2,
        subjectTemplate: "Hello",
        bodyHtml: "<p>Hello</p>",
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
        placeholderManifest: [],
        createdAt: "2026-09-01T00:01:00.000Z",
      },
    });
    mockedUpdateFlow.mockResolvedValue({
      flow: {
        id: "flow-rename",
        ownerUserId: "user-1",
        societyName: null,
        name: "Renamed flow",
        currentTemplateVersionId: "template-renamed",
        state: "active",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:01:00.000Z",
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps primary sign-in successful and explains a declined OneDrive onboarding step", async () => {
    window.history.replaceState({}, "", "/dashboard?onedrive=cancelled");
    render(<App />);

    expect(await screen.findByText(/You are signed in\. OneDrive connection was cancelled/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect from Recipients" })).toHaveAttribute("href", "/flows/new/recipients");
  });

  it("keeps recipients inside the flow and shows a clean flow library", async () => {
    window.history.replaceState({}, "", "/flows");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Saved templates" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Saved templates" })).toHaveAttribute("href", "/flows");
    expect(screen.getByRole("link", { name: "Send history" })).toHaveAttribute("href", "/campaigns");
    expect(screen.queryByRole("link", { name: "Recipients" })).not.toBeInTheDocument();
    expect(screen.getByText("For student societies")).toBeInTheDocument();
    expect(screen.queryByText("USM Debate Society")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Help" })).not.toBeInTheDocument();
    expect(screen.getByText("No templates yet")).toBeInTheDocument();
    expect(screen.getByText(/Need help\? Contact us at/)).toBeInTheDocument();
  });

  it("starts a new flow with an empty data-first step", async () => {
    window.history.replaceState({}, "", "/flows/new/data");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Who are you writing to?" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Step 1 of 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Recipients" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/Your spreadsheet is read in this browser/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to message/ })).toBeDisabled();
    expect(screen.queryByText("recipients.xlsx")).not.toBeInTheDocument();
    expect(screen.queryByText("Alex Tan")).not.toBeInTheDocument();
  });

  it("revalidates shared data when navigation enters the flow library", async () => {
    window.history.replaceState({}, "", "/dashboard");
    const oldFlow = {
      id: "flow-old",
      ownerUserId: "user-1",
      societyName: null,
      name: "Old flow",
      currentTemplateVersionId: "template-old",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    const newFlow = { ...oldFlow, id: "flow-new", name: "Fresh route flow", currentTemplateVersionId: "template-new" };
    mockedGetFlows.mockResolvedValueOnce({ flows: [oldFlow] }).mockResolvedValue({ flows: [newFlow] });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Old flow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^Saved templates$/ }));

    expect(await screen.findByRole("heading", { name: "Fresh route flow" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old flow" })).not.toBeInTheDocument();
    expect(mockedGetFlows).toHaveBeenCalledTimes(2);
    expect(mockedGetCampaigns).toHaveBeenCalledTimes(2);
  });

  it("does not let an older overlapping request replace newer route data", async () => {
    window.history.replaceState({}, "", "/dashboard");
    const staleFlow = {
      id: "flow-stale",
      ownerUserId: "user-1",
      societyName: null,
      name: "Stale flow",
      currentTemplateVersionId: "template-stale",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    const newestFlow = { ...staleFlow, id: "flow-newest", name: "Newest flow", currentTemplateVersionId: "template-newest" };
    let resolveOlderRequest!: (value: { flows: readonly typeof staleFlow[] }) => void;
    const olderRequest = new Promise<{ flows: readonly typeof staleFlow[] }>((resolve) => { resolveOlderRequest = resolve; });
    mockedGetFlows.mockReturnValueOnce(olderRequest).mockResolvedValue({ flows: [newestFlow] });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Good afternoon/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^Saved templates$/ }));
    expect(await screen.findByRole("heading", { name: "Newest flow" })).toBeInTheDocument();

    await act(async () => { resolveOlderRequest({ flows: [staleFlow] }); });

    expect(screen.getByRole("heading", { name: "Newest flow" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stale flow" })).not.toBeInTheDocument();
  });

  it("persists a renamed flow before returning to the flow library", async () => {
    window.history.replaceState({}, "", "/flows");
    const originalFlow = {
      id: "flow-rename",
      ownerUserId: "user-1",
      societyName: null,
      name: "Original flow",
      currentTemplateVersionId: "template-original",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    const renamedFlow = { ...originalFlow, name: "Renamed flow", updatedAt: "2026-09-01T00:01:00.000Z" };
    mockedGetFlow.mockResolvedValue({
      flow: originalFlow,
      templateVersion: {
        id: "template-original",
        flowId: originalFlow.id,
        version: 1,
        subjectTemplate: "Hello",
        bodyHtml: "<p>Hello</p>",
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
        placeholderManifest: [],
        createdAt: "2026-09-01T00:00:01.000Z",
      },
    });
    mockedGetFlows.mockResolvedValueOnce({ flows: [originalFlow] }).mockResolvedValue({ flows: [renamedFlow] });
    mockedUpdateFlow.mockResolvedValue({ flow: renamedFlow });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save as template" }));
    expect(mockedGetFlow).toHaveBeenCalledExactlyOnceWith("flow-rename");
    fireEvent.click(screen.getByRole("radio", { name: /Update Original flow/ }));
    const nameInput = screen.getByLabelText("Template name");
    fireEvent.change(nameInput, { target: { value: "Renamed flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Update template" }));

    await waitFor(() => expect(mockedUpdateFlow).toHaveBeenCalledWith("flow-rename", { name: "Renamed flow" }, "test-csrf-token"));
    expect(mockedCreateTemplateVersion).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Renamed flow");
    expect(screen.getByRole("button", { name: "Template saved" })).toBeEnabled();
    expect(screen.queryByLabelText("Messages per minute")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Separate multiple addresses with")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Sending options", { exact: false }));
    fireEvent.paste(screen.getByRole("textbox", { name: "CC" }), { clipboardData: { getData: () => "one@example.test,two@example.test;three@example.test\nfour@example.test" } });
    for (const address of ["one", "two", "three", "four"]) {
      expect(screen.getByRole("button", { name: `Remove ${address}@example.test` })).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText("Importance"), { target: { value: "high" } });
    expect(screen.getByRole("button", { name: "Save as template" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Template saved" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(await screen.findByRole("heading", { name: "Renamed flow" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Original flow" })).not.toBeInTheDocument();
  });

  it("shows a duplicate-name conflict beside the flow name field", async () => {
    window.history.replaceState({}, "", "/flows/flow-rename/edit/template");
    const originalFlow = {
      id: "flow-rename",
      ownerUserId: "user-1",
      societyName: null,
      name: "Original flow",
      currentTemplateVersionId: "template-original",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    mockedGetFlow.mockResolvedValue({
      flow: originalFlow,
      templateVersion: {
        id: "template-original",
        flowId: originalFlow.id,
        version: 1,
        subjectTemplate: "Hello",
        bodyHtml: "<p>Hello</p>",
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
        placeholderManifest: [],
        createdAt: "2026-09-01T00:00:01.000Z",
      },
    });
    mockedGetFlows.mockResolvedValue({ flows: [originalFlow] });
    mockedUpdateFlow.mockRejectedValue(new ApiRequestError(409, { error: { code: "flow_name_conflict", message: "Choose a different flow name. Flow names must be unique." } }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Save as template" }));
    fireEvent.click(screen.getByRole("radio", { name: /Update Original flow/ }));
    const nameInput = screen.getByLabelText("Template name");
    fireEvent.change(nameInput, { target: { value: "Existing flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Update template" }));

    expect(await screen.findByText("Choose a different flow name. Flow names must be unique.")).toBeInTheDocument();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(mockedCreateTemplateVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Template saved" })).not.toBeInTheDocument();
    expect(screen.queryByText("Changes were not fully saved.")).not.toBeInTheDocument();
  });

  it("round-trips a styled email table between visual and HTML source modes", async () => {
    window.history.replaceState({}, "", "/flows/flow-rename/edit/template");
    const flow = {
      id: "flow-rename",
      ownerUserId: "user-1",
      societyName: null,
      name: "Invitation flow",
      currentTemplateVersionId: "template-original",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    mockedGetFlow.mockResolvedValue({
      flow,
      templateVersion: {
        id: "template-original",
        flowId: flow.id,
        version: 1,
        subjectTemplate: "Invitation",
        bodyHtml: '<table style="width:100%;border-collapse:collapse"><tbody><tr><td style="border:1px solid #d9d9d9;padding:12px"><mark>Judging Period</mark></td><td style="border:1px solid #d9d9d9;padding:12px">{{name}}</td></tr></tbody></table>',
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto", placeholderMappings: { name: "name" } },
        placeholderManifest: ["name"],
        createdAt: "2026-09-01T00:00:01.000Z",
      },
    });
    mockedGetFlows.mockResolvedValue({ flows: [flow] });

    render(<App />);

    expect(await screen.findByRole("toolbar", { name: "Message formatting" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message body" }).querySelector("table")).not.toBeNull());
    const visualEditor = screen.getByRole("textbox", { name: "Message body" });
    expect(visualEditor.querySelector("td")?.style.border).toContain("1px solid");
    expect(visualEditor.querySelector("mark")).toHaveTextContent("Judging Period");
    expect(visualEditor.querySelector("[data-dynamic-field='name']")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit HTML source" }));
    const sourceEditor = screen.getByRole("textbox", { name: "Message body HTML" }) as HTMLTextAreaElement;
    expect(sourceEditor.value).toContain("border:1px solid #d9d9d9");
    fireEvent.change(sourceEditor, { target: { value: '<table style="border-collapse:collapse"><tr><td style="border:1px solid #d9d9d9;padding:14px"><mark>Updated</mark></td></tr></table><script>alert(1)</script>' } });
    expect(screen.getByText(/Unsupported or unsafe markup is removed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Return to visual editor" }));
    const cleanedVisualEditor = screen.getByRole("textbox", { name: "Message body" });
    await waitFor(() => expect(cleanedVisualEditor.querySelector("mark")).toHaveTextContent("Updated"));
    expect(cleanedVisualEditor.querySelector("script")).toBeNull();
    expect(cleanedVisualEditor.querySelector("td")?.style.border).toContain("1px solid");

    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    fireEvent.click(screen.getByRole("radio", { name: /Update Invitation flow/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update template" }));
    await waitFor(() => expect(mockedCreateTemplateVersion).toHaveBeenCalled());
    const savedPayload = mockedCreateTemplateVersion.mock.calls.at(-1)?.[1];
    expect(savedPayload?.bodyHtml).toContain("border:");
    expect(savedPayload?.bodyHtml).toContain("padding:");
    expect(savedPayload?.bodyHtml).not.toContain("<script");
  });

  it("preserves sanitized rich HTML when it is pasted into the visual editor", async () => {
    window.history.replaceState({}, "", "/flows/flow-rename/edit/template");
    const flow = {
      id: "flow-rename",
      ownerUserId: "user-1",
      societyName: null,
      name: "Invitation flow",
      currentTemplateVersionId: "template-original",
      state: "active" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };
    mockedGetFlow.mockResolvedValue({
      flow,
      templateVersion: {
        id: "template-original",
        flowId: flow.id,
        version: 1,
        subjectTemplate: "Invitation",
        bodyHtml: "<p>Opening</p>",
        recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
        placeholderManifest: [],
        createdAt: "2026-09-01T00:00:01.000Z",
      },
    });
    mockedGetFlows.mockResolvedValue({ flows: [flow] });

    render(<App />);

    const visualEditor = await screen.findByRole("textbox", { name: "Message body" });
    fireEvent.focus(visualEditor);
    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => type === "text/html"
          ? '<table style="width:100%;border-collapse:collapse"><tr><td style="border:1px solid #d9d9d9;background-color:#f5f6f7;padding:12px">Pasted table</td></tr></table>'
          : "Pasted table",
      },
    });

    await waitFor(() => expect(visualEditor.querySelector("table")).not.toBeNull());
    expect(visualEditor.querySelector("td")?.style.border).toContain("1px solid");
    fireEvent.click(screen.getByRole("button", { name: "Edit HTML source" }));
    expect((screen.getByRole("textbox", { name: "Message body HTML" }) as HTMLTextAreaElement).value).toContain("Pasted table");
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
    expect(await screen.findByText("No templates yet")).toBeInTheDocument();
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
    mockedGetCampaigns.mockResolvedValue({ campaigns: [{ ...campaign, counts }] });

    render(<App />);

    expect(await screen.findByText("Y2 Talent Recruitment")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(mockedGetCampaign).not.toHaveBeenCalled();
    expect(screen.queryByText(/Campaign campaign_/)).not.toBeInTheDocument();
  });

  it("shows a safe waiting status and exact next check without exposing coordination tokens", async () => {
    window.history.replaceState({}, "", "/campaigns/campaign-waiting");
    const counts = { pending: 1, claimed: 0, sending: 0, accepted: 0, failed: 0, skipped: 0, unknown: 0 };
    const campaign = {
      id: "campaign-waiting",
      flowId: "flow-waiting",
      templateVersionId: "template-waiting",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Recipients.xlsx",
      totalRecipients: 1,
      validRecipients: 1,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "running" as const,
      pauseReason: null,
      schedulerNextAttemptAt: "2026-09-06T08:30:00.000Z",
      schedulerMessage: "Microsoft requested a temporary pause. Sending will continue after 2026-09-04T17:28:09.265Z.",
      createdAt: "2026-09-05T08:00:00.000Z",
      queuedAt: "2026-09-05T08:00:01.000Z",
      startedAt: "2026-09-05T08:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-05T08:00:03.000Z",
    };
    mockedGetCampaign.mockResolvedValue({ campaign, counts });
    mockedGetCampaignJobs.mockResolvedValue({ jobs: [], counts, limit: 100, offset: 0 });

    render(<App />);

    expect(await screen.findByText("Waiting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Microsoft requested a temporary pause");
    expect(screen.getByRole("status")).toHaveTextContent(formatTimestamp("2026-09-04T17:28:09.265Z"));
    expect(screen.getByRole("status")).not.toHaveTextContent("2026-09-04T17:28:09.265Z");
    expect(document.body.textContent).not.toMatch(/wake_|attempt_|lease_/u);
  });

  it("separates a campaign-level failure from recipient outcomes in history", async () => {
    window.history.replaceState({}, "", "/campaigns");
    const campaign = {
      id: "campaign-failed-history",
      flowId: "flow-failed-history",
      templateVersionId: "template-failed-history",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Recipients.xlsx",
      totalRecipients: 5,
      validRecipients: 5,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "failed" as const,
      pauseReason: "A campaign attachment is no longer available in OneDrive. No additional message was sent.",
      attachmentIssueCode: "attachment_missing" as const,
      attachmentRetryCount: 0,
      createdAt: "2026-09-05T08:00:00.000Z",
      queuedAt: "2026-09-05T08:00:01.000Z",
      startedAt: "2026-09-05T08:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-05T08:00:03.000Z",
    };
    const counts = { pending: 2, claimed: 0, sending: 0, accepted: 1, failed: 1, skipped: 0, unknown: 1 };
    mockedGetFlows.mockResolvedValue({ flows: [] });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [{ ...campaign, counts }] });

    render(<App />);

    expect(await screen.findByText("Campaign failed")).toBeInTheDocument();
    expect(screen.getByText("1 recipient failed")).toBeInTheDocument();
    expect(screen.getByText("1 outcome unknown")).toBeInTheDocument();
    expect(screen.getByText("2 not sent")).toBeInTheDocument();
  });

  it("shows pending rows as not sent and removes time remaining after a campaign failure", async () => {
    window.history.replaceState({}, "", "/campaigns/campaign-failed-detail");
    const campaign = {
      id: "campaign-failed-detail",
      flowId: "flow-failed-detail",
      templateVersionId: "template-failed-detail",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Recipients.xlsx",
      totalRecipients: 3,
      validRecipients: 3,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "failed" as const,
      pauseReason: "A campaign attachment no longer matches the reviewed file. No additional message was sent.",
      attachmentIssueCode: "attachment_integrity" as const,
      attachmentRetryCount: 0,
      createdAt: "2026-09-05T08:00:00.000Z",
      queuedAt: "2026-09-05T08:00:01.000Z",
      startedAt: "2026-09-05T08:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-05T08:00:03.000Z",
    };
    const counts = { pending: 1, claimed: 0, sending: 0, accepted: 1, failed: 1, skipped: 0, unknown: 0 };
    const jobs = [
      { id: "job-accepted", campaignId: campaign.id, sourceRow: 1, recipient: "accepted@example.test", cc: [], bcc: [], replyTo: [], importance: "normal" as const, mergeData: {}, renderedSubject: "Invitation", renderedBodyHtml: "<p>Invitation</p>", sendKey: "send-accepted", status: "accepted" as const, attemptCount: 1, claimToken: null, claimedAt: null, sendingAt: null, acceptedAt: "2026-09-05T08:00:02.000Z", nextAttemptAt: null, lastErrorCategory: null, lastErrorMessage: null, providerMessageId: null, providerRequestId: null, createdAt: "2026-09-05T08:00:00.000Z", updatedAt: "2026-09-05T08:00:02.000Z" },
      { id: "job-pending", campaignId: campaign.id, sourceRow: 2, recipient: "pending@example.test", cc: [], bcc: [], replyTo: [], importance: "normal" as const, mergeData: {}, renderedSubject: "Invitation", renderedBodyHtml: "<p>Invitation</p>", sendKey: "send-pending", status: "pending" as const, attemptCount: 0, claimToken: null, claimedAt: null, sendingAt: null, acceptedAt: null, nextAttemptAt: null, lastErrorCategory: null, lastErrorMessage: null, providerMessageId: null, providerRequestId: null, createdAt: "2026-09-05T08:00:00.000Z", updatedAt: "2026-09-05T08:00:00.000Z" },
      { id: "job-failed", campaignId: campaign.id, sourceRow: 3, recipient: "failed@example.test", cc: [], bcc: [], replyTo: [], importance: "normal" as const, mergeData: {}, renderedSubject: "Invitation", renderedBodyHtml: "<p>Invitation</p>", sendKey: "send-failed", status: "failed" as const, attemptCount: 1, claimToken: null, claimedAt: null, sendingAt: null, acceptedAt: null, nextAttemptAt: null, lastErrorCategory: "rejected", lastErrorMessage: "Microsoft rejected this recipient.", providerMessageId: null, providerRequestId: null, createdAt: "2026-09-05T08:00:00.000Z", updatedAt: "2026-09-05T08:00:02.000Z" },
    ];
    mockedGetCampaign.mockResolvedValue({ campaign, counts });
    mockedGetCampaignJobs.mockResolvedValue({ jobs, counts, limit: 500, offset: 0 });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "This campaign stopped safely." })).toBeInTheDocument();
    expect(screen.getByText("Campaign-level failure")).toBeInTheDocument();
    expect(screen.getByText("Not sent", { selector: ".status" })).toBeInTheDocument();
    expect(screen.getByText("Campaign stopped before this row")).toBeInTheDocument();
    expect(screen.queryByText(/minutes remaining/iu)).not.toBeInTheDocument();
    expect(screen.queryByText("Queued")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause campaign" })).not.toBeInTheDocument();
    expect(screen.getByText("1 recipient-level failure, 0 unknown, and 1 not sent.")).toBeInTheDocument();
  });

  it("guides an authorization-paused campaign through OneDrive reconnect and pending-only resume", async () => {
    window.history.replaceState({}, "", "/campaigns/campaign-reconnect");
    const campaign = {
      id: "campaign-reconnect",
      flowId: "flow-reconnect",
      templateVersionId: "template-reconnect",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Recipients.xlsx",
      totalRecipients: 2,
      validRecipients: 2,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "paused" as const,
      pauseReason: "Reconnect OneDrive, then resume from the pending rows.",
      attachmentIssueCode: "attachment_authorization_required" as const,
      attachmentRetryCount: 1,
      createdAt: "2026-09-05T08:00:00.000Z",
      queuedAt: "2026-09-05T08:00:01.000Z",
      startedAt: "2026-09-05T08:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-05T08:00:03.000Z",
    };
    const counts = { pending: 1, claimed: 0, sending: 0, accepted: 1, failed: 0, skipped: 0, unknown: 0 };
    mockedGetCampaign.mockResolvedValue({ campaign, counts });
    mockedGetCampaignJobs.mockResolvedValue({ jobs: [], counts, limit: 500, offset: 0 });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Reconnect OneDrive to continue." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Reconnect OneDrive" })[0]).toHaveAttribute("href", "/auth/microsoft/onedrive/start?returnTo=%2Fcampaigns%2Fcampaign-reconnect");
    expect(screen.getByRole("button", { name: "Resume pending rows" })).toBeEnabled();
    expect(screen.queryByText(/minutes remaining/iu)).not.toBeInTheDocument();
  });

  it("pages every recipient job within the campaign monitor", async () => {
    window.history.replaceState({}, "", "/campaigns/campaign-full-list");
    const campaign = {
      id: "campaign-full-list",
      flowId: "flow-full-list",
      templateVersionId: "template-full-list",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "Recipients.xlsx",
      totalRecipients: 108,
      validRecipients: 108,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "running" as const,
      pauseReason: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      queuedAt: "2026-09-05T00:00:01.000Z",
      startedAt: "2026-09-05T00:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-09-05T00:02:00.000Z",
    };
    const counts = { pending: 88, claimed: 0, sending: 0, accepted: 20, failed: 0, skipped: 0, unknown: 0 };
    const jobs = Array.from({ length: 108 }, (_, index) => ({
      id: `job-${index + 1}`,
      campaignId: campaign.id,
      sourceRow: index + 2,
      recipient: `recipient${String(index + 1).padStart(3, "0")}@example.test`,
      cc: [],
      bcc: [],
      replyTo: [],
      importance: "normal" as const,
      mergeData: {},
      renderedSubject: "Invitation",
      renderedBodyHtml: "<p>Invitation</p>",
      sendKey: `send-${index + 1}`,
      status: index < 20 ? "accepted" as const : "pending" as const,
      attemptCount: index < 20 ? 1 : 0,
      claimToken: null,
      claimedAt: null,
      sendingAt: null,
      acceptedAt: index < 20 ? "2026-09-05T00:02:00.000Z" : null,
      nextAttemptAt: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      providerMessageId: null,
      providerRequestId: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:02:00.000Z",
    }));
    mockedGetCampaign.mockResolvedValue({ campaign, counts });
    mockedGetCampaignJobs.mockResolvedValue({ jobs, counts, limit: 500, offset: 0 });

    render(<App />);

    expect(await screen.findByText("recipient001@example.test")).toBeInTheDocument();
    expect(screen.getByText("recipient009@example.test")).toBeInTheDocument();
    expect(screen.queryByText("recipient010@example.test")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(10);
    expect(screen.getByText("Showing 1-9 of 108 recipient jobs")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous recipient jobs page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next recipient jobs page" }));

    expect(screen.queryByText("recipient001@example.test")).not.toBeInTheDocument();
    expect(screen.getByText("recipient010@example.test")).toBeInTheDocument();
    expect(screen.getByText("recipient018@example.test")).toBeInTheDocument();
    expect(screen.getByText("Showing 10-18 of 108 recipient jobs")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 12")).toBeInTheDocument();

    for (let page = 2; page < 12; page += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next recipient jobs page" }));
    }

    expect(screen.getByText("recipient108@example.test")).toBeInTheDocument();
    expect(screen.getByText("Showing 100-108 of 108 recipient jobs")).toBeInTheDocument();
    expect(screen.getByText("Page 12 of 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next recipient jobs page" })).toBeDisabled();
    expect(mockedGetCampaignJobs).toHaveBeenCalledWith("campaign-full-list", 500, 0);
  });
});

describe("campaign attachments", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    window.history.replaceState({}, "", "/flows/new/data");
    mockedGetMe.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Amina Tan",
        principalName: "amina@student.example",
        mailboxAddress: "amina@student.example",
      },
      csrfToken: "test-csrf-token",
      config: {
        defaultPacePerMinute: 12,
        maxCampaignRecipients: 300,
        mailTransport: "smtp",
        attachmentsEnabled: true,
        maxAttachmentFiles: 5,
        maxAttachmentBytes: 20 * 1024 * 1024,
      },
    });
    mockedGetFlows.mockResolvedValue({ flows: [] });
    mockedGetCampaigns.mockResolvedValue({ campaigns: [] });
    mockedCreateAttachmentSet.mockResolvedValue({ attachmentSet: { id: "set-1" } });
    mockedUploadAttachmentFile.mockImplementation(async (_setId, file) => ({
      file: {
        id: `server-${file.name}`,
        originalFilename: file.name,
        mediaType: file.type || "application/octet-stream",
        byteSize: file.size,
      },
    }));
    mockedDeleteAttachmentFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects signature mismatches before creating an attachment set or uploading", async () => {
    render(<App />);
    await openAttachments();
    await screen.findByRole("button", { name: /Drop files here or choose files/ });
    const input = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["plain text"], "fake.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("The file content does not match a supported file format.")).toBeInTheDocument();
    expect(mockedCreateAttachmentSet).not.toHaveBeenCalled();
    expect(mockedUploadAttachmentFile).not.toHaveBeenCalled();
  });

  it("keeps an incomplete upload response in an error state instead of inventing ready metadata", async () => {
    mockedUploadAttachmentFile.mockResolvedValueOnce({ file: { originalFilename: "agenda.txt", mediaType: "text/plain", byteSize: 5 } } as AttachmentFileResponse);
    render(<App />);
    await openAttachments();
    await screen.findByRole("button", { name: /Drop files here or choose files/ });
    const input = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["hello"], "agenda.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("The upload response is incomplete. Remove this file and choose it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry upload agenda.txt" })).toBeEnabled();
    expect(mockedCreateCampaign).not.toHaveBeenCalled();
  });

  it("uploads multiple files, reports invalid files, supports retry, and removes ready files", async () => {
    let releaseFirstUpload!: () => void;
    const firstUpload = new Promise<void>((resolve) => { releaseFirstUpload = resolve; });
    mockedUploadAttachmentFile.mockImplementation(async (_setId, file) => {
      if (file.name === "agenda.pdf") await firstUpload;
      return {
        file: {
          id: `server-${file.name}`,
          originalFilename: file.name,
          mediaType: file.type || "application/octet-stream",
          byteSize: file.size,
        },
      };
    });
    render(<App />);

    await openAttachments();
    expect(await screen.findByRole("button", { name: /Drop files here or choose files/ })).toBeInTheDocument();
    const input = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    const agenda = new File(["%PDF-1.7\nagenda"], "agenda.pdf", { type: "application/pdf" });
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [agenda, notes] } });

    expect(screen.getByText("agenda.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    await waitFor(() => expect(mockedUploadAttachmentFile).toHaveBeenCalledTimes(1));
    expect(mockedUploadAttachmentFile.mock.calls[0][1].name).toBe("agenda.pdf");
    releaseFirstUpload();
    await waitFor(() => expect(screen.getAllByText("Ready")).toHaveLength(2));
    expect(mockedCreateAttachmentSet).toHaveBeenCalledTimes(1);
    expect(mockedCreateAttachmentSet.mock.calls[0]?.[0]).toMatch(/^attachment-/u);
    expect(mockedCreateAttachmentSet.mock.calls[0]?.[1]).toBe("test-csrf-token");
    expect(mockedUploadAttachmentFile).toHaveBeenCalledTimes(2);
    expect(mockedUploadAttachmentFile.mock.calls[0][1]).toBeInstanceOf(File);

    const empty = new File([], "empty.txt", { type: "text/plain" });
    const unsupported = new File(["binary"], "program.exe", { type: "application/octet-stream" });
    const duplicate = new File(["again"], "agenda.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [empty, unsupported, duplicate] } });
    expect(await screen.findByText("Empty files cannot be attached.")).toBeInTheDocument();
    expect(screen.getByText(/This file type is not supported/)).toBeInTheDocument();
    expect(screen.getByText("This file was already added.")).toBeInTheDocument();
    expect(screen.getByText("Remove failed attachments or retry before continuing to Review.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove empty.txt" }));
    expect(screen.queryByText("empty.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove agenda.pdf" })[0]);
    await waitFor(() => expect(mockedDeleteAttachmentFile).toHaveBeenCalledWith("set-1", "server-agenda.pdf", "test-csrf-token"));
    expect(screen.getAllByText("agenda.pdf")).toHaveLength(1);
  });

  it("asks the signed-in student to connect OneDrive before exposing attachment uploads", async () => {
    mockedGetMe.mockResolvedValue({
      user: {
        id: "user-1",
        displayName: "Amina Tan",
        principalName: "amina@student.example",
        mailboxAddress: "amina@student.example",
      },
      csrfToken: "test-csrf-token",
      config: {
        defaultPacePerMinute: 12,
        maxCampaignRecipients: 300,
        mailTransport: "smtp",
        attachmentsEnabled: false,
        attachmentsOneDriveAuthorizationRequired: true,
      },
    });

    render(<App />);

    await openAttachments();
    const connect = await screen.findByRole("link", { name: "Connect OneDrive" });
    expect(connect).toHaveAttribute("href", "/auth/microsoft/onedrive/start?returnTo=%2Fflows%2Fnew%2Ftemplate");
    expect(screen.queryByRole("button", { name: /Drop files here or choose files/ })).not.toBeInTheDocument();
  });

  it("keeps campaign payloads file-free and locks attachments after test campaign creation", async () => {
    window.history.replaceState({}, "", "/flows/new/data");
    mockedCreateFlow.mockResolvedValue({ flow: {
      id: "flow-1",
      ownerUserId: "user-1",
      societyName: null,
      name: "Attachment flow",
      currentTemplateVersionId: null,
      state: "active",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    }, templateVersion: null });
    mockedCreateTemplateVersion.mockResolvedValue({ version: {
      id: "version-1",
      flowId: "flow-1",
      version: 1,
      subjectTemplate: "Hello",
      bodyHtml: "<p>Hello</p>",
      recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" },
      placeholderManifest: [],
      createdAt: "2026-09-02T00:00:00.000Z",
    } });
    const campaign = {
      id: "campaign-1",
      flowId: "flow-1",
      templateVersionId: "version-1",
      ownerUserId: "user-1",
      senderAddress: "amina@student.example",
      sourceFilename: "members.csv",
      totalRecipients: 1,
      validRecipients: 1,
      skippedRecipients: 0,
      pacePerMinute: 12,
      state: "validated" as const,
      pauseReason: null,
      createdAt: "2026-09-02T00:00:00.000Z",
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    mockedCreateCampaign.mockResolvedValue({ campaign, counts: { pending: 1, claimed: 0, sending: 0, accepted: 0, failed: 0, skipped: 0, unknown: 0 } });
    mockedSendCampaignTest.mockResolvedValue({ result: { status: "accepted", userMessage: "Accepted by Microsoft", senderAddress: "amina@student.example", recipientAddress: "amina@student.example", graphStatus: 202 } });

    render(<App />);
    await importRecipients();
    const subject = screen.getByRole("textbox", { name: "Subject" });
    subject.textContent = "Hello";
    fireEvent.input(subject);
    const body = screen.getByRole("textbox", { name: "Message body" });
    body.innerHTML = "<p>Hello</p>";
    fireEvent.input(body);
    fireEvent.click(screen.getByText("Attachments", { selector: "summary" }));
    const attachmentInput = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    fireEvent.change(attachmentInput, { target: { files: [new File(["%PDF-1.7\nagenda"], "agenda.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue to review/ }));
    expect(await screen.findByRole("heading", { name: "Review summary" })).toBeInTheDocument();
    expect(screen.getAllByText(/agenda\.pdf \(/)).not.toHaveLength(0);
    expect(screen.getByRole("note")).toHaveTextContent("The preview keeps the campaign's original resolved To, CC, BCC, and Reply-to headers.");
    expect(screen.getByRole("note")).toHaveTextContent("To is replaced with amina@student.example");
    fireEvent.click(screen.getByLabelText(/I have checked the sender/));
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await waitFor(() => expect(mockedCreateCampaign).toHaveBeenCalled());
    const payload = mockedCreateCampaign.mock.calls.at(-1)?.[0];
    expect(payload?.attachmentSetId).toBe("set-1");
    expect(payload).not.toHaveProperty("attachments");
    expect(Object.values(payload || {}).some((value) => value instanceof File)).toBe(false);
    expect(await screen.findByText("Microsoft accepted the test request for your mailbox.")).toBeInTheDocument();
    expect(mockedSendCampaignTest).toHaveBeenCalledWith(
      "campaign-1",
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^test-campaign-/u), sourceRow: 2 }),
      "test-csrf-token",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Attachments are locked for this campaign.")).toBeInTheDocument();
    expect(document.getElementById("campaign-attachments-input")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove agenda.pdf" })).not.toBeInTheDocument();
  });

  it("previews only the selected template and resolves missing values without replacing recipients", async () => {
    const flow = { id: "reusable", ownerUserId: "user-1", societyName: null, name: "Workshop", currentTemplateVersionId: "v1", state: "active" as const, createdAt: "2026-09-05", updatedAt: "2026-09-05" };
    mockedGetFlows.mockResolvedValue({ flows: [flow] });
    mockedGetFlow.mockResolvedValue({ flow, templateVersion: { id: "v1", flowId: flow.id, version: 1, createdAt: "2026-09-05", subjectTemplate: "Welcome {{name}}", bodyHtml: "<p>{{name}}, meet at {{venue}}.</p>", placeholderManifest: ["name", "venue"], recipientConfiguration: { toField: "old_email", ccField: null, bccField: null, replyToField: null, separator: "auto" } } });
    window.history.replaceState({}, "", "/flows/new/data");
    render(<App />);
    const input = await screen.findByLabelText("Recipient spreadsheet");
    fireEvent.change(input, { target: { files: [new File(["Email,Full name\nmember@example.test,Member\n"], "current-members.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Continue to message/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Continue to message/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose a saved template" }));
    expect(mockedGetFlow).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Workshop/ }));
    await screen.findByText("Suggested: Full name");
    expect(screen.getByText("Not in this file")).toBeInTheDocument();
    expect(mockedGetFlow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    expect(await screen.findByText("current-members.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to review/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use Full name" }));
    expect(screen.getByLabelText("Column for Name")).toHaveValue("full_name");
    expect(screen.getByLabelText("Column for Name")).toHaveFocus();
    expect(within(screen.getByRole("region", { name: "Name connection" })).getByText("Connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace with text" }));
    fireEvent.change(screen.getByLabelText("Text for Venue"), { target: { value: "Room 101" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace Venue with text" }));
    expect(screen.getByRole("complementary", { name: "Message values" })).toHaveFocus();
    expect(screen.getByText("All message values are connected. You can change a column below.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue to review/ }));
    expect(await screen.findByText("member@example.test", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Welcome Member", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByTitle("Email preview for member@example.test")).toHaveAttribute("srcdoc", expect.stringContaining("Member, meet at Room 101."));
    expect(mockedCreateCampaign).not.toHaveBeenCalled();
  });

  it("keeps completed column mappings visible and focused, and previews later changes", async () => {
    const user = userEvent.setup();
    const flow = { id: "mapped-template", ownerUserId: "user-1", societyName: null, name: "Welcome message", currentTemplateVersionId: "mapped-v1", state: "active" as const, createdAt: "2026-09-05", updatedAt: "2026-09-05" };
    mockedGetFlows.mockResolvedValue({ flows: [flow] });
    mockedGetFlow.mockResolvedValue({ flow, templateVersion: { id: "mapped-v1", flowId: flow.id, version: 1, createdAt: "2026-09-05", subjectTemplate: "Hello {{student_name}}", bodyHtml: "<p>Greetings {{student_name}}.</p>", placeholderManifest: ["student_name"], recipientConfiguration: { toField: "email", ccField: null, bccField: null, replyToField: null, separator: "auto" } } });
    window.history.replaceState({}, "", "/flows/new/data");
    render(<App />);
    await user.upload(await screen.findByLabelText("Recipient spreadsheet"), new File(["Email,Name,Preferred name\nmember@example.test,Amina,Amy\n"], "renamed-columns.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to message" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue to message" }));
    await user.click(await screen.findByRole("button", { name: "Choose a saved template" }));
    await user.click(await screen.findByRole("button", { name: /^Welcome message/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this template" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Use this template" }));

    const column = screen.getByRole("combobox", { name: "Column for Student Name" });
    await user.selectOptions(column, "name");
    expect(column).toBeInTheDocument();
    expect(column).toHaveValue("name");
    expect(column).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Subject" })).not.toHaveFocus();
    expect(within(screen.getByRole("region", { name: "Student Name connection" })).getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("All message values are connected. You can change a column below.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to review" })).toBeEnabled();

    await user.selectOptions(column, "");
    expect(column).toHaveFocus();
    expect(screen.getByRole("button", { name: "Continue to review" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "Student Name connection" })).getByText("Not connected")).toBeInTheDocument();
    await user.selectOptions(column, "preferred_name");
    expect(column).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(await screen.findByText("Hello Amy", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByTitle("Email preview for member@example.test")).toHaveAttribute("srcdoc", expect.stringContaining("Greetings Amy."));
    await user.click(screen.getByRole("link", { name: "Message" }));
    expect(await screen.findByRole("combobox", { name: "Column for Student Name" })).toHaveValue("preferred_name");
    expect(mockedCreateCampaign).not.toHaveBeenCalled();
  });
});
