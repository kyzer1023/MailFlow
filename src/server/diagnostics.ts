/** Never serialize thrown values: even Error.name/code/stack can contain private data. */
export function safeErrorKind(
  error: unknown,
):
  | "database_constraint"
  | "database_unavailable"
  | "database_error"
  | "type_error"
  | "range_error"
  | "error"
  | "non_error" {
  // Match only known infrastructure prefixes. The matched text is never emitted.
  if (error instanceof Error && /^D1_ERROR:|^SQLITE_/u.test(error.message)) {
    if (/SQLITE_CONSTRAINT|constraint failed/iu.test(error.message))
      return "database_constraint";
    if (
      /SQLITE_BUSY|SQLITE_LOCKED|overloaded|unavailable/iu.test(error.message)
    )
      return "database_unavailable";
    return "database_error";
  }
  return error instanceof TypeError
    ? "type_error"
    : error instanceof RangeError
      ? "range_error"
      : error instanceof Error
        ? "error"
        : "non_error";
}

export function diagnosticMetadata(id: unknown): { diagnosticId?: string } {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      id,
    )
    ? { diagnosticId: id }
    : {};
}

export function apiDiagnosticRoute(path: string): string {
  const routes: readonly [RegExp, string][] = [
    [
      /^\/api\/campaigns\/[^/]+\/jobs\/[^/]+\/delivery-verification$/u,
      "delivery_verification",
    ],
    [
      /^\/api\/campaigns(?:\/[^/]+(?:\/(?:jobs|export\.csv|start|pause|resume|test-send))?)?$/u,
      "campaigns",
    ],
    [/^\/api\/flows(?:\/[^/]+(?:\/versions)?)?$/u, "flows"],
    [
      /^\/api\/attachment-sets(?:\/[^/]+(?:\/files(?:\/[^/]+)?)?)?$/u,
      "attachments",
    ],
    [/^\/api\/me$/u, "session"],
    [/^\/auth\//u, "authentication"],
  ];
  return routes.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}
