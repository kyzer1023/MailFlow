import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError, archiveFlow, createAttachmentSet, createCampaign, createFlow, createTemplateVersion, deleteAttachmentFile, getCampaign, getCampaigns, getFlow, getFlows, getMe, logout, sendCampaignTest, updateFlow, uploadAttachmentFile } from "./api";

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
const mockedGetFlow = vi.mocked(getFlow);
const mockedLogout = vi.mocked(logout);
const mockedSendCampaignTest = vi.mocked(sendCampaignTest);
const mockedUpdateFlow = vi.mocked(updateFlow);
const mockedUploadAttachmentFile = vi.mocked(uploadAttachmentFile);

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
    fireEvent.click(screen.getByRole("link", { name: /^Flows$/ }));

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
    fireEvent.click(screen.getByRole("link", { name: /^Flows$/ }));
    expect(await screen.findByRole("heading", { name: "Newest flow" })).toBeInTheDocument();

    await act(async () => { resolveOlderRequest({ flows: [staleFlow] }); });

    expect(screen.getByRole("heading", { name: "Newest flow" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stale flow" })).not.toBeInTheDocument();
  });

  it("persists a renamed flow before returning to the flow library", async () => {
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

    const nameInput = await screen.findByLabelText("Flow name");
    fireEvent.change(nameInput, { target: { value: "Renamed flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockedUpdateFlow).toHaveBeenCalledWith("flow-rename", { name: "Renamed flow" }, "test-csrf-token"));
    expect(mockedCreateTemplateVersion).toHaveBeenCalled();
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

    const nameInput = await screen.findByLabelText("Flow name");
    fireEvent.change(nameInput, { target: { value: "Existing flow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Choose a different flow name. Flow names must be unique.")).toBeInTheDocument();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(mockedCreateTemplateVersion).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
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

describe("campaign attachments", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    window.history.replaceState({}, "", "/flows/new/recipients");
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

    expect(await screen.findByRole("button", { name: /Drop files here or choose files/ })).toBeInTheDocument();
    const input = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    const agenda = new File(["agenda"], "agenda.pdf", { type: "application/pdf" });
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

    const connect = await screen.findByRole("link", { name: "Connect OneDrive" });
    expect(connect).toHaveAttribute("href", "/auth/microsoft/onedrive/start?returnTo=%2Fflows%2Fnew%2Frecipients");
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
    const dataInput = await screen.findByLabelText("Choose file");
    fireEvent.change(dataInput, { target: { files: [new File(["Email\nmember@example.test\n"], "members.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /Continue to template/ }));
    const flowName = await screen.findByLabelText("Flow name");
    fireEvent.change(flowName, { target: { value: "Attachment flow" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    const body = screen.getByRole("textbox", { name: "Message body" });
    body.innerHTML = "<p>Hello</p>";
    fireEvent.input(body);
    fireEvent.click(screen.getByRole("button", { name: /Continue to recipients/ }));
    expect(await screen.findByRole("heading", { name: "Set the sending rules." })).toBeInTheDocument();
    const attachmentInput = document.getElementById("campaign-attachments-input") as HTMLInputElement;
    fireEvent.change(attachmentInput, { target: { files: [new File(["agenda"], "agenda.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Continue to review/ }));
    expect(await screen.findByRole("heading", { name: "Review summary" })).toBeInTheDocument();
    expect(screen.getAllByText(/agenda\.pdf \(/)).not.toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/I have checked the sender/));
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await waitFor(() => expect(mockedCreateCampaign).toHaveBeenCalled());
    const payload = mockedCreateCampaign.mock.calls.at(-1)?.[0];
    expect(payload?.attachmentSetId).toBe("set-1");
    expect(payload).not.toHaveProperty("attachments");
    expect(Object.values(payload || {}).some((value) => value instanceof File)).toBe(false);
    expect(await screen.findByText("Test accepted by Microsoft")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Attachments are locked for this campaign.")).toBeInTheDocument();
    expect(document.getElementById("campaign-attachments-input")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove agenda.pdf" })).not.toBeInTheDocument();
  });
});
