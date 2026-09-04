import { describe, expect, it } from "vitest";
import type { MailMessage, MailProvider } from "../../domain/mail-provider";
import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";
import type { MailboxLeaseDecision } from "../database/contracts";
import type { CampaignTickDependencies } from "./contracts";
import { handleCampaignQueueMessage, processCampaignTick } from "./campaign-tick";

const TICK = { type: "campaign.tick" as const, campaignId: "campaign-1", wakeToken: "wake-1" };

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
    schedulerNextAttemptAt: "2026-08-31T00:01:00.000Z",
    schedulerMessage: "Sending is queued.",
    wakeToken: "wake-1",
    wakeDueAt: "2026-08-31T00:01:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function makeJob(): RecipientJobRecord {
  return {
    id: "job-1",
    campaignId: "campaign-1",
    sourceRow: 1,
    recipient: "recipient@example.com",
    cc: ["copy@example.com"],
    bcc: ["copy@example.com"],
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

function dependencies(provider: MailProvider): CampaignTickDependencies & {
  state: { campaign: CampaignRecord; job: RecipientJobRecord; sends: number; audits: string[] };
  mailboxDecision: MailboxLeaseDecision;
} {
  const state = { campaign: makeCampaign(), job: makeJob(), sends: 0, audits: [] as string[] };
  const deps: CampaignTickDependencies & {
    state: typeof state;
    mailboxDecision: MailboxLeaseDecision;
  } = {
    state,
    mailboxDecision: {
      kind: "acquired" as const,
      attempt: {
        id: "delivery-1",
        ownerUserId: "user-1",
        campaignId: "campaign-1",
        recipientJobId: "job-1",
        testSendId: null,
        attemptToken: "attempt-1",
        envelopeRecipientCount: 3,
        state: "reserved" as const,
        reservedAt: "2026-08-31T00:01:00.000Z",
        providerBoundAt: null,
        completedAt: null,
        budgetExpiresAt: "2026-09-01T00:01:00.000Z",
        releaseReason: null,
        providerRequestId: null,
      },
    } as MailboxLeaseDecision,
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
      fail: async (_id: string, now: string, reason: string) => {
        state.campaign = { ...state.campaign, state: "failed", pauseReason: reason, updatedAt: now, wakeToken: null, wakeDueAt: null };
        return true;
      },
      completeIfExhausted: async () => false,
      reserveWake: async (_id: string, token: string, dueAt: string, message: string | null) => {
        if (state.campaign.wakeToken) return false;
        state.campaign = { ...state.campaign, wakeToken: token, wakeDueAt: dueAt, schedulerNextAttemptAt: dueAt, schedulerMessage: message };
        return true;
      },
      consumeWake: async (_id: string, token: string) => {
        if (state.campaign.wakeToken !== token) return null;
        state.campaign = { ...state.campaign, wakeToken: null, wakeDueAt: null, schedulerMessage: null };
        return state.campaign;
      },
      markSchedulerWaiting: async (_id: string, nextAttemptAt: string, message: string) => {
        state.campaign = { ...state.campaign, schedulerNextAttemptAt: nextAttemptAt, schedulerMessage: message };
        return true;
      },
      listWatchdogWakeCandidates: async () => [],
      completeExhaustedBatch: async () => [],
    },
    recipientJobs: {
      getById: async () => state.job,
      getByCampaignAndSourceRow: async () => state.job,
      listByCampaign: async () => [state.job],
      claimNextPending: async (_campaignId: string, now: string, claimToken: string) => {
        if (state.job.status !== "pending") return null;
        state.job = { ...state.job, status: "claimed", attemptCount: state.job.attemptCount + 1, claimToken, claimedAt: now };
        return state.job;
      },
      releaseClaimForWait: async (_id: string, claimToken: string, now: string, retryAt: string, category: string, message: string) => {
        if (state.job.status !== "claimed" || state.job.claimToken !== claimToken) return false;
        state.job = { ...state.job, status: "pending", claimToken: null, claimedAt: null, nextAttemptAt: retryAt, lastErrorCategory: category, lastErrorMessage: message, updatedAt: now };
        return true;
      },
      markSending: async () => false,
      markAccepted: async () => false,
      markFailed: async () => false,
      scheduleSafeRetry: async () => false,
      markUnknown: async () => false,
      markSkipped: async () => false,
      counts: async () => ({ pending: 0, claimed: 0, sending: 0, accepted: 1, failed: 0, skipped: 0, unknown: 0 }),
    },
    mailboxDelivery: {
      acquire: async () => deps.mailboxDecision,
      markCampaignProviderBound: async (_attempt: string, _job: string, claimToken: string, now: string) => {
        if (state.job.status !== "claimed" || state.job.claimToken !== claimToken) return false;
        state.job = { ...state.job, status: "sending", sendingAt: now };
        return true;
      },
      markTestProviderBound: async () => false,
      completeCampaignAttempt: async (input) => {
        if (state.job.status !== "sending" || state.job.claimToken !== input.claimToken) return false;
        if (input.outcome === "accepted") state.job = { ...state.job, status: "accepted", acceptedAt: input.now, claimToken: null, providerRequestId: input.providerRequestId ?? null };
        else if (input.outcome === "unknown") state.job = { ...state.job, status: "unknown", claimToken: null, lastErrorCategory: input.category ?? null, lastErrorMessage: input.message ?? null };
        else if (input.outcome === "retry") state.job = { ...state.job, status: "pending", claimToken: null, nextAttemptAt: input.retryAt ?? null, lastErrorCategory: input.category ?? null, lastErrorMessage: input.message ?? null };
        else state.job = { ...state.job, status: "failed", claimToken: null, lastErrorCategory: input.category ?? null, lastErrorMessage: input.message ?? null };
        state.campaign = { ...state.campaign, schedulerNextAttemptAt: input.retryAt ?? input.nextSendAt };
        return true;
      },
      completeTestAttempt: async () => false,
      recoverStale: async () => [],
    },
    audit: {
      append: async (event: { eventType: string }) => { state.audits.push(event.eventType); },
      listByCampaign: async () => [],
    },
    queue: { enqueue: async () => undefined },
    attachmentLoader: async () => [],
    attachmentCleanup: async () => undefined,
    mailProvider: { send: async (message, options) => { state.sends += 1; return provider.send(message, options); } },
    now: () => new Date("2026-08-31T00:01:00.000Z"),
    claimToken: () => "claim-1",
    attemptToken: () => "attempt-1",
    wakeToken: () => "wake-2",
  };
  return deps;
}

describe("campaign tick", () => {
  it("rejects non-minimal or oversized Queue payloads", async () => {
    const deps = dependencies({ send: async () => ({ kind: "accepted" }) });
    await expect(handleCampaignQueueMessage({ ...TICK, rows: [] }, deps)).resolves.toEqual({ kind: "ignored", reason: "not_runnable" });
    await expect(handleCampaignQueueMessage({ ...TICK, campaignId: "x".repeat(129) }, deps)).resolves.toEqual({ kind: "ignored", reason: "not_runnable" });
  });

  it("rejects malformed or tokenless queue payloads", async () => {
    const deps = dependencies({ send: async () => ({ kind: "accepted" }) });
    await expect(handleCampaignQueueMessage({ type: "campaign.tick", campaignId: "campaign-1" }, deps)).resolves.toEqual({ kind: "ignored", reason: "not_runnable" });
    await expect(handleCampaignQueueMessage({ type: "campaign.tick", campaignId: null, wakeToken: "wake-1" }, deps)).resolves.toEqual({ kind: "ignored", reason: "not_runnable" });
  });

  it("submits once for a duplicated physical wake and counts every envelope occurrence", async () => {
    const deps = dependencies({
      send: async (message: MailMessage) => {
        expect(message.to).toBe("recipient@example.com");
        return { kind: "accepted", providerRequestId: "request-1" };
      },
    });
    const first = await processCampaignTick(TICK, deps);
    const duplicate = await processCampaignTick(TICK, deps);
    expect(first).toMatchObject({ kind: "scheduled", outcome: "accepted" });
    expect(duplicate).toEqual({ kind: "ignored", reason: "stale_wake" });
    expect(deps.state.sends).toBe(1);
    expect(deps.state.job.status).toBe("accepted");
    expect(deps.mailboxDecision.kind === "acquired" && deps.mailboxDecision.attempt.envelopeRecipientCount).toBe(3);
    expect(deps.state.campaign.schedulerMessage).toContain("Mailbox pacing is active");
  });

  it("keeps a budget-blocked job pending and schedules the exact release time", async () => {
    const deps = dependencies({ send: async () => ({ kind: "accepted" }) });
    deps.mailboxDecision = { kind: "unavailable", reason: "budget", nextAvailableAt: "2026-08-31T03:00:00.000Z" };
    const result = await processCampaignTick(TICK, deps);
    expect(result).toMatchObject({ kind: "waiting", reason: "budget", nextAttemptAt: "2026-08-31T03:00:00.000Z" });
    expect(deps.state.sends).toBe(0);
    expect(deps.state.job.status).toBe("pending");
    expect(deps.state.job.lastErrorCategory).toBe("mailbox_daily_budget");
    expect(deps.state.campaign.schedulerMessage).toContain("daily mailbox allowance");
    expect(deps.state.audits).toContain("campaign.mailbox_waiting");
  });

  it("honors Retry-After later than campaign pacing and preserves a safe retry", async () => {
    const deps = dependencies({
      send: async () => ({ kind: "retryable", safeToRetry: true, category: "throttle", message: "Pause", retryAfter: 120 }),
    });
    const result = await processCampaignTick(TICK, deps);
    expect(result).toMatchObject({ kind: "scheduled", outcome: "retry_scheduled", delaySeconds: 120 });
    expect(deps.state.job.status).toBe("pending");
    expect(deps.state.job.nextAttemptAt).toBe("2026-08-31T00:03:00.000Z");
    expect(deps.state.campaign.schedulerMessage).toContain("Microsoft requested a temporary pause");
  });

  it("loads immutable attachments before claiming and forwards them", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const deps = dependencies({
      send: async (message) => {
        expect(message.attachments?.[0]?.filename).toBe("one.txt");
        expect([...(message.attachments?.[0]?.content ?? [])]).toEqual([...bytes]);
        return { kind: "accepted" };
      },
    });
    deps.attachmentLoader = async () => [{ filename: "one.txt", contentType: "text/plain", content: bytes }];
    await expect(processCampaignTick(TICK, deps)).resolves.toMatchObject({ kind: "scheduled", outcome: "accepted" });
  });

  it("fails before claiming when attachment integrity cannot be verified", async () => {
    const deps = dependencies({ send: async () => ({ kind: "accepted" }) });
    deps.attachmentLoader = async () => { throw new Error("missing private object"); };
    await expect(processCampaignTick(TICK, deps)).resolves.toEqual({ kind: "failed", campaignId: "campaign-1", reason: "attachments_unavailable" });
    expect(deps.state.job.status).toBe("pending");
    expect(deps.state.campaign.state).toBe("failed");
  });

  it("turns a provider exception into unknown with no automatic retry", async () => {
    const deps = dependencies({ send: async () => { throw new Error("connection reset"); } });
    const result = await processCampaignTick(TICK, deps);
    expect(result).toMatchObject({ kind: "scheduled", outcome: "unknown" });
    expect(deps.state.job.status).toBe("unknown");
  });
});
