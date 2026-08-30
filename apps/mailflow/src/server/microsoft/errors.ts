export type GraphErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "throttled"
  | "invalid_recipient"
  | "invalid_request"
  | "not_found"
  | "server"
  | "network"
  | "unknown";

export interface GraphErrorClassification {
  category: GraphErrorCategory;
  userMessage: string;
  retryable: boolean;
  ambiguous: boolean;
  retryAfterSeconds?: number;
  status?: number;
  providerCode?: string;
  requestId?: string;
}

export class GraphApiError extends Error {
  readonly code = "microsoft_graph_failed";
  readonly category: GraphErrorCategory;
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;

  constructor(classification: GraphErrorClassification) {
    super(classification.userMessage);
    this.name = "GraphApiError";
    this.category = classification.category;
    this.retryable = classification.retryable;
    this.ambiguous = classification.ambiguous;
    this.status = classification.status;
    this.providerCode = classification.providerCode;
    this.retryAfterSeconds = classification.retryAfterSeconds;
    this.requestId = classification.requestId;
  }
}

const USER_MESSAGES: Record<GraphErrorCategory, string> = {
  unauthorized: "Sign-in expired. Sign in again, then resume from the first unsent row.",
  forbidden: "USM has not approved this application's mail permission. No messages were sent.",
  throttled: "Microsoft requested a temporary pause. Sending will continue at the displayed time.",
  invalid_recipient: "This recipient address is invalid. The row was skipped.",
  invalid_request: "Microsoft rejected this message because one or more fields are invalid.",
  not_found: "Microsoft could not find the signed-in mailbox. Sign in again and retry.",
  server: "Microsoft is temporarily unavailable. This message was not accepted.",
  network: "The connection ended before Microsoft confirmed the message. The row is marked unknown and will not be resent automatically.",
  unknown: "Microsoft returned an unexpected response. Review the row before trying again.",
};

export function graphUserMessage(category: GraphErrorCategory): string {
  return USER_MESSAGES[category];
}

function containsCode(code: string | undefined, ...terms: string[]): boolean {
  if (!code) return false;
  const lower = code.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(24 * 60 * 60, Math.ceil(seconds));
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.min(24 * 60 * 60, Math.max(0, Math.ceil((timestamp - now) / 1000)));
  return undefined;
}

export function classifyGraphError(input: {
  status?: number;
  providerCode?: string;
  retryAfter?: string | null;
  requestId?: string;
  network?: boolean;
  now?: number;
}): GraphErrorClassification {
  const status = input.status;
  const code = input.providerCode;
  const requestId = input.requestId;
  if (input.network) {
    return { category: "network", userMessage: USER_MESSAGES.network, retryable: false, ambiguous: true, status, providerCode: code, requestId };
  }

  let category: GraphErrorCategory;
  let retryable = false;
  let ambiguous = false;
  if (status === 401 || containsCode(code, "invalidauthenticationtoken", "invalidaudience", "tokenexpired", "authentication")) {
    category = "unauthorized";
  } else if (status === 403 || containsCode(code, "accessdenied", "insufficientprivileges", "authorization")) {
    category = "forbidden";
  } else if (status === 429 || containsCode(code, "throttle", "too_many_requests", "quota", "ratelimit")) {
    category = "throttled";
    retryable = true;
  } else if (status === 404 || containsCode(code, "resourcenotfound", "mailboxnotenabled")) {
    category = "not_found";
  } else if (containsCode(code, "invalidrecipient", "recipient", "mailboxdoesnotexist")) {
    category = "invalid_recipient";
  } else if (status !== undefined && status >= 500) {
    category = "server";
    // A response from Graph proves the request reached Microsoft. A server
    // error is therefore not automatically resent unless an integration layer
    // explicitly decides the request was rejected before processing.
    retryable = false;
  } else if (status === 400 || status === 405 || status === 409 || status === 422) {
    category = "invalid_request";
  } else {
    category = "unknown";
    ambiguous = status === undefined;
  }
  return {
    category,
    userMessage: USER_MESSAGES[category],
    retryable,
    ambiguous,
    retryAfterSeconds: parseRetryAfter(input.retryAfter, input.now),
    status,
    providerCode: code,
    requestId,
  };
}

export function classifyGraphNetworkError(error?: unknown): GraphErrorClassification {
  // Deliberately discard the exception message. Fetch errors can include URLs,
  // proxy details, or request data and must not reach user-visible diagnostics.
  void error;
  return classifyGraphError({ network: true });
}

