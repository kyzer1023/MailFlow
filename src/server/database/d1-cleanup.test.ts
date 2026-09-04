import { describe, expect, it } from "vitest";
import { D1AuthSessionStore } from "./d1-auth-sessions";
import { D1OAuthStateStore } from "./d1-auth-state";
import { D1PublicControlStore } from "./d1-public-controls";
import type { D1Database, D1PreparedStatement, D1RunResult, D1Value } from "./contracts";
import { drainCleanupBatches } from "../api/worker-runtime";

class CapturingStatement implements D1PreparedStatement {
  values: D1Value[] = [];

  constructor(readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(): Promise<D1RunResult> {
    return { success: true, meta: { changes: 1 } };
  }
}

class CapturingDatabase implements D1Database {
  readonly statements: CapturingStatement[] = [];

  prepare(query: string): D1PreparedStatement {
    const statement = new CapturingStatement(query);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

describe("scheduled D1 retention adapters", () => {
  it("drains full batches but keeps each scheduled cleanup run bounded", async () => {
    const batches = [500, 500, 200];
    let calls = 0;
    await expect(drainCleanupBatches(async () => batches[calls++] ?? 0)).resolves.toBe(1_200);
    expect(calls).toBe(3);

    calls = 0;
    await expect(drainCleanupBatches(async () => { calls += 1; return 500; }, 500, 3)).resolves.toBe(1_500);
    expect(calls).toBe(3);
  });

  it("uses bounded expiry cleanup for OAuth state, sessions, counters, and stale test claims", async () => {
    const db = new CapturingDatabase();
    const now = 9_000_000;
    await expect(new D1OAuthStateStore(db).cleanupExpired(now, 25)).resolves.toBe(1);
    await expect(new D1AuthSessionStore(db).cleanupExpired(now, 25)).resolves.toBe(1);
    await expect(new D1PublicControlStore(db).cleanupExpired(now, 25)).resolves.toEqual({ counters: 1, staleTestSends: 1 });

    const sql = db.statements.map((statement) => statement.query.replace(/\s+/gu, " ").trim());
    expect(sql.some((query) => query.includes("DELETE FROM oauth_states") && query.includes("expires_at <= ?1") && query.includes("LIMIT ?2"))).toBe(true);
    expect(sql.some((query) => query.includes("DELETE FROM sessions") && query.includes("expires_at <= ?1 OR revoked_at IS NOT NULL") && query.includes("LIMIT ?2"))).toBe(true);
    expect(sql.some((query) => query.includes("DELETE FROM rate_limit_counters") && query.includes("expires_at <= ?1") && query.includes("LIMIT ?2"))).toBe(true);
    expect(sql.some((query) => query.includes("UPDATE test_sends") && query.includes("status = 'pending'") && query.includes("LIMIT ?3"))).toBe(true);
    expect(db.statements.every((statement) => statement.values.at(-1) === 25)).toBe(true);
  });
});
