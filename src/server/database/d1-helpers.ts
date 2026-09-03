import type {
  D1Database,
  D1PreparedStatement,
  D1RunResult,
  D1Value,
} from "./contracts";

/** Serialize values stored in D1 JSON columns. */
export function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Parse a D1 JSON column while retaining the adapter's established fallback. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Bind values through the structural D1 adapter contract. */
export function bind(statement: D1PreparedStatement, values: readonly unknown[]): D1PreparedStatement {
  return statement.bind(...(values as D1Value[]));
}

/** Prepare and bind a statement for adapters that start from SQL text. */
export function prepareAndBind(
  db: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement {
  return bind(db.prepare(sql), values);
}

/** Read the affected-row count exposed by D1 run results. */
export function changes(result: D1RunResult): number {
  return result.meta?.changes ?? 0;
}
