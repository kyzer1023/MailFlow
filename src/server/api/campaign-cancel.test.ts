import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCsrfToken } from "../auth/session";
import { sha256Base64Url } from "../auth/crypto";
import type { MailFlowAppEnv } from "./context";
import { registerCampaignMutationRoutes } from "./routes/campaign-mutations";

const store = vi.hoisted(() => ({
  getByIdForOwner: vi.fn(), getById: vi.fn(), cancel: vi.fn(), findByTokenHash: vi.fn(),
  settleCancellations: vi.fn(), getMailboxHead: vi.fn(), send: vi.fn(),
}));
vi.mock("./dependencies", async original => ({
  ...(await original<typeof import("./dependencies")>()),
  attachmentServiceFor: () => null,
  repositories: () => ({
    users: { getById: async () => ({ id: "owner" }) },
    campaigns: store,
  }),
}));
vi.mock("../database/d1-auth", () => ({
  createD1AuthStores: () => ({ sessionStore: { findByTokenHash: store.findByTokenHash, renewByTokenHash: async () => {} } }),
}));
const token = "synthetic-session-token-at-least-32-characters";
const secret = "synthetic-session-secret";
async function request(body: unknown = { acknowledged: true }, headers: Record<string, string> = {}) {
  const app = new Hono<MailFlowAppEnv>();
  registerCampaignMutationRoutes(app);
  return app.request("https://example.test/api/campaigns/campaign/cancel", {
    method: "POST", headers: {
      "Content-Type": "application/json", Cookie: `mailflow_session=${token}`, Origin: "https://example.test",
      "X-CSRF-Token": await createCsrfToken(token, secret), ...headers,
    }, body: JSON.stringify(body),
  }, { PUBLIC_ORIGIN: "https://example.test", SESSION_SECRET: secret, CAMPAIGN_QUEUE: { send: store.send } });
}

beforeEach(async () => {
  vi.resetAllMocks();
  store.findByTokenHash.mockResolvedValue({ userId: "owner", tokenHash: await sha256Base64Url(token), createdAt: Date.now(), expiresAt: Date.now() + 60000 });
  store.getByIdForOwner.mockResolvedValue({ id: "campaign", state: "running" });
  store.getById.mockResolvedValue({ id: "campaign", state: "cancelled", cancelRequestedAt: "2026-09-05T00:00:00.000Z", cancelledAt: "2026-09-05T00:00:00.000Z" });
  store.cancel.mockResolvedValue(true);
  store.settleCancellations.mockResolvedValue([]);
  store.getMailboxHead.mockResolvedValue(null);
});

describe("campaign cancellation API", () => {
  it("requires owner confirmation and uses server time, then requests mailbox handoff", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(store.getByIdForOwner).toHaveBeenCalledWith("campaign", "owner");
    expect(store.cancel).toHaveBeenCalledWith("campaign", "owner", expect.stringMatching(/^\d{4}-/u));
    expect(store.getMailboxHead).toHaveBeenCalledWith("owner");
    expect(await response.json()).toMatchObject({ campaign: { state: "cancelled" } });
    expect(store.send).not.toHaveBeenCalled();
  });
  it.each([
    [{ Cookie: "" }, 401], [{ "X-CSRF-Token": "wrong" }, 403],
    [{ Origin: "https://other.test" }, 403], [{ "Sec-Fetch-Site": "cross-site" }, 403],
  ])("rejects absent authentication or invalid mutation protection %j", async (headers, status) => {
    expect((await request({ acknowledged: true }, headers as Record<string, string>)).status).toBe(status);
    expect(store.cancel).not.toHaveBeenCalled();
  });
  it.each([{ acknowledged: false }, {}, { acknowledged: true, ownerUserId: "other" }, { acknowledged: true, cancelledAt: "forged" }])("rejects unconfirmed or forged cancellation %j", async body => {
    expect((await request(body)).status).toBe(422);
    expect(store.cancel).not.toHaveBeenCalled();
  });
  it("rejects unavailable and terminal campaigns without claiming cancellation", async () => {
    store.getByIdForOwner.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    expect(store.cancel).not.toHaveBeenCalled();
    store.cancel.mockResolvedValueOnce(false);
    expect((await request()).status).toBe(409);
  });
  it("reports Cancelling while an existing provider-bound attempt settles", async () => {
    store.getById.mockResolvedValueOnce({ id: "campaign", state: "cancelling" });
    expect(await (await request()).json()).toMatchObject({ campaign: { state: "cancelling" } });
  });
});
