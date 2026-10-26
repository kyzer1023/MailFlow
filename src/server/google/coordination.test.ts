// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { SqliteD1, type SqliteValue } from "../../../tests/helpers/sqlite-d1";
import { MAILBOX_BUDGET_WINDOW_MS } from "../../domain/mailbox-scheduler";
import { D1MailboxDeliveryRepository } from "../database/d1-mailbox-delivery";
import { createD1AuthStores } from "../database/d1-auth";
import { encryptRefreshToken } from "../microsoft/token-crypto";
import { processQueueBatch } from "../api/worker-runtime";
import { accountMailProvider } from "../api/dependencies";
import type { MailFlowBindings } from "../api/contracts";
import { GMAIL_SCOPE } from "./auth";

function run(db: SqliteD1, query: string, ...values: SqliteValue[]): void {
  db.database.prepare(query).run(...values);
}

function seedCampaign(
  db: SqliteD1,
  suffix = "1",
  existingOwner?: { userId: string; mailboxAddress: string },
  recipientCount = 1,
  provider: "google" | "microsoft" = "google",
): { userId: string; campaignId: string; jobId: string } {
  const userId = existingOwner?.userId ?? `user-${suffix}`;
  const mailboxAddress = existingOwner?.mailboxAddress ?? `member-${suffix}@example.test`;
  const flowId = `flow-${suffix}`;
  const templateId = `template-${suffix}`;
  const campaignId = `campaign-${suffix}`;
  const jobId = `job-${suffix}`;
  const now = "2026-09-05T00:00:00.000Z";
  if (!existingOwner) {
    run(db, `INSERT INTO users(id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at, provider)
      VALUES (?, 'tenant', ?, ?, ?, 'Member', 'member', ?, ?)`, userId, `object-${suffix}`, mailboxAddress, mailboxAddress, now, provider);
  }
  run(db, `INSERT INTO flows(id, owner_user_id, name, state, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)`, flowId, userId, `Flow ${suffix}`, now, now);
  run(db, `INSERT INTO template_versions(id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
    VALUES (?, ?, 1, 'Subject', '<p>Body</p>', '{}', '[]', ?)`, templateId, flowId, now);
  run(db, `INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
    total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key,
    request_fingerprint, created_at, updated_at, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, 'draft', ?, ?, ?, ?, ?)`,
    campaignId, flowId, templateId, userId, mailboxAddress, recipientCount, recipientCount, `key-${suffix}`, suffix.padEnd(43, "a").slice(0, 43), now, now, provider);
  for (let row = 1; row <= recipientCount; row += 1) {
    const rowJobId = row === 1 ? jobId : `${jobId}-${row}`;
    run(db, `INSERT INTO recipient_jobs(id, campaign_id, source_row, recipient, cc_json, bcc_json,
      rendered_subject, rendered_body_html, send_key, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, '[]', '[]', 'Subject', '<p>Body</p>', ?, 'pending', 0, ?, ?)`,
      rowJobId, campaignId, row, `to-${row}@example.test`, `send-${suffix}-${row}`, now, now);
  }
  run(db, "UPDATE campaigns SET state = 'validated' WHERE id = ?", campaignId);
  run(db, "UPDATE campaigns SET state = 'running', queued_at = ?, started_at = ? WHERE id = ?", now, now, campaignId);
  run(db, "UPDATE recipient_jobs SET status = 'claimed', attempt_count = 1, claim_token = ?, claimed_at = ? WHERE id = ?", `claim-${suffix}`, now, jobId);
  return { userId, campaignId, jobId };
}

function leaseRequest(ids: { userId: string; campaignId: string; jobId: string }, suffix: string, count = 1) {
  const now = "2026-09-05T00:00:00.000Z";
  return {
    attemptId: `delivery-${suffix}`,
    attemptToken: `attempt-${suffix}`,
    ownerUserId: ids.userId,
    campaignId: ids.campaignId,
    recipientJobId: ids.jobId,
    testSendId: null,
    envelopeRecipientCount: count,
    now,
    leaseExpiresAt: "2026-09-05T00:05:00.000Z",
    budgetExpiresAt: new Date(Date.parse(now) + MAILBOX_BUDGET_WINDOW_MS).toISOString(),
  };
}


describe("Google migration and mailbox coordination", () => {
  it("preserves existing Microsoft identity, session and encrypted grants", async () => {
    const db = new SqliteD1(); db.migrate(1, 12);
    const stores = createD1AuthStores(db);
    run(db, "INSERT INTO users(id,tenant_id,object_id,principal_name,mailbox_address,display_name,role,created_at) VALUES ('tenant:object','tenant','object','member@example.test','member@example.test','Member','member','2026-01-01')");
    await stores.tokenStore.save({ userId: "tenant:object", resource: "smtp", encryptedRefreshToken: "synthetic-ciphertext", grantedScopes: ["SMTP.Send"], accessTokenExpiresAt: 1000, encryptionVersion: 1, updatedAt: 1 });
    await stores.sessionStore.create({ userId: "tenant:object", tokenHash: "synthetic-hash", createdAt: 1, expiresAt: 2000 });
    db.migrate(13);
    expect(db.database.prepare("SELECT id, provider FROM users").get()).toMatchObject({ id: "tenant:object", provider: "microsoft" });
    expect(await stores.tokenStore.findByUserId("tenant:object", "smtp")).toMatchObject({ encryptedRefreshToken: "synthetic-ciphertext" });
    expect(await stores.sessionStore.findByTokenHash("synthetic-hash")).toMatchObject({ userId: "tenant:object" });
    expect(() => run(db,"UPDATE users SET provider='google' WHERE id='tenant:object'")).toThrow();
    db.close();
  });
  it.each([100, 200])("never grants a Gmail reservation above the configured ceiling %i", async budget => {
    const db = new SqliteD1(); db.migrate(); const ids = seedCampaign(db);
    const repository = new D1MailboxDeliveryRepository(db, budget === 200 ? 8000 : budget);
    expect(await repository.acquire(leaseRequest(ids,"over",budget+1))).toMatchObject({ kind: "unavailable", reason: "budget" });
    expect(await repository.acquire(leaseRequest(ids,"within",budget))).toMatchObject({ kind: "acquired" });
    expect(Number(db.database.prepare("SELECT SUM(envelope_recipient_count) AS count FROM delivery_attempts").get()?.count)).toBe(budget);
    expect(() => run(db,"UPDATE campaigns SET provider='microsoft' WHERE id=?",ids.campaignId)).toThrow();
    db.close();
  });
  it("retains accepted and Unknown charges across campaigns and self-tests", async () => {
    const db = new SqliteD1(); db.migrate(); const ids = seedCampaign(db);
    for (const state of ["accepted", "unknown"]) run(db, `INSERT INTO delivery_attempts(id,owner_user_id,campaign_id,recipient_job_id,attempt_token,envelope_recipient_count,state,reserved_at,budget_expires_at)
      VALUES (?,?,?,?,?,50,?,'2026-09-05T00:00:00.000Z','2026-09-06T00:00:00.000Z')`, state,ids.userId,ids.campaignId,ids.jobId,state,state);
    const repository = new D1MailboxDeliveryRepository(db);
    expect(await repository.acquire(leaseRequest(ids,"campaign"))).toMatchObject({kind:"unavailable",reason:"budget"});
    run(db,`INSERT INTO test_sends(id,owner_user_id,campaign_id,idempotency_key,request_fingerprint,status,created_at,updated_at) VALUES ('test',?,?,'test-key','fingerprint','pending',1,1)`,ids.userId,ids.campaignId);
    expect(await repository.acquire({...leaseRequest(ids,"test"),recipientJobId:null,testSendId:"test"})).toMatchObject({kind:"unavailable",reason:"budget"});
    db.close();
  });
  it.each([false,true])("routes Queue Gmail sends without Microsoft configuration and never replays outcomes: ambiguous=%s", async ambiguous => {
    const db = new SqliteD1(); db.migrate(); const ids = seedCampaign(db);
    run(db,"UPDATE recipient_jobs SET status='pending', claim_token=NULL, claimed_at=NULL WHERE id=?",ids.jobId);
    run(db,"UPDATE campaigns SET wake_token='wake',wake_due_at='2026-09-05T00:00:00.000Z' WHERE id=?",ids.campaignId);
    const secret=Buffer.alloc(32,9).toString("base64");
    await createD1AuthStores(db).tokenStore.save({userId:ids.userId,resource:"google",encryptedRefreshToken:await encryptRefreshToken("synthetic-refresh",secret),grantedScopes:[GMAIL_SCOPE],accessTokenExpiresAt:1,encryptionVersion:1,updatedAt:1});
    const send=vi.fn(async () => {if(ambiguous)throw new Error("response lost");return Response.json({id:"synthetic-provider-id"});});
    vi.stubGlobal("fetch",vi.fn(async (url: RequestInfo|URL)=>String(url).includes("/token")?Response.json({access_token:"synthetic-access",expires_in:3600,scope:GMAIL_SCOPE}):send()));
    const bindings={DB:db,GOOGLE_CLIENT_ID:"synthetic",GOOGLE_CLIENT_SECRET:"synthetic",SESSION_SECRET:"synthetic-state",TOKEN_ENCRYPTION_KEY_B64:secret,PUBLIC_ORIGIN:"https://mailflow.test",CAMPAIGN_QUEUE:{send:vi.fn()}} as unknown as MailFlowBindings;
    const queueMessage={body:{type:"campaign.tick",campaignId:ids.campaignId,wakeToken:"wake"},ack:vi.fn(),retry:vi.fn()};
    try {
      await processQueueBatch({queue:"test",messages:[queueMessage]},bindings);
      await processQueueBatch({queue:"test",messages:[queueMessage]},bindings);
      expect(send).toHaveBeenCalledOnce();
      expect(db.database.prepare("SELECT status FROM recipient_jobs WHERE id=?").get(ids.jobId)?.status).toBe(ambiguous?"unknown":"accepted");
      expect(db.database.prepare("SELECT state FROM delivery_attempts").get()?.state).toBe(ambiguous?"unknown":"accepted");
      expect(queueMessage.retry).not.toHaveBeenCalled();
      await expect(accountMailProvider(bindings,{provider:"microsoft",ownerUserId:ids.userId,senderAddress:"member-1@example.test"})).rejects.toThrow("snapshot");
    } finally {vi.unstubAllGlobals();db.close();}
  });
});
