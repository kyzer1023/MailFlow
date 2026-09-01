import { describe, expect, it } from "vitest";
import type { MailMessage, MailProvider } from "../../domain/mail-provider";
import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";
import type { CampaignTickDependencies } from "./contracts";
import { handleCampaignQueueMessage, processCampaignTick } from "./campaign-tick";

function makeCampaign(state: CampaignRecord["state"] = "queued"): CampaignRecord {
  return {
    id: "campaign-1",
    flowId: "flow-1",
    templateVersionId: "template-1",
    ownerUserId: "user-1",
    senderAddress: "sender@example.com",
    sourceFilename: null,
    totalRecipients: 1,
    validRecipients: 1,
    skippedRecipients: 0,
    pacePerMinute: 12,
    state,
    pauseReason: null,
    idempotencyKey: "idempotency-1",
    createdAt: "2026-08-31T00:00:00.000Z",
    queuedAt: "2026-08-31T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function makeJob(): RecipientJobRecord {
  return {
    id: "job-1",
    campaignId: "campaign-1",
    sourceRow: 1,
    recipient: "recipient@example.com",
    cc: [],
    bcc: [],
    replyTo: [],
    mergeData: {},
    renderedSubject: "Hello",
    renderedBodyHtml: "<p>Hello</p>",
    sendKey: "campaign-1:1",
    status: "pending",
    attemptCount: 0,
    claimToken: null,
    claimedAt: null,
    sendingAt: null,
    acceptedAt: null,
    nextAttemptAt: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    providerMessageId: null,
    providerRequestId: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function dependencies(provider: MailProvider): CampaignTickDependencies & { state: { campaign: CampaignRecord; job: RecipientJobRecord } } {
  const state = { campaign: makeCampaign(), job: makeJob() };
  return {
    state,
    campaigns: {
      getById: async () => state.campaign,
      getByIdForOwner: async () => state.campaign,
      getByIdempotencyKey: async () => state.campaign,
      listByOwner: async () => [],
      create: async () => undefined,
      markValidated: async () => false,
      queue: async () => false,
      markRunningIfQueued: async () => {
        state.campaign = { ...state.campaign, state: "running" };
        return true;
      },
      pause: async () => false,
      resume: async () => false,
      fail: async (_id, now, reason) => {
        if (["queued", "running", "paused"].includes(state.campaign.state)) {
          state.campaign = { ...state.campaign, state: "failed", pauseReason: reason, updatedAt: now };
          return true;
        }
        return false;
      },
      completeIfExhausted: async () => false,
    },
    recipientJobs: {
      getById: async () => state.job,
      listByCampaign: async () => [state.job],
      claimNextPending: async (_campaignId, now, claimToken) => {
        if (state.job.status !== "pending") return null;
        state.job = { ...state.job, status: "claimed", attemptCount: 1, claimToken, claimedAt: now };
        return state.job;
      },
      markSending: async (_id, claimToken, now) => {
        if (state.job.claimToken !== claimToken || state.job.status !== "claimed") return false;
        state.job = { ...state.job, status: "sending", sendingAt: now };
        return true;
      },
      markAccepted: async (_id, claimToken, now, providerMessageId, providerRequestId) => {
        if (state.job.claimToken !== claimToken || state.job.status !== "sending") return false;
        state.job = { ...state.job, status: "accepted", acceptedAt: now, claimToken: null, providerMessageId, providerRequestId };
        return true;
      },
      markFailed: async () => false,
      scheduleSafeRetry: async () => false,
      markUnknown: async (_id, claimToken, now, category, message, providerRequestId) => {
        if (state.job.claimToken !== claimToken || state.job.status !== "sending") return false;
        state.job = { ...state.job, status: "unknown", claimToken: null, updatedAt: now, lastErrorCategory: category, lastErrorMessage: message, providerRequestId };
        return true;
      },
      markSkipped: async () => false,
      counts: async () => ({ pending: 0, claimed: 0, sending: 0, accepted: 1, failed: 0, skipped: 0, unknown: 0 }),
    },
    queue: {
      enqueue: async () => undefined,
    },
    attachmentLoader: async () => [],
    attachmentCleanup: async () => undefined,
    mailProvider: provider,
    now: () => new Date("2026-08-31T00:01:00.000Z"),
    claimToken: () => "claim-1",
  };
}

describe("campaign tick", () => {
  it("rejects malformed queue payloads without reading unsafe fields", async () => {
    const provider: MailProvider = { send: async () => ({ kind: "accepted" }) };
    const deps = dependencies(provider);
    await expect(handleCampaignQueueMessage({ type: "campaign.tick", campaignId: null }, deps)).resolves.toEqual({
      kind: "ignored",
      reason: "not_runnable",
    });
    await expect(handleCampaignQueueMessage({ type: "campaign.tick", campaignId: 42 }, deps)).resolves.toEqual({
      kind: "ignored",
      reason: "not_runnable",
    });
  });

  it("claims exactly one job and records accepted by Microsoft", async () => {
    const provider: MailProvider = {
      send: async (message: MailMessage) => {
        expect(message.to).toBe("recipient@example.com");
        return { kind: "accepted", providerRequestId: "request-1" };
      },
    };
    const deps = dependencies(provider);
    const result = await processCampaignTick({ type: "campaign.tick", campaignId: "campaign-1" }, deps);
    expect(result.kind).toBe("scheduled");
    expect(deps.state.job.status).toBe("accepted");
  });

  it("loads and forwards one immutable attachment set to Graph", async () => {
    const first = Uint8Array.from([1, 2, 3]);
    const second = Uint8Array.from([250, 0, 9]);
    let calls = 0;
    const provider: MailProvider = {
      send: async (message: MailMessage) => {
        calls += 1;
        expect(message.attachments?.map((attachment) => attachment.name)).toEqual(["one.txt", "two.bin"]);
        expect([...((message.attachments?.[0]?.content) ?? [])]).toEqual([...first]);
        expect([...((message.attachments?.[1]?.content) ?? [])]).toEqual([...second]);
        return { kind: "accepted" };
      },
    };
    const deps = dependencies(provider);
    deps.attachmentLoader = async () => [
      { name: "one.txt", contentType: "text/plain", content: first },
      { name: "two.bin", contentType: "application/octet-stream", content: second },
    ];
    await expect(processCampaignTick("campaign-1", deps)).resolves.toMatchObject({ kind: "scheduled", outcome: "accepted" });
    expect(calls).toBe(1);
  });

  it("fails before claiming a recipient when attachment integrity cannot be verified", async () => {
    const provider: MailProvider = { send: async () => ({ kind: "accepted" }) };
    const deps = dependencies(provider);
    let cleanupCalls = 0;
    deps.attachmentLoader = async () => {
      throw new Error("missing private object");
    };
    deps.attachmentCleanup = async () => {
      cleanupCalls += 1;
    };
    await expect(processCampaignTick("campaign-1", deps)).resolves.toEqual({
      kind: "failed",
      campaignId: "campaign-1",
      reason: "attachments_unavailable",
    });
    expect(deps.state.job.status).toBe("pending");
    expect(deps.state.campaign.state).toBe("failed");
    expect(cleanupCalls).toBe(1);
  });

  it("turns a provider exception into unknown with no automatic retry", async () => {
    const provider: MailProvider = {
      send: async () => {
        throw new Error("connection reset");
      },
    };
    const deps = dependencies(provider);
    const result = await processCampaignTick("campaign-1", deps);
    expect(result.kind).toBe("scheduled");
    expect(result.kind === "scheduled" && result.outcome).toBe("unknown");
    expect(deps.state.job.status).toBe("unknown");
  });
});
