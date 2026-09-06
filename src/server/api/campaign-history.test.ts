import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import type { MailFlowAppEnv } from "./context";
import { registerCampaignListRoute } from "./routes/campaign-reads";
import { historyCursor, parseHistoryCursor } from "./campaign-pagination";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./dependencies", async original => ({ ...(await original<typeof import("./dependencies")>()),
  repositories: () => ({ campaigns: { listByOwner: mocks.list } }),
}));
vi.mock("./helpers", async original => ({ ...(await original<typeof import("./helpers")>()),
  requireSession: async () => ({ user: { id: "owner" } }),
}));
const app = new Hono<MailFlowAppEnv>();
registerCampaignListRoute(app);
const row = (id: string) => ({ id, createdAt: "2026-09-06T00:00:00.000Z", state: "completed",
  idempotencyKey: "private-key", wakeToken: "private-wake", requestFingerprint: "private-fingerprint",
  futureInternalColumn: "must-not-leak", counts: { accepted: 1 } });
beforeEach(() => mocks.list.mockReset());

it("returns bounded pages, explicit public fields and an owner-scoped continuation", async () => {
  mocks.list.mockResolvedValue([row("c"), row("b"), row("a")]);
  const response = await app.request("/api/campaigns?limit=2");
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("owner", 3, null);
  expect(body.campaigns).toEqual(["c", "b"].map(id => ({ id, createdAt: row(id).createdAt, state: "completed", counts: { accepted: 1 } })));
  expect(parseHistoryCursor(body.nextCursor)).toEqual({ id: "b", createdAt: row("b").createdAt });
  mocks.list.mockResolvedValue([row("a")]);
  const next = await app.request(`/api/campaigns?limit=2&before=${body.nextCursor}`);
  expect(mocks.list).toHaveBeenLastCalledWith("owner", 3, { id: "b", createdAt: row("b").createdAt });
  expect((await next.json()).nextCursor).toBeNull();
});

it.each(["", "%", "a".repeat(513), btoa("null"), btoa(JSON.stringify({ id: "bad id", createdAt: "yesterday" }))])(
  "rejects malformed cursors before reading history (%s)", async cursor => {
    expect((await app.request(`/api/campaigns?before=${encodeURIComponent(cursor)}`)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it("round trips generated cursors", () => {
  const cursor = { id: "campaign_123-abc", createdAt: "2026-09-06T00:00:00.000Z" };
  expect(parseHistoryCursor(historyCursor(cursor))).toEqual(cursor);
});
