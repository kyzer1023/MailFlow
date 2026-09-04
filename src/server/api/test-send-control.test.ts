import { describe, expect, it } from "vitest";
import type {
  PublicControlStore,
  RateLimitDecision,
  StoredTestSendFailure,
  StoredTestSendRecord,
  StoredTestSendResult,
  TestSendClaimInput,
} from "../database/d1-public-controls";
import type { MailboxDeliveryRepository, MailboxLeaseDecision, TestAttemptCompletion } from "../database/contracts";
import {
  consumeOAuthStartLimit,
  OAUTH_START_GLOBAL_RATE_LIMIT,
  OAUTH_START_RATE_LIMIT,
} from "./public-rate-limits";
import {
  ControlledTestSendError,
  executeControlledTestSend,
  TEST_SEND_RATE_LIMIT,
} from "./test-send-control";

class MemoryPublicControlStore implements PublicControlStore {
  readonly testSends = new Map<string, StoredTestSendRecord>();
  readonly counters = new Map<string, number>();
  readonly rateSubjects: string[] = [];

  private key(ownerUserId: string, idempotencyKey: string): string {
    return `${ownerUserId}:${idempotencyKey}`;
  }

  async findTestSend(ownerUserId: string, idempotencyKey: string): Promise<StoredTestSendRecord | null> {
    return this.testSends.get(this.key(ownerUserId, idempotencyKey)) ?? null;
  }

  async createPendingTestSend(input: TestSendClaimInput): Promise<boolean> {
    const key = this.key(input.ownerUserId, input.idempotencyKey);
    if (this.testSends.has(key)) return false;
    this.testSends.set(key, {
      id: input.id,
      ownerUserId: input.ownerUserId,
      campaignId: input.campaignId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      status: "pending",
      result: null,
      failure: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return true;
  }

  async removePendingTestSend(id: string): Promise<void> {
    for (const [key, value] of this.testSends) if (value.id === id && value.status === "pending") this.testSends.delete(key);
  }

  async completeTestSendAccepted(id: string, result: StoredTestSendResult, now: number): Promise<boolean> {
    for (const [key, value] of this.testSends) {
      if (value.id === id && value.status === "pending") {
        this.testSends.set(key, { ...value, status: "accepted", result, updatedAt: now });
        return true;
      }
    }
    return false;
  }

  async completeTestSendFailed(id: string, failure: StoredTestSendFailure, now: number): Promise<boolean> {
    for (const [key, value] of this.testSends) {
      if (value.id === id && value.status === "pending") {
        this.testSends.set(key, { ...value, status: "failed", failure, updatedAt: now });
        return true;
      }
    }
    return false;
  }

  async consumeRateLimit(scope: string, subjectKey: string, now: number, windowMs: number, limit: number): Promise<RateLimitDecision> {
    this.rateSubjects.push(subjectKey);
    const window = Math.floor(now / windowMs) * windowMs;
    const key = `${scope}:${subjectKey}:${window}`;
    const count = this.counters.get(key) ?? 0;
    const retryAfterSeconds = Math.max(1, Math.ceil((window + windowMs - now) / 1000));
    if (count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    this.counters.set(key, count + 1);
    return { allowed: true, remaining: limit - count - 1, retryAfterSeconds };
  }

  async cleanupExpired(): Promise<{ counters: number; staleTestSends: number }> {
    return { counters: 0, staleTestSends: 0 };
  }
}

class MemoryMailboxDelivery implements MailboxDeliveryRepository {
  decision: MailboxLeaseDecision | null = null;
  readonly completions: TestAttemptCompletion[] = [];

  constructor(private readonly store: MemoryPublicControlStore) {}

  async acquire(input: Parameters<MailboxDeliveryRepository["acquire"]>[0]): Promise<MailboxLeaseDecision> {
    return this.decision ?? {
      kind: "acquired",
      attempt: {
        id: input.attemptId,
        ownerUserId: input.ownerUserId,
        campaignId: input.campaignId,
        recipientJobId: input.recipientJobId,
        testSendId: input.testSendId,
        attemptToken: input.attemptToken,
        envelopeRecipientCount: input.envelopeRecipientCount,
        state: "reserved",
        reservedAt: input.now,
        providerBoundAt: null,
        completedAt: null,
        budgetExpiresAt: input.budgetExpiresAt,
        releaseReason: null,
        providerRequestId: null,
      },
    };
  }

  async markCampaignProviderBound(): Promise<boolean> { return false; }
  async markTestProviderBound(): Promise<boolean> { return true; }
  async completeCampaignAttempt(): Promise<boolean> { return false; }
  async recoverStale(): Promise<[]> { return []; }

  async completeTestAttempt(input: TestAttemptCompletion): Promise<boolean> {
    this.completions.push(input);
    if (input.acceptedResult) {
      return this.store.completeTestSendAccepted(input.testSendId, input.acceptedResult as StoredTestSendResult, Date.parse(input.now));
    }
    if (input.safeToRetry) {
      await this.store.removePendingTestSend(input.testSendId);
      return true;
    }
    return this.store.completeTestSendFailed(input.testSendId, input.failure as StoredTestSendFailure, Date.parse(input.now));
  }
}

const result: StoredTestSendResult = {
  status: "accepted",
  userMessage: "Accepted by Microsoft",
  senderAddress: "member@example.test",
  recipientAddress: "member@example.test",
  smtpStatus: 250,
};

const baseInput = {
  ownerUserId: "user-1",
  campaignId: "campaign-1",
  idempotencyKey: "test-key-1",
  subject: "Exact subject",
  bodyHtml: "<p>Exact body</p>",
  importance: "high" as const,
  attachmentSetId: "set-1",
};

const classifyFailure = () => ({
  safeToRetry: false,
  failure: { status: 502, code: "test_send_failed", message: "Test failed" } satisfies StoredTestSendFailure,
});

describe("test-send public controls", () => {
  it("sends an exact idempotency key once and returns the durable accepted replay", async () => {
    const store = new MemoryPublicControlStore();
    const sends: string[] = [];
    const audits: string[] = [];
    const options = {
      store,
      mailboxDelivery: new MemoryMailboxDelivery(store),
      input: baseInput,
      send: async (sendKey: string) => { sends.push(sendKey); return result; },
      audit: async ({ eventType }: { eventType: string }) => { audits.push(eventType); },
      classifyFailure,
      now: () => 1_000,
      createId: () => "test-send-1",
    };

    await expect(executeControlledTestSend(options)).resolves.toEqual({ result, replayed: false });
    await expect(executeControlledTestSend(options)).resolves.toEqual({ result, replayed: true });
    expect(sends).toEqual(["test:test-send-1"]);
    expect(audits).toEqual(["test_send.requested", "test_send.accepted"]);
    expect(store.counters.get("test_send:user-1:0")).toBe(1);
  });

  it("rejects changed effective content under a used key without another provider call", async () => {
    const store = new MemoryPublicControlStore();
    let sends = 0;
    const execute = (input = baseInput) => executeControlledTestSend({
      store,
      mailboxDelivery: new MemoryMailboxDelivery(store),
      input,
      send: async () => { sends += 1; return result; },
      audit: async () => undefined,
      classifyFailure,
      now: () => 1_000,
      createId: () => "test-send-1",
    });
    await execute();
    await expect(execute({ ...baseInput, subject: "Changed" })).rejects.toMatchObject({
      failure: { status: 409, code: "test_send_key_reused" },
    });
    expect(sends).toBe(1);
  });

  it("bounds new test attempts per user while leaving rejected claims retryable later", async () => {
    const store = new MemoryPublicControlStore();
    const audits: string[] = [];
    let sends = 0;
    for (let index = 0; index < TEST_SEND_RATE_LIMIT; index += 1) {
      await executeControlledTestSend({
        store,
        mailboxDelivery: new MemoryMailboxDelivery(store),
        input: { ...baseInput, idempotencyKey: `test-${index}` },
        send: async () => { sends += 1; return result; },
        audit: async ({ eventType }) => { audits.push(eventType); },
        classifyFailure,
        now: () => 1_000,
        createId: () => `test-send-${index}`,
      });
    }
    await expect(executeControlledTestSend({
      store,
      mailboxDelivery: new MemoryMailboxDelivery(store),
      input: { ...baseInput, idempotencyKey: "over-limit" },
      send: async () => { sends += 1; return result; },
      audit: async ({ eventType }) => { audits.push(eventType); },
      classifyFailure,
      now: () => 1_000,
      createId: () => "test-send-over-limit",
    })).rejects.toBeInstanceOf(ControlledTestSendError);
    expect(sends).toBe(TEST_SEND_RATE_LIMIT);
    expect(audits.at(-1)).toBe("test_send.rate_limited");
    expect(await store.findTestSend("user-1", "over-limit")).toBeNull();
  });

  it("allows the same stable key to retry a failure proven safe before accepting", async () => {
    const store = new MemoryPublicControlStore();
    let sends = 0;
    const execute = () => executeControlledTestSend({
      store,
      mailboxDelivery: new MemoryMailboxDelivery(store),
      input: baseInput,
      send: async () => {
        sends += 1;
        if (sends === 1) throw new Error("temporary pre-send failure");
        return result;
      },
      audit: async () => undefined,
      classifyFailure: () => ({
        safeToRetry: true,
        failure: { status: 503, code: "test_send_failed", message: "Try again" },
      }),
      now: () => 1_000,
      createId: () => `test-send-${sends + 1}`,
    });

    await expect(execute()).rejects.toMatchObject({ failure: { status: 503 } });
    expect(await store.findTestSend("user-1", "test-key-1")).toBeNull();
    await expect(execute()).resolves.toEqual({ result, replayed: false });
    expect(sends).toBe(2);
  });

  it("keeps ambiguous failures terminal so a stable key cannot duplicate a send", async () => {
    const store = new MemoryPublicControlStore();
    let sends = 0;
    const execute = () => executeControlledTestSend({
      store,
      mailboxDelivery: new MemoryMailboxDelivery(store),
      input: baseInput,
      send: async () => { sends += 1; throw new Error("ambiguous provider outcome"); },
      audit: async () => undefined,
      classifyFailure,
      now: () => 1_000,
      createId: () => "test-send-ambiguous",
    });

    await expect(execute()).rejects.toMatchObject({ failure: { status: 502 } });
    await expect(execute()).rejects.toMatchObject({ failure: { status: 502 } });
    expect(sends).toBe(1);
  });

  it("uses the mailbox rolling budget for self-only test sends", async () => {
    const store = new MemoryPublicControlStore();
    const mailboxDelivery = new MemoryMailboxDelivery(store);
    mailboxDelivery.decision = {
      kind: "unavailable",
      reason: "budget",
      nextAvailableAt: "2026-09-06T08:30:00.000Z",
    };
    const audits: string[] = [];
    let sends = 0;
    await expect(executeControlledTestSend({
      store,
      mailboxDelivery,
      input: baseInput,
      send: async () => { sends += 1; return result; },
      audit: async ({ eventType }) => { audits.push(eventType); },
      classifyFailure,
      now: () => Date.parse("2026-09-05T08:30:00.000Z"),
      createId: () => "test-send-budget",
    })).rejects.toMatchObject({
      retryAfterSeconds: 86_400,
      failure: {
        status: 429,
        code: "mailbox_daily_budget",
        message: expect.stringContaining("2026-09-06T08:30:00.000Z"),
      },
    });
    expect(sends).toBe(0);
    expect(audits).toEqual(["test_send.requested", "test_send.mailbox_waiting"]);
    expect(await store.findTestSend("user-1", "test-key-1")).toBeNull();
  });

  it("applies provider Retry-After to the shared mailbox state for a safe test-send retry", async () => {
    const store = new MemoryPublicControlStore();
    const mailboxDelivery = new MemoryMailboxDelivery(store);
    await expect(executeControlledTestSend({
      store,
      mailboxDelivery,
      input: baseInput,
      send: async () => { throw new Error("throttled before submission"); },
      audit: async () => undefined,
      classifyFailure: () => ({
        safeToRetry: true,
        category: "throttle",
        retryAfter: 120,
        failure: { status: 503, code: "test_send_failed", message: "Microsoft requested a pause" },
      }),
      pacePerMinute: 12,
      now: () => Date.parse("2026-09-05T08:30:00.000Z"),
      createId: () => "test-send-throttle",
    })).rejects.toMatchObject({ failure: { status: 503 } });

    expect(mailboxDelivery.completions).toContainEqual(expect.objectContaining({
      nextSendAt: "2026-09-05T08:32:00.000Z",
      providerBackoffUntil: "2026-09-05T08:32:00.000Z",
      safeToRetry: true,
    }));
    expect(await store.findTestSend("user-1", "test-key-1")).toBeNull();
  });

  it("bounds OAuth starts and never uses the raw client address as the counter key", async () => {
    const store = new MemoryPublicControlStore();
    for (let index = 0; index < OAUTH_START_RATE_LIMIT; index += 1) {
      await expect(consumeOAuthStartLimit(store, "secret", "203.0.113.10", 1_000)).resolves.toMatchObject({ allowed: true });
    }
    await expect(consumeOAuthStartLimit(store, "secret", "203.0.113.10", 1_000)).resolves.toMatchObject({ allowed: false });
    expect(store.rateSubjects).not.toContain("203.0.113.10");
    expect(store.rateSubjects).not.toContain("203.0.113.10");
    expect(new Set(store.rateSubjects).size).toBe(2);
  });

  it("bounds OAuth starts globally so scheduled cleanup can outpace accepted state creation", async () => {
    const store = new MemoryPublicControlStore();
    for (let index = 0; index < OAUTH_START_GLOBAL_RATE_LIMIT; index += 1) {
      const client = `203.0.113.${Math.floor(index / OAUTH_START_RATE_LIMIT) + 1}`;
      await expect(consumeOAuthStartLimit(store, "secret", client, 1_000)).resolves.toMatchObject({ allowed: true });
    }
    await expect(consumeOAuthStartLimit(store, "secret", "203.0.113.250", 1_000)).resolves.toMatchObject({ allowed: false });
  });
});
