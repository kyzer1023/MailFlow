import { MAILBOX_BUDGET_WINDOW_MS, MAILBOX_RECIPIENT_BUDGET, mailboxWaitMessage } from "../../domain/mailbox-scheduler";
import type { DeliveryAttemptRecord } from "../../domain/types";
import type {
  CampaignAttemptCompletion,
  D1Database,
  D1PreparedStatement,
  MailboxDeliveryRepository,
  MailboxLeaseDecision,
  MailboxLeaseRequest,
  MailboxUnavailableReason,
  RecoveryEvent,
  TestAttemptCompletion,
} from "./contracts";
import { bind, json } from "./d1-helpers";

interface MailboxStateRow {
  owner_user_id: string;
  lease_token: string | null;
  lease_attempt_id: string | null;
  lease_expires_at: string | null;
  next_send_at: string | null;
  provider_backoff_until: string | null;
  updated_at: string;
}

interface DeliveryAttemptRow {
  id: string;
  owner_user_id: string;
  campaign_id: string | null;
  recipient_job_id: string | null;
  test_send_id: string | null;
  attempt_token: string;
  envelope_recipient_count: number;
  state: DeliveryAttemptRecord["state"];
  reserved_at: string;
  provider_bound_at: string | null;
  completed_at: string | null;
  budget_expires_at: string;
  release_reason: string | null;
  provider_request_id: string | null;
}

function attemptFromRow(row: DeliveryAttemptRow): DeliveryAttemptRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    campaignId: row.campaign_id,
    recipientJobId: row.recipient_job_id,
    testSendId: row.test_send_id,
    attemptToken: row.attempt_token,
    envelopeRecipientCount: Number(row.envelope_recipient_count),
    state: row.state,
    reservedAt: row.reserved_at,
    providerBoundAt: row.provider_bound_at,
    completedAt: row.completed_at,
    budgetExpiresAt: row.budget_expires_at,
    releaseReason: row.release_reason,
    providerRequestId: row.provider_request_id,
  };
}

function guard(db: D1Database): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO mailbox_coordination_guard(singleton) SELECT 1 WHERE changes() != 1",
  );
}

function maxIso(values: readonly { reason: MailboxUnavailableReason; value: string | null | undefined }[]): {
  reason: MailboxUnavailableReason;
  value: string;
} | null {
  let selected: { reason: MailboxUnavailableReason; value: string } | null = null;
  let selectedTime = Number.NEGATIVE_INFINITY;
  for (const candidate of values) {
    if (!candidate.value) continue;
    const time = Date.parse(candidate.value);
    if (!Number.isFinite(time) || time <= selectedTime) continue;
    selected = { reason: candidate.reason, value: new Date(time).toISOString() };
    selectedTime = time;
  }
  return selected;
}

export class D1MailboxDeliveryRepository implements MailboxDeliveryRepository {
  constructor(private readonly db: D1Database) {}

  private async ensureMailbox(ownerUserId: string, now: string): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO mailbox_send_state(owner_user_id, updated_at)
         VALUES (?1, ?2) ON CONFLICT(owner_user_id) DO NOTHING`,
      ),
      [ownerUserId, now],
    ).run();
  }

  private async unavailable(request: MailboxLeaseRequest): Promise<MailboxLeaseDecision | null> {
    const state = await bind(
      this.db.prepare("SELECT * FROM mailbox_send_state WHERE owner_user_id = ?1"),
      [request.ownerUserId],
    ).first<MailboxStateRow>();
    const cancelled = await bind(this.db.prepare(`SELECT id FROM campaigns
      WHERE id = ?1 AND owner_user_id = ?2 AND cancel_requested_at IS NOT NULL`),
      [request.campaignId, request.ownerUserId]).first();
    if (cancelled) return { kind: "unavailable", reason: "lease", nextAvailableAt: request.leaseExpiresAt };
    if (request.recipientJobId) {
      const eligible = await bind(this.db.prepare(`SELECT id FROM campaign_turn_heads WHERE id = ?1 AND owner_user_id = ?2`),
        [request.campaignId, request.ownerUserId]).first();
      if (!eligible) return { kind: "unavailable", reason: "lease", nextAvailableAt: request.leaseExpiresAt };
    }
    if (!state) return { kind: "unavailable", reason: "lease", nextAvailableAt: request.leaseExpiresAt };

    const providerBoundLease = state.lease_attempt_id && state.lease_token
      ? await bind(
          this.db.prepare(
            `SELECT provider_bound_at FROM delivery_attempts
             WHERE id = ?1 AND attempt_token = ?2 AND state = 'provider_bound'`,
          ),
          [state.lease_attempt_id, state.lease_token],
        ).first<{ provider_bound_at: string | null }>()
      : null;

    const used = Number(await bind(
      this.db.prepare(
        `SELECT COALESCE(SUM(envelope_recipient_count), 0) AS used
         FROM delivery_attempts
         WHERE owner_user_id = ?1
           AND state IN ('reserved', 'provider_bound', 'accepted', 'unknown')
           AND budget_expires_at > ?2`,
      ),
      [request.ownerUserId, request.now],
    ).first<number>("used") ?? 0);

    let budgetRelease: string | null = null;
    const needed = used + request.envelopeRecipientCount - MAILBOX_RECIPIENT_BUDGET;
    if (needed > 0) {
      const release = await bind(
        this.db.prepare(
          `SELECT budget_expires_at FROM (
             SELECT id, budget_expires_at,
               SUM(envelope_recipient_count) OVER (ORDER BY budget_expires_at ASC, id ASC) AS released
             FROM delivery_attempts
             WHERE owner_user_id = ?1
               AND state IN ('reserved', 'provider_bound', 'accepted', 'unknown')
               AND budget_expires_at > ?2
           ) WHERE released >= ?3
           ORDER BY budget_expires_at ASC LIMIT 1`,
        ),
        [request.ownerUserId, request.now, needed],
      ).first<{ budget_expires_at: string }>();
      budgetRelease = release?.budget_expires_at ?? request.budgetExpiresAt;
    }

    const nowTime = Date.parse(request.now);
    const candidates = [
      {
        reason: "lease" as const,
        value: providerBoundLease
          ? (state.lease_expires_at && Date.parse(state.lease_expires_at) > nowTime
              ? state.lease_expires_at
              : request.leaseExpiresAt)
          : state.lease_token && state.lease_expires_at && Date.parse(state.lease_expires_at) > nowTime
            ? state.lease_expires_at
            : null,
      },
      { reason: "provider_backoff" as const, value: state.provider_backoff_until && Date.parse(state.provider_backoff_until) > nowTime ? state.provider_backoff_until : null },
      { reason: "pace" as const, value: state.next_send_at && Date.parse(state.next_send_at) > nowTime ? state.next_send_at : null },
      { reason: "pace" as const, value: request.campaignNotBefore && Date.parse(request.campaignNotBefore) > nowTime ? request.campaignNotBefore : null },
      { reason: "budget" as const, value: budgetRelease },
    ];
    const blocked = maxIso(candidates);
    return blocked ? { kind: "unavailable", reason: blocked.reason, nextAvailableAt: blocked.value } : null;
  }

  async acquire(request: MailboxLeaseRequest): Promise<MailboxLeaseDecision> {
    if (!Number.isInteger(request.envelopeRecipientCount) || request.envelopeRecipientCount < 1) {
      throw new RangeError("Envelope recipient count must be a positive integer.");
    }
    await this.ensureMailbox(request.ownerUserId, request.now);
    const blocked = await this.unavailable(request);
    if (blocked) return blocked;

    const lease = bind(
      this.db.prepare(
        `UPDATE mailbox_send_state
         SET lease_token = ?1, lease_attempt_id = ?2, lease_expires_at = ?3, updated_at = ?4
         WHERE owner_user_id = ?5
           AND (lease_token IS NULL OR lease_expires_at <= ?4)
           AND NOT EXISTS (
             SELECT 1 FROM delivery_attempts AS active_attempt
             WHERE active_attempt.id = mailbox_send_state.lease_attempt_id
               AND active_attempt.attempt_token = mailbox_send_state.lease_token
               AND active_attempt.state = 'provider_bound'
           )
           AND (next_send_at IS NULL OR next_send_at <= ?4)
           AND (provider_backoff_until IS NULL OR provider_backoff_until <= ?4)
           AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ?10 AND c.owner_user_id = ?5 AND c.cancel_requested_at IS NULL)
           AND (?9 IS NULL OR EXISTS (SELECT 1 FROM campaign_turn_heads h WHERE h.id = ?10 AND h.owner_user_id = ?5))
           AND (?6 IS NULL OR ?6 <= ?4)
           AND (
             SELECT COALESCE(SUM(envelope_recipient_count), 0)
             FROM delivery_attempts
             WHERE owner_user_id = ?5
               AND state IN ('reserved', 'provider_bound', 'accepted', 'unknown')
               AND budget_expires_at > ?4
           ) + ?7 <= ?8`,
      ),
      [
        request.attemptToken,
        request.attemptId,
        request.leaseExpiresAt,
        request.now,
        request.ownerUserId,
        request.campaignNotBefore ?? null,
        request.envelopeRecipientCount,
        MAILBOX_RECIPIENT_BUDGET,
        request.recipientJobId,
        request.campaignId,
      ],
    );
    const insertAttempt = bind(
      this.db.prepare(
        `INSERT INTO delivery_attempts
         (id, owner_user_id, campaign_id, recipient_job_id, test_send_id, attempt_token,
          envelope_recipient_count, state, reserved_at, budget_expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'reserved', ?8, ?9
         FROM mailbox_send_state
         WHERE owner_user_id = ?2 AND lease_token = ?6 AND lease_attempt_id = ?1`,
      ),
      [
        request.attemptId,
        request.ownerUserId,
        request.campaignId,
        request.recipientJobId,
        request.testSendId,
        request.attemptToken,
        request.envelopeRecipientCount,
        request.now,
        request.budgetExpiresAt,
      ],
    );

    try {
      await this.db.batch([lease, guard(this.db), insertAttempt, guard(this.db)]);
    } catch (error) {
      const concurrentDecision = await this.unavailable(request);
      if (concurrentDecision) return concurrentDecision;
      throw error;
    }
    const row = await bind(
      this.db.prepare("SELECT * FROM delivery_attempts WHERE attempt_token = ?1"),
      [request.attemptToken],
    ).first<DeliveryAttemptRow>();
    if (!row) throw new Error("Mailbox attempt reservation was not persisted");
    return { kind: "acquired", attempt: attemptFromRow(row) };
  }

  async markCampaignProviderBound(
    attemptToken: string,
    recipientJobId: string,
    claimToken: string,
    now: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    const providerBudgetExpiresAt = new Date(Date.parse(now) + MAILBOX_BUDGET_WINDOW_MS).toISOString();
    try {
      await this.db.batch([
        bind(
          this.db.prepare(
            `UPDATE delivery_attempts SET state = 'provider_bound', provider_bound_at = ?1, budget_expires_at = ?2
             WHERE attempt_token = ?3 AND recipient_job_id = ?4 AND state = 'reserved'
               AND campaign_id IN (SELECT id FROM campaign_turn_heads WHERE state = 'running')`,
          ),
          [now, providerBudgetExpiresAt, attemptToken, recipientJobId],
        ),
        guard(this.db),
        bind(
          this.db.prepare(
            `UPDATE recipient_jobs SET status = 'sending', sending_at = ?1, updated_at = ?1
             WHERE id = ?2 AND status = 'claimed' AND claim_token = ?3`,
          ),
          [now, recipientJobId, claimToken],
        ),
        guard(this.db),
        bind(
          this.db.prepare(
            `UPDATE mailbox_send_state SET lease_expires_at = ?1, updated_at = ?2
             WHERE lease_token = ?3`,
          ),
          [leaseExpiresAt, now, attemptToken],
        ),
        guard(this.db),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async markTestProviderBound(attemptToken: string, testSendId: string, now: string, leaseExpiresAt: string): Promise<boolean> {
    const providerBudgetExpiresAt = new Date(Date.parse(now) + MAILBOX_BUDGET_WINDOW_MS).toISOString();
    try {
      await this.db.batch([
        bind(
          this.db.prepare(
            `UPDATE delivery_attempts SET state = 'provider_bound', provider_bound_at = ?1, budget_expires_at = ?2
             WHERE attempt_token = ?3 AND test_send_id = ?4 AND state = 'reserved'
               AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = delivery_attempts.campaign_id AND c.cancel_requested_at IS NULL)`,
          ),
          [now, providerBudgetExpiresAt, attemptToken, testSendId],
        ),
        guard(this.db),
        bind(
          this.db.prepare(
            `UPDATE mailbox_send_state SET lease_expires_at = ?1, updated_at = ?2
             WHERE lease_token = ?3`,
          ),
          [leaseExpiresAt, now, attemptToken],
        ),
        guard(this.db),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async completeCampaignAttempt(input: CampaignAttemptCompletion): Promise<boolean> {
    const category = input.category?.slice(0, 100) ?? null;
    const message = input.message?.slice(0, 500) ?? null;
    let job: D1PreparedStatement;
    let attemptState: "accepted" | "unknown" | "not_submitted";
    if (input.outcome === "accepted") {
      job = bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'accepted', accepted_at = ?1, claim_token = NULL,
           last_error_category = NULL, last_error_message = NULL,
           provider_message_id = ?2, provider_request_id = ?3, updated_at = ?1
         WHERE id = ?4 AND status = 'sending' AND claim_token = ?5`,
      ), [input.now, input.providerMessageId ?? null, input.providerRequestId ?? null, input.recipientJobId, input.claimToken]);
      attemptState = "accepted";
    } else if (input.outcome === "unknown") {
      job = bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'unknown', claim_token = NULL,
           last_error_category = ?1, last_error_message = ?2, provider_request_id = ?3, updated_at = ?4
         WHERE id = ?5 AND status = 'sending' AND claim_token = ?6`,
      ), [category, message, input.providerRequestId ?? null, input.now, input.recipientJobId, input.claimToken]);
      attemptState = "unknown";
    } else if (input.outcome === "retry" || input.outcome === "pause") {
      job = bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL,
           sending_at = NULL, next_attempt_at = ?1, last_error_category = ?2,
           last_error_message = ?3, provider_request_id = ?4, updated_at = ?5
         WHERE id = ?6 AND status = 'sending' AND claim_token = ?7`,
      ), [input.retryAt ?? input.nextSendAt, category, message, input.providerRequestId ?? null, input.now, input.recipientJobId, input.claimToken]);
      attemptState = "not_submitted";
    } else {
      job = bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'failed', claim_token = NULL,
           last_error_category = ?1, last_error_message = ?2, provider_request_id = ?3, updated_at = ?4
         WHERE id = ?5 AND status = 'sending' AND claim_token = ?6`,
      ), [category, message, input.providerRequestId ?? null, input.now, input.recipientJobId, input.claimToken]);
      attemptState = "not_submitted";
    }
    const nextCampaignAt = input.outcome === "retry" ? (input.retryAt ?? input.nextSendAt) : input.nextSendAt;
    const schedulerMessage = input.outcome === "retry"
      ? input.providerBackoffUntil
        ? mailboxWaitMessage("provider_backoff", nextCampaignAt)
        : `A safe retry is waiting. Sending will continue after ${nextCampaignAt}.`
      : mailboxWaitMessage("pace", nextCampaignAt);
    try {
      await this.db.batch([
        job,
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE delivery_attempts
           SET state = ?1, completed_at = ?2, release_reason = ?3, provider_request_id = ?4
           WHERE attempt_token = ?5 AND state = 'provider_bound'`,
        ), [attemptState, input.now, attemptState === "not_submitted" ? (category ?? input.outcome) : null, input.providerRequestId ?? null, input.attemptToken]),
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE mailbox_send_state
           SET lease_token = NULL, lease_attempt_id = NULL, lease_expires_at = NULL,
               next_send_at = CASE WHEN next_send_at IS NULL OR next_send_at < ?1 THEN ?1 ELSE next_send_at END,
               provider_backoff_until = CASE
                 WHEN ?2 IS NOT NULL AND (provider_backoff_until IS NULL OR provider_backoff_until < ?2) THEN ?2
                 ELSE provider_backoff_until END,
               updated_at = ?3
           WHERE owner_user_id = ?4 AND lease_token = ?5`,
        ), [input.nextSendAt, input.providerBackoffUntil ?? null, input.now, input.ownerUserId, input.attemptToken]),
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE campaigns SET scheduler_next_attempt_at = ?1, scheduler_message = ?2, updated_at = ?3
           WHERE id = ?4 AND state = 'running'`,
        ), [nextCampaignAt, schedulerMessage, input.now, input.campaignId]),
        ...(input.outcome === "pause" ? [bind(this.db.prepare(`UPDATE campaigns
          SET state = 'paused', pause_reason = ?1, mail_issue_code = 'mail_authorization_required',
            wake_token = NULL, wake_due_at = NULL, scheduler_next_attempt_at = NULL,
            scheduler_message = NULL, updated_at = ?2
          WHERE id = ?3 AND owner_user_id = ?4 AND state IN ('queued', 'running') AND cancel_requested_at IS NULL`),
        [message, input.now, input.campaignId, input.ownerUserId])] : []),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async completeTestAttempt(input: TestAttemptCompletion): Promise<boolean> {
    const accepted = Boolean(input.acceptedResult);
    const safeFailure = Boolean(input.failure && input.safeToRetry);
    let test: D1PreparedStatement;
    if (accepted) {
      test = bind(this.db.prepare(
        `UPDATE test_sends SET status = 'accepted', result_json = ?1,
           error_status = NULL, error_code = NULL, error_message = NULL, updated_at = ?2
         WHERE id = ?3 AND status = 'pending'`,
      ), [json(input.acceptedResult), Date.parse(input.now), input.testSendId]);
    } else if (safeFailure) {
      test = bind(this.db.prepare("DELETE FROM test_sends WHERE id = ?1 AND status = 'pending'"), [input.testSendId]);
    } else {
      test = bind(this.db.prepare(
        `UPDATE test_sends SET status = 'failed', result_json = NULL,
           error_status = ?1, error_code = ?2, error_message = ?3, updated_at = ?4
         WHERE id = ?5 AND status = 'pending'`,
      ), [input.failure?.status ?? 503, input.failure?.code ?? "test_send_unknown", input.failure?.message ?? "The test outcome is unknown. Do not resend it blindly.", Date.parse(input.now), input.testSendId]);
    }
    const attemptState = accepted ? "accepted" : safeFailure ? "not_submitted" : "unknown";
    try {
      await this.db.batch([
        test,
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE delivery_attempts SET state = ?1, completed_at = ?2, release_reason = ?3
           WHERE attempt_token = ?4 AND state = 'provider_bound'`,
        ), [attemptState, input.now, safeFailure ? input.failure?.code ?? "safe_failure" : null, input.attemptToken]),
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE mailbox_send_state
           SET lease_token = NULL, lease_attempt_id = NULL, lease_expires_at = NULL,
               next_send_at = CASE WHEN next_send_at IS NULL OR next_send_at < ?1 THEN ?1 ELSE next_send_at END,
               provider_backoff_until = CASE
                 WHEN ?2 IS NOT NULL AND (provider_backoff_until IS NULL OR provider_backoff_until < ?2) THEN ?2
                 ELSE provider_backoff_until END,
               updated_at = ?3
           WHERE owner_user_id = ?4 AND lease_token = ?5`,
        ), [input.nextSendAt, input.providerBackoffUntil ?? null, input.now, input.ownerUserId, input.attemptToken]),
        guard(this.db),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async recoverStale(now: string, staleBefore: string, limit = 100): Promise<RecoveryEvent[]> {
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const events: RecoveryEvent[] = [];
    const attempts = await bind(
      this.db.prepare(
        `SELECT attempts.* FROM delivery_attempts AS attempts
         LEFT JOIN mailbox_send_state AS mailbox
           ON mailbox.lease_attempt_id = attempts.id AND mailbox.lease_token = attempts.attempt_token
         WHERE attempts.state IN ('reserved', 'provider_bound')
           AND (
             mailbox.lease_expires_at <= ?1
             OR (attempts.state = 'reserved' AND attempts.reserved_at <= ?2)
             OR (attempts.state = 'provider_bound' AND attempts.provider_bound_at <= ?2)
           )
         ORDER BY attempts.reserved_at ASC LIMIT ?3`,
      ),
      [now, staleBefore, safeLimit],
    ).all<DeliveryAttemptRow>();

    for (const attempt of attempts.results) {
      const providerBound = attempt.state === "provider_bound";
      const statements: D1PreparedStatement[] = [];
      if (attempt.recipient_job_id) {
        statements.push(bind(this.db.prepare(
          providerBound
            ? `UPDATE recipient_jobs SET status = 'unknown', claim_token = NULL,
                 last_error_category = 'recovery_unknown',
                 last_error_message = 'Mail Flow restarted after provider submission began. This row was not resent automatically.',
                 updated_at = ?1 WHERE id = ?2 AND status IN ('claimed', 'sending')`
            : `UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL,
                 sending_at = NULL, next_attempt_at = ?1, last_error_category = 'recovered_before_send',
                 last_error_message = 'Mail Flow safely recovered this row before provider submission.',
                 updated_at = ?1 WHERE id = ?2 AND status = 'claimed'`,
        ), [now, attempt.recipient_job_id]));
      } else if (attempt.test_send_id) {
        statements.push(providerBound
          ? bind(this.db.prepare(
              `UPDATE test_sends SET status = 'failed', error_status = 503,
                 error_code = 'test_send_recovery_unknown',
                 error_message = 'The test outcome is unknown after recovery. Do not resend it blindly.',
                 updated_at = ?1 WHERE id = ?2 AND status = 'pending'`,
            ), [Date.parse(now), attempt.test_send_id])
          : bind(this.db.prepare("DELETE FROM test_sends WHERE id = ?1 AND status = 'pending'"), [attempt.test_send_id]));
      }
      if (statements.length > 0) statements.push(guard(this.db));
      statements.push(
        bind(this.db.prepare(
          `UPDATE delivery_attempts SET state = ?1, completed_at = ?2, release_reason = ?3
           WHERE id = ?4 AND state = ?5`,
        ), [providerBound ? "unknown" : "not_submitted", now, providerBound ? "stale_provider_boundary" : "stale_pre_submission", attempt.id, attempt.state]),
        guard(this.db),
        bind(this.db.prepare(
          `UPDATE mailbox_send_state SET lease_token = NULL, lease_attempt_id = NULL,
             lease_expires_at = NULL, updated_at = ?1
           WHERE lease_attempt_id = ?2 AND lease_token = ?3`,
        ), [now, attempt.id, attempt.attempt_token]),
      );
      try {
        await this.db.batch(statements);
        events.push({
          kind: attempt.recipient_job_id
            ? (providerBound ? "provider_unknown" : "claimed_recovered")
            : (providerBound ? "test_unknown" : "test_released"),
          campaignId: attempt.campaign_id,
          recipientJobId: attempt.recipient_job_id,
          testSendId: attempt.test_send_id,
        });
      } catch {
        // Another watchdog or foreground completion won this conditional race.
      }
    }

    let remaining = safeLimit - events.length;
    if (remaining > 0) {
      const recovered = await bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL,
           sending_at = NULL, next_attempt_at = ?1, last_error_category = 'recovered_before_send',
           last_error_message = 'Mail Flow safely recovered this row before provider submission.', updated_at = ?1
         WHERE id IN (
           SELECT jobs.id FROM recipient_jobs AS jobs
           WHERE jobs.status = 'claimed' AND jobs.claimed_at <= ?2
             AND NOT EXISTS (
               SELECT 1 FROM delivery_attempts
               WHERE delivery_attempts.recipient_job_id = jobs.id
                 AND delivery_attempts.state IN ('reserved', 'provider_bound')
             )
           LIMIT ?3
         ) RETURNING id, campaign_id`,
      ), [now, staleBefore, remaining]).all<{ id: string; campaign_id: string }>();
      events.push(...recovered.results.map((row) => ({ kind: "claimed_recovered" as const, campaignId: row.campaign_id, recipientJobId: row.id, testSendId: null })));
      remaining = safeLimit - events.length;
    }
    if (remaining > 0) {
      const unknown = await bind(this.db.prepare(
        `UPDATE recipient_jobs SET status = 'unknown', claim_token = NULL,
           last_error_category = 'recovery_unknown',
           last_error_message = 'Mail Flow restarted after provider submission began. This row was not resent automatically.',
           updated_at = ?1
         WHERE id IN (
           SELECT jobs.id FROM recipient_jobs AS jobs
           WHERE jobs.status = 'sending' AND jobs.sending_at <= ?2
             AND NOT EXISTS (
               SELECT 1 FROM delivery_attempts
               WHERE delivery_attempts.recipient_job_id = jobs.id
                 AND delivery_attempts.state IN ('reserved', 'provider_bound')
             )
           LIMIT ?3
         ) RETURNING id, campaign_id`,
      ), [now, staleBefore, remaining]).all<{ id: string; campaign_id: string }>();
      events.push(...unknown.results.map((row) => ({ kind: "provider_unknown" as const, campaignId: row.campaign_id, recipientJobId: row.id, testSendId: null })));
      remaining = safeLimit - events.length;
    }
    if (remaining > 0) {
      const released = await bind(this.db.prepare(
        `UPDATE mailbox_send_state SET lease_token = NULL, lease_attempt_id = NULL,
           lease_expires_at = NULL, updated_at = ?1
         WHERE owner_user_id IN (
           SELECT mailbox.owner_user_id FROM mailbox_send_state AS mailbox
           LEFT JOIN delivery_attempts AS attempts ON attempts.id = mailbox.lease_attempt_id
           WHERE mailbox.lease_token IS NOT NULL AND mailbox.lease_expires_at <= ?1
             AND (attempts.id IS NULL OR attempts.state NOT IN ('reserved', 'provider_bound'))
           LIMIT ?2
         ) RETURNING owner_user_id`,
      ), [now, remaining]).all<{ owner_user_id: string }>();
      events.push(...released.results.map(() => ({ kind: "lease_released" as const, campaignId: null, recipientJobId: null, testSendId: null })));
    }
    return events;
  }
}
