import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipientJobRecord } from "../../domain/types";
import type { MailFlowAppEnv } from "./context";
import { registerCampaignDetailRoutes } from "./routes/campaign-reads";

const store = vi.hoisted(() => ({
  getByIdForOwner: vi.fn(),
  listByCampaign: vi.fn(),
}));

vi.mock("./dependencies", async (original) => ({
  ...(await original<typeof import("./dependencies")>()),
  repositories: () => ({
    campaigns: { getByIdForOwner: store.getByIdForOwner },
    recipientJobs: { listByCampaign: store.listByCampaign },
  }),
}));
vi.mock("./helpers", async (original) => ({
  ...(await original<typeof import("./helpers")>()),
  requireSession: async () => ({ user: { id: "owner" } }),
}));

function job(sourceRow: number): RecipientJobRecord {
  return {
    id: `job-${sourceRow}`,
    campaignId: "campaign-export",
    sourceRow,
    recipient: `member${sourceRow}@example.test`,
    cc: [],
    bcc: [],
    replyTo: [],
    mergeData: {},
    renderedSubject: "Private subject",
    renderedBodyHtml: "<p>Private message</p>",
    sendKey: `private-send-${sourceRow}`,
    status: "failed",
    attemptCount: 1,
    claimToken: null,
    claimedAt: null,
    sendingAt: null,
    acceptedAt: null,
    nextAttemptAt: null,
    lastErrorCategory: "invalid_message",
    lastErrorMessage: 'line 1, "line 2"\nline 3',
    providerMessageId: null,
    providerRequestId: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

function exportRequest() {
  const app = new Hono<MailFlowAppEnv>();
  registerCampaignDetailRoutes(app);
  return app.request(
    "https://example.test/api/campaigns/campaign-export/export.csv",
    {},
    {},
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("campaign CSV export", () => {
  it("exports member verification separately while preserving Unknown and protecting note formulas", async () => {
    store.getByIdForOwner.mockResolvedValue({ id: "campaign-export" });
    store.listByCampaign.mockResolvedValue([{ ...job(2), status: "unknown", deliveryVerifiedBy: "owner", deliveryVerifiedAt: "2026-09-05T01:00:00.000Z", deliveryVerificationNote: "=private note" }]);
    const csv = await (await exportRequest()).text();
    expect(csv).toContain("2,member2@example.test,unknown,1,");
    expect(csv).toContain("owner,2026-09-05T01:00:00.000Z,'=private note");
  });
  it("exports every owner-scoped page with quoting and formula protection", async () => {
    store.getByIdForOwner.mockResolvedValue({ id: "campaign-export" });
    const jobs = Array.from({ length: 500 }, (_, index) => job(index + 2));
    const last = {
      ...job(502),
      lastErrorMessage: '=HYPERLINK("https://example.test")',
    };
    store.listByCampaign
      .mockResolvedValueOnce(jobs)
      .mockResolvedValueOnce([last]);

    const response = await exportRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="campaign-export-results.csv"',
    );
    expect(store.getByIdForOwner).toHaveBeenCalledWith(
      "campaign-export",
      "owner",
    );
    expect(store.listByCampaign.mock.calls).toEqual([
      ["campaign-export", 500, 0],
      ["campaign-export", 500, 500],
    ]);
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toBe(
      "row_number,recipient,status,attempt_count,created_at,claimed_at,sending_at,accepted_at,last_error_category,last_error_message,delivery_verified_by,delivery_verified_at,delivery_verification_note",
    );
    expect(csv).toContain('"line 1, ""line 2""\nline 3"');
    expect(csv).toContain("502,member502@example.test,failed,1,");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).not.toMatch(/Private subject|Private message|private-send-/u);
  });

  it("does not read or export jobs when the campaign is unavailable to the owner", async () => {
    store.getByIdForOwner.mockResolvedValue(null);
    const response = await exportRequest();
    expect(response.status).toBe(404);
    expect(store.getByIdForOwner).toHaveBeenCalledWith(
      "campaign-export",
      "owner",
    );
    expect(store.listByCampaign).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "campaign_not_found" },
    });
  });
});
