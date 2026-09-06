// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import * as wrangler from "wrangler";
import type { D1Database } from "./contracts";
import { D1CampaignRepository } from "./d1-campaigns";
import { D1TemplateVersionRepository, TemplatePublicationConflict } from "./d1-template-versions";
import { reserveCampaignWake } from "../queue/campaign-tick";

const { getPlatformProxy } = wrangler;
// Wrangler 4 exposes this parser under the unstable runtime name, while its
// declaration file uses the internal name. Use its parser to preserve triggers.
const { unstable_splitSqlQuery: splitSqlQuery } = wrangler as unknown as {
  unstable_splitSqlQuery(sql: string): string[];
};

it("starts and stops campaigns using actual local D1 trigger-inclusive metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mailflow-d1-runtime-"));
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>> | undefined;
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(configPath, JSON.stringify({ name: "mailflow-d1-runtime-test", compatibility_date: "2026-09-01",
      d1_databases: [{ binding: "DB", database_name: "synthetic", database_id: "00000000-0000-0000-0000-000000000001" }] }));
    proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, envFiles: [], persist: false, remoteBindings: false });
    const db = proxy.env.DB;
    for (const filename of (await readdir(resolve("migrations"))).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
      const sql = await readFile(resolve("migrations", filename), "utf8");
      await db.batch(splitSqlQuery(sql).map(query => db.prepare(query)));
    }
    const now = "2026-09-06T00:00:00.000Z";
    await db.batch([
      db.prepare(`INSERT INTO users(id, tenant_id, object_id, principal_name, mailbox_address, display_name, role, created_at)
        VALUES ('owner', 'tenant', 'object', 'member@example.test', 'member@example.test', 'Member', 'member', ?1)`).bind(now),
      db.prepare(`INSERT INTO flows(id, owner_user_id, name, state, created_at, updated_at)
        VALUES ('flow', 'owner', 'Runtime check', 'active', ?1, ?1)`).bind(now),
      db.prepare(`INSERT INTO template_versions(id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
        VALUES ('template', 'flow', 1, 'Subject', '<p>Body</p>', '{}', '[]', ?1)`).bind(now),
      db.prepare(`INSERT INTO campaigns(id, flow_id, template_version_id, owner_user_id, sender_address,
        total_recipients, valid_recipients, skipped_recipients, pace_per_minute, state, idempotency_key, request_fingerprint, created_at, updated_at)
        VALUES ('campaign', 'flow', 'template', 'owner', 'member@example.test', 1, 1, 0, 12, 'draft', 'runtime-key', ?1, ?2, ?2)`).bind("a".repeat(43), now),
      db.prepare(`INSERT INTO recipient_jobs(id, campaign_id, source_row, recipient, cc_json, bcc_json,
        rendered_subject, rendered_body_html, send_key, status, attempt_count, created_at, updated_at)
        VALUES ('job', 'campaign', 2, 'recipient@example.test', '[]', '[]', 'Subject', '<p>Body</p>', 'send-key', 'pending', 0, ?1, ?1)`).bind(now),
    ]);
    const campaigns = new D1CampaignRepository(db);
    expect(await campaigns.markValidated("campaign", "owner", now)).toBe(true);
    expect(await campaigns.queue("campaign", "wrong-owner", now)).toBe(false);
    expect(await campaigns.queue("campaign", "owner", now)).toBe(true);
    expect(await campaigns.queue("campaign", "owner", now)).toBe(false);
    expect((await campaigns.getMailboxHead("owner"))?.id).toBe("campaign");
    let published = 0;
    const wake = await reserveCampaignWake({ campaigns, campaignId: "campaign", dueAt: now, now: new Date(now), message: null,
      queue: { enqueue: async () => { published += 1; } } });
    expect(wake.published).toBe(true);
    expect(published).toBe(1);
    expect(await campaigns.pauseForMailAuthorization("campaign", "wrong-owner", now, "Reconnect")).toBe(false);
    expect(await campaigns.pauseForMailAuthorization("campaign", "owner", now, "Reconnect Microsoft")).toBe(true);
    expect((await campaigns.getById("campaign"))?.mailIssueCode).toBe("mail_authorization_required");
    expect(await campaigns.resume("campaign", "owner", now)).toBe(true);
    expect((await campaigns.getById("campaign"))?.mailIssueCode).toBeNull();
    const versions = new D1TemplateVersionRepository(db);
    const original = (await versions.getById("template"))!;
    const saves = await Promise.allSettled([
      versions.create({ ...original, id: "save-a" }, { ownerUserId: "owner", expectedVersionId: null }),
      versions.create({ ...original, id: "save-b" }, { ownerUserId: "owner", expectedVersionId: null }),
    ]);
    expect(saves.filter(save => save.status === "fulfilled")).toHaveLength(1);
    expect(saves.find(save => save.status === "rejected")).toMatchObject({ reason: expect.any(TemplatePublicationConflict) });
    expect(await versions.listByFlow("flow")).toHaveLength(2);
    expect(await campaigns.cancel("campaign", "owner", now)).toBe(true);
    expect((await campaigns.getById("campaign"))?.state).toBe("cancelled");
    expect(await campaigns.resume("campaign", "owner", now)).toBe(false);
    expect(await campaigns.getMailboxHead("owner")).toBeNull();
  } finally {
    await proxy?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
