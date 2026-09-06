import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import type { MailFlowAppEnv } from "./context";
import { registerCampaignMutationRoutes } from "./routes/campaign-mutations";
import { AuthFlowError } from "../auth/service";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), resume: vi.fn(), enqueue: vi.fn(),
  campaign: { id: "campaign", ownerUserId: "owner", state: "paused", mailIssueCode: "mail_authorization_required" },
}));
vi.mock("./dependencies", async original => ({ ...(await original<typeof import("./dependencies")>()),
  configFor: () => ({ auth: { refreshUserAccessToken: mocks.refresh } }),
  repositories: () => ({ campaigns: { getByIdForOwner: async () => mocks.campaign, getById: async () => mocks.campaign,
    resume: mocks.resume }, attachments: { getSetByCampaignId: async () => null } }),
}));
vi.mock("./helpers", async original => ({ ...(await original<typeof import("./helpers")>()),
  requireMutationSession: async () => ({ user: { id: "owner" } }), enqueueTick: mocks.enqueue, audit: async () => {},
}));
const app = new Hono<MailFlowAppEnv>();
registerCampaignMutationRoutes(app);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.refresh.mockReset().mockResolvedValue({ accessToken: "synthetic" });
  mocks.resume.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue({ published: true });
});
it.each([
  [new AuthFlowError("token", "private grant details"), 409, "mail_reconnect_required"],
  [new TypeError("private URL"), 503, "mail_authorization_unavailable"],
] as const)("leaves the campaign paused when refreshing authorization fails", async (failure, status, code) => {
  mocks.refresh.mockRejectedValue(failure);
  const response = await app.request("/api/campaigns/campaign/resume", { method: "POST" });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("checks the owner's recovered grant before resuming and publishing a wake", async () => {
  const response = await app.request("/api/campaigns/campaign/resume", { method: "POST" });
  expect(response.status).toBe(200);
  expect(mocks.refresh).toHaveBeenCalledWith("owner");
  expect(mocks.resume).toHaveBeenCalledWith("campaign", "owner", expect.any(String));
  expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.resume.mock.invocationCallOrder[0]);
  expect(mocks.enqueue).toHaveBeenCalledOnce();
});
