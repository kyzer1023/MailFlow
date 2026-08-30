import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  claimRecipientJob,
  makeSendKey,
  markRecipientAccepted,
  markRecipientSending,
  retryRecipientSafely,
  transitionCampaign,
} from "./state";
import type { CampaignRecord, RecipientJobRecord } from "./types";

const campaign: CampaignRecord = {
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
  state: "validated",
  pauseReason: null,
  idempotencyKey: "request-1",
  createdAt: "2026-08-31T00:00:00.000Z",
  queuedAt: null,
  startedAt: null,
  completedAt: null,
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const job: RecipientJobRecord = {
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
  sendKey: makeSendKey("campaign-1", 1),
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

describe("campaign and recipient state guards", () => {
  it("allows the validated to queued to running path", () => {
    const queued = transitionCampaign(campaign, "queued", { now: "2026-08-31T00:01:00.000Z" });
    const running = transitionCampaign(queued, "running", { now: "2026-08-31T00:02:00.000Z" });
    expect(running.state).toBe("running");
    expect(running.startedAt).toBe("2026-08-31T00:02:00.000Z");
  });

  it("rejects an unsafe campaign transition", () => {
    expect(() => transitionCampaign(campaign, "completed", { now: "2026-08-31T00:01:00.000Z" })).toThrow(DomainError);
  });

  it("requires the active claim for acceptance and has no unknown retry path", () => {
    const claimed = claimRecipientJob(job, "claim-1", "2026-08-31T00:01:00.000Z");
    const sending = markRecipientSending(claimed, "claim-1", "2026-08-31T00:01:01.000Z");
    const accepted = markRecipientAccepted(sending, "claim-1", "2026-08-31T00:01:02.000Z");
    expect(accepted.status).toBe("accepted");
    expect(() => retryRecipientSafely({ ...sending, status: "unknown" }, {
      claimToken: "claim-1",
      now: "2026-08-31T00:01:03.000Z",
      retryAt: "2026-08-31T00:02:00.000Z",
      category: "ambiguous",
      message: "unknown",
    })).toThrow(DomainError);
  });
});

