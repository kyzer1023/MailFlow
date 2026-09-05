import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCsrfToken } from "../auth/session";
import { sha256Base64Url } from "../auth/crypto";
import type { MailFlowAppEnv } from "./context";
import { registerDeliveryVerificationRoute } from "./routes/delivery-verification";

const store = vi.hoisted(() => ({
  getByIdForOwner: vi.fn(),
  verifyDelivery: vi.fn(),
  findByTokenHash: vi.fn(),
}));
vi.mock("./dependencies", async (original) => ({
  ...(await original<typeof import("./dependencies")>()),
  repositories: () => ({
    users: { getById: async () => ({ id: "owner" }) },
    campaigns: { getByIdForOwner: store.getByIdForOwner },
    recipientJobs: { verifyDelivery: store.verifyDelivery },
  }),
}));
vi.mock("../database/d1-auth", () => ({
  createD1AuthStores: () => ({
    sessionStore: {
      findByTokenHash: store.findByTokenHash,
      renewByTokenHash: async () => {},
    },
  }),
}));
const token = "synthetic-session-token-at-least-32-characters";
const secret = "synthetic-session-secret";
async function request(
  body: unknown = { confirmed: true },
  overrides: Record<string, string> = {},
) {
  const app = new Hono<MailFlowAppEnv>();
  registerDeliveryVerificationRoute(app);
  return app.request(
    "https://example.test/api/campaigns/campaign/jobs/job/delivery-verification",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `mailflow_session=${token}`,
        Origin: "https://example.test",
        "X-CSRF-Token": await createCsrfToken(token, secret),
        ...overrides,
      },
      body: JSON.stringify(body),
    },
    { PUBLIC_ORIGIN: "https://example.test", SESSION_SECRET: secret },
  );
}

beforeEach(async () => {
  vi.resetAllMocks();
  const tokenHash = await sha256Base64Url(token);
  store.findByTokenHash.mockResolvedValue({
    userId: "owner",
    tokenHash,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  store.getByIdForOwner.mockResolvedValue({ id: "campaign" });
  store.verifyDelivery.mockResolvedValue({
    id: "job",
    campaignId: "campaign",
    status: "unknown",
    attemptCount: 1,
    deliveryVerifiedBy: "owner",
    deliveryVerifiedAt: "2026-09-05T00:00:00.000Z",
    deliveryVerificationNote: "Checked receipt",
  });
});

describe("delivery verification API", () => {
  it("uses authenticated ownership and server time, exposing separate evidence", async () => {
    const response = await request({
      confirmed: true,
      note: "  Checked receipt  ",
    });
    expect(response.status).toBe(200);
    expect(store.getByIdForOwner).toHaveBeenCalledWith("campaign", "owner");
    expect(store.verifyDelivery).toHaveBeenCalledWith(
      "job",
      "campaign",
      "owner",
      expect.stringMatching(/^\d{4}-/u),
      "Checked receipt",
    );
    expect(await response.json()).toMatchObject({
      job: {
        status: "unknown",
        attemptCount: 1,
        deliveryVerifiedBy: "owner",
        deliveryVerificationNote: "Checked receipt",
      },
    });
  });
  it.each([
    [{ Cookie: "" }, 401],
    [{ "X-CSRF-Token": "wrong" }, 403],
    [{ Origin: "https://other.test" }, 403],
    [{ "Sec-Fetch-Site": "cross-site" }, 403],
  ])(
    "rejects missing authentication or mutation protection %j",
    async (headers, status) => {
      expect(
        (await request({ confirmed: true }, headers as Record<string, string>))
          .status,
      ).toBe(status);
      expect(store.verifyDelivery).not.toHaveBeenCalled();
    },
  );
  it.each([
    { confirmed: false },
    { confirmed: true, note: "x".repeat(501) },
    { confirmed: true, note: "bad\u0000note" },
    { confirmed: true, actorUserId: "other" },
    { confirmed: true, timestamp: "forged" },
  ])("rejects invalid or forged evidence", async (body) => {
    expect((await request(body)).status).toBe(422);
    expect(store.verifyDelivery).not.toHaveBeenCalled();
  });
  it("does not mutate unavailable campaigns and rejects ineligible rows", async () => {
    store.getByIdForOwner.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    expect(store.verifyDelivery).not.toHaveBeenCalled();
    store.verifyDelivery.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(409);
  });
});
