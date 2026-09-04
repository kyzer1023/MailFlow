import type { AuditEventType } from "../../domain/types";
import { sha256Base64Url } from "../auth/crypto";
import type {
  PublicControlStore,
  StoredTestSendResult,
  StoredTestSendFailure,
  StoredTestSendRecord,
} from "../database/d1-public-controls";

export const TEST_SEND_RATE_LIMIT = 5;
export const TEST_SEND_RATE_WINDOW_MS = 10 * 60 * 1000;

export interface TestSendFingerprintInput {
  readonly campaignId: string;
  readonly subject: string;
  readonly bodyHtml: string;
  readonly importance: "low" | "normal" | "high";
  readonly attachmentSetId: string | null;
}

export interface ControlledTestSendInput extends TestSendFingerprintInput {
  readonly ownerUserId: string;
  readonly idempotencyKey: string;
}

export interface TestSendAuditInput {
  readonly eventType: Extract<AuditEventType, `test_send.${string}`>;
  readonly campaignId: string;
  readonly actorUserId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type TestSendAudit = (input: TestSendAuditInput) => Promise<void>;
export interface ClassifiedTestSendFailure {
  readonly failure: StoredTestSendFailure;
  /** True only when the failure happened before submission or proves no acceptance. */
  readonly safeToRetry: boolean;
}
export type TestSendFailureClassifier = (error: unknown) => ClassifiedTestSendFailure;

export class ControlledTestSendError extends Error {
  constructor(readonly failure: StoredTestSendFailure) {
    super(failure.message);
    this.name = "ControlledTestSendError";
  }
}

export async function testSendFingerprint(input: TestSendFingerprintInput): Promise<string> {
  return sha256Base64Url(JSON.stringify({
    campaignId: input.campaignId,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    importance: input.importance,
    attachmentSetId: input.attachmentSetId,
  }));
}

function replay(record: StoredTestSendRecord, fingerprint: string): StoredTestSendResult {
  if (record.requestFingerprint !== fingerprint) {
    throw new ControlledTestSendError({
      status: 409,
      code: "test_send_key_reused",
      message: "This test request key was already used for different message content. Refresh Review and try again.",
    });
  }
  if (record.status === "accepted" && record.result) return record.result;
  if (record.status === "failed" && record.failure) throw new ControlledTestSendError(record.failure);
  if (record.status === "failed") {
    throw new ControlledTestSendError({
      status: 502,
      code: "test_send_failed",
      message: "The earlier test request failed. Start a new test from Review.",
    });
  }
  throw new ControlledTestSendError({
    status: 409,
    code: "test_send_in_progress",
    message: "This test request is already in progress. Wait for it to finish before trying again.",
  });
}

async function safeAudit(audit: TestSendAudit, input: TestSendAuditInput): Promise<void> {
  try {
    await audit(input);
  } catch {
    // A post-provider audit failure must not turn an accepted message into a
    // retryable browser error. The durable test-send result remains primary.
  }
}

export async function executeControlledTestSend(options: {
  readonly store: PublicControlStore;
  readonly input: ControlledTestSendInput;
  readonly send: (sendKey: string) => Promise<StoredTestSendResult>;
  readonly audit: TestSendAudit;
  readonly classifyFailure: TestSendFailureClassifier;
  readonly now?: () => number;
  readonly createId?: () => string;
}): Promise<{ result: StoredTestSendResult; replayed: boolean }> {
  const now = options.now?.() ?? Date.now();
  const fingerprint = await testSendFingerprint(options.input);
  const existing = await options.store.findTestSend(options.input.ownerUserId, options.input.idempotencyKey);
  if (existing) return { result: replay(existing, fingerprint), replayed: true };

  const testSendId = options.createId?.() ?? `test_send_${crypto.randomUUID()}`;
  const created = await options.store.createPendingTestSend({
    id: testSendId,
    ownerUserId: options.input.ownerUserId,
    campaignId: options.input.campaignId,
    idempotencyKey: options.input.idempotencyKey,
    requestFingerprint: fingerprint,
    now,
  });
  if (!created) {
    const concurrent = await options.store.findTestSend(options.input.ownerUserId, options.input.idempotencyKey);
    if (concurrent) return { result: replay(concurrent, fingerprint), replayed: true };
    throw new ControlledTestSendError({
      status: 409,
      code: "test_send_in_progress",
      message: "This test request is already in progress. Wait for it to finish before trying again.",
    });
  }

  const limit = await options.store.consumeRateLimit(
    "test_send",
    options.input.ownerUserId,
    now,
    TEST_SEND_RATE_WINDOW_MS,
    TEST_SEND_RATE_LIMIT,
  );
  if (!limit.allowed) {
    await options.store.removePendingTestSend(testSendId);
    await safeAudit(options.audit, {
      eventType: "test_send.rate_limited",
      campaignId: options.input.campaignId,
      actorUserId: options.input.ownerUserId,
      metadata: { retryAfterSeconds: limit.retryAfterSeconds },
    });
    throw new ControlledTestSendError({
      status: 429,
      code: "test_send_rate_limited",
      message: "Too many test messages were requested. Wait a few minutes, then try again.",
    });
  }

  try {
    await options.audit({
      eventType: "test_send.requested",
      campaignId: options.input.campaignId,
      actorUserId: options.input.ownerUserId,
      metadata: { testSendId },
    });
  } catch (error) {
    const classified = options.classifyFailure(error);
    await options.store.removePendingTestSend(testSendId);
    throw new ControlledTestSendError(classified.failure);
  }

  let result: StoredTestSendResult;
  try {
    result = await options.send(`test:${testSendId}`);
  } catch (error) {
    const classified = options.classifyFailure(error);
    if (classified.safeToRetry) await options.store.removePendingTestSend(testSendId);
    else await options.store.completeTestSendFailed(testSendId, classified.failure, options.now?.() ?? Date.now());
    await safeAudit(options.audit, {
      eventType: "test_send.failed",
      campaignId: options.input.campaignId,
      actorUserId: options.input.ownerUserId,
      metadata: { testSendId, code: classified.failure.code, safeToRetry: classified.safeToRetry },
    });
    throw new ControlledTestSendError(classified.failure);
  }

  const completed = await options.store.completeTestSendAccepted(testSendId, result, options.now?.() ?? Date.now());
  if (!completed) {
    throw new ControlledTestSendError({
      status: 503,
      code: "test_send_state_unavailable",
      message: "Microsoft may have accepted this test, but Mail Flow could not store the result. Do not resend it blindly.",
    });
  }
  await safeAudit(options.audit, {
    eventType: "test_send.accepted",
    campaignId: options.input.campaignId,
    actorUserId: options.input.ownerUserId,
    metadata: { testSendId },
  });
  return { result, replayed: false };
}
