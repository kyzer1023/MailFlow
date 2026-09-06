import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1RunResult, D1Value } from "../../src/server/database/contracts";

export type SqliteValue = string | number | bigint | null | Uint8Array;

function sqliteValues(values: readonly D1Value[]): SqliteValue[] {
  return values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value as SqliteValue);
}

class SqliteStatement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly query: string,
    private readonly values: readonly D1Value[] = [],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatement {
    return new SqliteStatement(this.database, this.query, values);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...sqliteValues(this.values)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.query).all(...sqliteValues(this.values)) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const before = Number(this.database.prepare("SELECT total_changes() AS count").get()?.count);
    const result = this.database.prepare(this.query).run(...sqliteValues(this.values));
    const after = Number(this.database.prepare("SELECT total_changes() AS count").get()?.count);
    return { success: true, meta: { changes: after - before, last_row_id: Number(result.lastInsertRowid) } };
  }
}

export class SqliteD1 implements D1Database {
  readonly database = new DatabaseSync(":memory:");
  lastBatchSize = 0;

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    this.lastBatchSize = statements.length;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results: D1RunResult[] = [];
      for (const statement of statements as SqliteStatement[]) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  migrate(from = 1, through = 9999): void {
    const files = readdirSync(resolve(process.cwd(), "migrations"))
      .filter((filename) => /^\d{4}_.+\.sql$/u.test(filename) && Number(filename.slice(0, 4)) <= through)
      .sort();
    for (const filename of files.slice(from - 1)) {
      this.database.exec(readFileSync(resolve(process.cwd(), "migrations", filename), "utf8"));
    }
  }

  close(): void {
    this.database.close();
  }
}
