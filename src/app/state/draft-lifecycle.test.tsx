import React, { type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  createCampaign,
  createFlow,
  createTemplateVersion,
  getFlows,
  type CampaignResponse,
} from "../api";
import { ApiContext } from "./api-context";
import { DraftProvider, useDraft } from "./draft-context";
import { useEnsureCampaign } from "../hooks/use-ensure-campaign";
import {
  applyTemplate,
  missingMessageFields,
  replaceMessageField,
} from "../lib/template-reuse";
import type { ApiContextValue } from "./types";
import type { FlowRecord, TemplateVersionRecord } from "../../domain/types";
import type { SpreadsheetTable } from "../../client/types";

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  createCampaign: vi.fn(),
  createFlow: vi.fn(),
  createTemplateVersion: vi.fn(),
  getFlows: vi.fn(),
}));
const flow: FlowRecord = {
  id: "flow-1",
  ownerUserId: "user-1",
  name: "Workshop",
  societyName: null,
  currentTemplateVersionId: "template-1",
  state: "active",
  createdAt: "2026-09-05",
  updatedAt: "2026-09-05",
};
const template: TemplateVersionRecord = {
  id: "template-1",
  flowId: flow.id,
  version: 1,
  subjectTemplate: "Hello {{name}}",
  bodyHtml: "<p>{{name}}: meet at {{venue}}</p>",
  recipientConfiguration: {
    toField: "old_email",
    placeholderMappings: { name: "name", venue: "venue" },
    separator: "auto",
    importance: "high",
    ccFixed: "organiser@example.test",
    ccField: null,
    bccField: null,
    replyToField: null,
  },
  placeholderManifest: ["name", "venue"],
  createdAt: "2026-09-05",
};
const table: SpreadsheetTable = {
  format: "csv",
  fileName: "members.csv",
  worksheetIndex: 0,
  worksheetName: "members.csv",
  headerRow: 1,
  columns: [
    { key: "email", label: "Email", sourceColumn: 1 },
    { key: "full_name", label: "Full name", sourceColumn: 2 },
  ],
  rows: [
    {
      sourceRow: 2,
      values: { email: "recipient@example.test", full_name: "Member" },
      rawValues: ["recipient@example.test", "Member"],
    },
  ],
};
const response = {
  campaign: { id: "campaign-1" },
  counts: { pending: 1 },
} as CampaignResponse;
const api: ApiContextValue = {
  status: "authenticated",
  user: {
    id: "user-1",
    displayName: "Member",
    principalName: "member@student.example",
    mailboxAddress: "member@student.example",
  },
  csrfToken: "synthetic-csrf",
  config: { defaultPacePerMinute: 12, maxCampaignRecipients: 300 },
  isLive: true,
  dashboard: { status: "idle", flows: null, campaigns: null, error: "" },
  refreshDashboard: vi.fn(async () => {}),
  setSession: vi.fn(),
};
function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <ApiContext.Provider value={api}>
      <DraftProvider>{children}</DraftProvider>
    </ApiContext.Provider>
  );
}
function setup() {
  const hook = renderHook(
    () => ({ state: useDraft(), ensure: useEnsureCampaign() }),
    { wrapper },
  );
  act(() => {
    hook.result.current.state.setTable(table);
    hook.result.current.state.setDraft((current) => ({
      ...current,
      fileName: table.fileName!,
      rowCount: 1,
      toField: "email",
      subject: "Hello",
      body: "<p>Hello</p>",
    }));
    hook.result.current.state.setFlowId(flow.id);
  });
  return hook;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.mocked(createCampaign).mockResolvedValue(response);
  vi.mocked(createFlow).mockResolvedValue({ flow, templateVersion: template });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("reviewed campaign lifecycle", () => {
  it("detects mixed address lists and uses configured pacing instead of stale draft controls", async () => {
    const configuredApi = {
      ...api,
      config: { ...api.config, defaultPacePerMinute: 8 },
    };
    const { result } = renderHook(
      () => ({ state: useDraft(), ensure: useEnsureCampaign() }),
      {
        wrapper: ({ children }) => (
          <ApiContext.Provider value={configuredApi}>
            <DraftProvider>{children}</DraftProvider>
          </ApiContext.Provider>
        ),
      },
    );
    act(() => {
      result.current.state.setTable(table);
      result.current.state.setDraft((current) => ({
        ...current,
        toField: "email",
        subject: "Hello",
        body: "<p>Hello</p>",
        cc: "one@example.test,two@example.test;three@example.test\nfour@example.test",
        separator: "semicolon",
        pace: 20,
      }));
      result.current.state.setFlowId(flow.id);
    });
    expect(result.current.state.campaignValidation?.ok).toBe(true);
    await act(async () => {
      await result.current.ensure();
    });
    const payload = vi.mocked(createCampaign).mock.calls.at(-1)![0];
    expect(payload.pacePerMinute).toBe(8);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].to).toBe("recipient@example.test");
    expect(payload.rows[0].cc).toEqual([
      "one@example.test",
      "two@example.test",
      "three@example.test",
      "four@example.test",
    ]);
  });
  it("replays an identical request after a lost creation response without publishing a template", async () => {
    vi.mocked(createCampaign)
      .mockRejectedValueOnce(new TypeError("Lost response"))
      .mockResolvedValue(response);
    const { result } = setup();
    await act(async () => {
      await expect(result.current.ensure()).rejects.toThrow("Lost response");
    });
    expect(result.current.state.snapshotLocked).toBe(true);
    await act(async () => {
      await result.current.ensure();
    });
    expect(vi.mocked(createCampaign).mock.calls[0][0]).toEqual(
      vi.mocked(createCampaign).mock.calls[1][0],
    );
    expect(
      vi.mocked(createCampaign).mock.calls[0][0].templateVersionId,
    ).toBeNull();
    expect(createTemplateVersion).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.ensure();
    });
    expect(createCampaign).toHaveBeenCalledTimes(2);
  });
  it("refuses a stale snapshot and prepares edited content under a new key after restart", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.ensure();
    });
    const first = vi.mocked(createCampaign).mock.calls[0][0];
    act(() => result.current.state.updateDraft("subject", "Changed"));
    await act(async () => {
      await expect(result.current.ensure()).rejects.toThrow(
        "changed after preparation",
      );
    });
    expect(createCampaign).toHaveBeenCalledTimes(1);
    act(() => result.current.state.restartFromMessage?.());
    await act(async () => {
      await result.current.ensure();
    });
    const second = vi.mocked(createCampaign).mock.calls[1][0];
    expect(second.subjectTemplate).toBe("Changed");
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.rows[0].renderedSubject).toBe("Changed");
  });
  it("coalesces simultaneous preparation actions", async () => {
    const { result } = setup();
    await act(async () => {
      await Promise.all([result.current.ensure(), result.current.ensure()]);
    });
    expect(createCampaign).toHaveBeenCalledTimes(1);
  });
  it("recovers the send's owner-scoped draft flow when its creation response was lost", async () => {
    const { result } = setup();
    act(() => result.current.state.setFlowId(null));
    vi.mocked(createFlow)
      .mockRejectedValueOnce(new TypeError("Lost flow response"))
      .mockRejectedValueOnce(
        new ApiRequestError(409, { error: { code: "flow_name_conflict" } }),
      );
    await act(async () => {
      await expect(result.current.ensure()).rejects.toThrow(
        "Lost flow response",
      );
    });
    const name = vi.mocked(createFlow).mock.calls[0][0].name;
    vi.mocked(getFlows).mockResolvedValue({
      flows: [{ ...flow, name, currentTemplateVersionId: null }],
    });
    await act(async () => {
      await result.current.ensure();
    });
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createCampaign).mock.calls[0][0].flowId).toBe(flow.id);
  });
});

describe("template reuse and field resolution", () => {
  it("preserves the current recipient file and To choice while detecting unavailable values", () => {
    const { result } = setup();
    const current = result.current.state.draft;
    const next = applyTemplate(current, flow, template, table);
    expect(next.fileName).toBe("members.csv");
    expect(next.toField).toBe("email");
    expect(next.importance).toBe("high");
    expect(next.cc).toBe("organiser@example.test");
    expect(missingMessageFields(next, table)).toEqual(["name", "venue"]);
    expect(next.mappings.name).toBe("");
  });
  it("blocks missing columns globally even when row skipping is selected", () => {
    const { result } = setup();
    act(() => {
      result.current.state.setDraft((current) =>
        applyTemplate(current, flow, template, table),
      );
      result.current.state.setSkipInvalidRows(true);
    });
    expect(result.current.state.campaignValidation?.ok).toBe(false);
    expect(
      result.current.state.campaignValidation?.issues.some(
        (issue) => issue.row === undefined,
      ),
    ).toBe(true);
  });
  it("maps an existing column and escapes fixed text in every body reference", () => {
    const { result } = setup();
    act(() => {
      let next = applyTemplate(
        result.current.state.draft,
        flow,
        template,
        table,
      );
      next = { ...next, mappings: { ...next.mappings, name: "full_name" } };
      next = replaceMessageField(next, "venue", "Room <A> & B");
      result.current.state.setDraft(next);
    });
    expect(result.current.state.campaignValidation?.ok).toBe(true);
    expect(result.current.state.bodyHtml).toContain("Room &lt;A&gt; &amp; B");
    expect(missingMessageFields(result.current.state.draft, table)).toEqual([]);
  });
  it("automatically connects an unambiguous field inserted from the current spreadsheet", () => {
    const { result } = setup();
    act(() =>
      result.current.state.updateDraft("body", "<p>Hello {{full_name}}</p>"),
    );
    expect(result.current.state.mapping.placeholders).toEqual({
      full_name: "full_name",
    });
    expect(result.current.state.campaignValidation?.ok).toBe(true);
  });
  it("does not let unused mappings from an older template block the new message", () => {
    const { result } = setup();
    act(() =>
      result.current.state.updateDraft("mappings", {
        obsolete: "missing_column",
      }),
    );
    expect(result.current.state.mapping.placeholders).toEqual({});
    expect(result.current.state.campaignValidation?.ok).toBe(true);
  });
});
