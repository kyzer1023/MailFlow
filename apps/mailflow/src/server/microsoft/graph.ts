import type { FetchLike } from "../auth/tenant";
import type { MailImportance } from "../../domain/types";
import { classifyGraphError, classifyGraphNetworkError, GraphApiError } from "./errors";

export { GraphApiError } from "./errors";

export interface GraphUser {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  tenantId?: string;
}

export interface GraphEmailAddress {
  address: string;
  name?: string;
}

export interface GraphMessageInput {
  subject: string;
  bodyHtml: string;
  to: Array<string | GraphEmailAddress>;
  cc?: Array<string | GraphEmailAddress>;
  bcc?: Array<string | GraphEmailAddress>;
  replyTo?: Array<string | GraphEmailAddress>;
  importance?: MailImportance;
  saveToSentItems?: boolean;
}

export interface GraphSendResult {
  accepted: true;
  status: number;
  requestId?: string;
}

export interface GraphProviderOptions {
  graphBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

export interface GraphMailProviderContract {
  getCurrentUser(accessToken: string): Promise<GraphUser>;
  sendMail(accessToken: string, input: GraphMessageInput): Promise<GraphSendResult>;
}

function fetcher(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (!globalThis.fetch) throw new Error("Fetch is unavailable in this runtime");
  return globalThis.fetch.bind(globalThis);
}

function graphUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function requireAccessToken(accessToken: string): void {
  if (!accessToken || typeof accessToken !== "string" || /\s/.test(accessToken)) throw new GraphApiError(classifyGraphError({ status: 401, providerCode: "InvalidAuthenticationToken" }));
}

function address(value: string | GraphEmailAddress): GraphEmailAddress {
  const result = typeof value === "string" ? { address: value.trim() } : { address: value.address?.trim(), ...(value.name ? { name: value.name.trim() } : {}) };
  // Keep validation conservative. Detailed row validation belongs to the
  // domain/client, but the provider must not send an empty address.
  if (!result.address || /[\r\n]/.test(result.address) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.address)) {
    throw new GraphApiError(classifyGraphError({ status: 422, providerCode: "ErrorInvalidRecipients" }));
  }
  return result;
}

function recipientList(values: Array<string | GraphEmailAddress> | undefined): Array<{ emailAddress: GraphEmailAddress }> | undefined {
  if (!values) return undefined;
  return values.map((value) => ({ emailAddress: address(value) }));
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function graphProviderCode(payload: Record<string, unknown> | null): string | undefined {
  const error = payload?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const errorRecord = error as Record<string, unknown>;
  if (typeof errorRecord.code === "string") return errorRecord.code;
  const inner = errorRecord.innerError;
  if (inner && typeof inner === "object" && !Array.isArray(inner) && typeof (inner as Record<string, unknown>).code === "string") {
    return (inner as Record<string, string>).code;
  }
  return undefined;
}

export class GraphMailProvider implements GraphMailProviderContract {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs?: number;

  constructor(options: GraphProviderOptions = {}) {
    this.baseUrl = (options.graphBaseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
    if (!this.baseUrl.startsWith("https://")) throw new Error("Microsoft Graph endpoint must use HTTPS");
    this.fetchImpl = fetcher(options.fetchImpl);
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  private async request(
    accessToken: string,
    path: string,
    init: RequestInit = {},
  ): Promise<{ response: Response; payload: Record<string, unknown> | null }> {
    requireAccessToken(accessToken);
    const controller = this.requestTimeoutMs && typeof AbortController !== "undefined" ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (controller && this.requestTimeoutMs) timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(graphUrl(this.baseUrl, path), {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
      const payload = response.status === 202 || response.status === 204 ? null : await readJson(response);
      if (!response.ok) {
        const classification = classifyGraphError({
          status: response.status,
          providerCode: graphProviderCode(payload),
          retryAfter: response.headers.get("Retry-After"),
          requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined,
        });
        throw new GraphApiError(classification);
      }
      return { response, payload };
    } catch (error) {
      if (error instanceof GraphApiError) throw error;
      throw new GraphApiError(classifyGraphNetworkError(error));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getCurrentUser(accessToken: string): Promise<GraphUser> {
    const { response, payload } = await this.request(accessToken, "/me?$select=id,displayName,mail,userPrincipalName");
    void response;
    if (!payload || typeof payload.id !== "string" || !payload.id) {
      throw new GraphApiError(classifyGraphError({ status: 502, providerCode: "InvalidGraphUserResponse" }));
    }
    const displayName = typeof payload.displayName === "string" ? payload.displayName : null;
    const mail = typeof payload.mail === "string" && payload.mail ? payload.mail : null;
    const userPrincipalName = typeof payload.userPrincipalName === "string" && payload.userPrincipalName ? payload.userPrincipalName : null;
    return { id: payload.id, displayName, mail, userPrincipalName };
  }

  async sendMail(accessToken: string, input: GraphMessageInput): Promise<GraphSendResult> {
    if (!input || typeof input.subject !== "string" || typeof input.bodyHtml !== "string" || !Array.isArray(input.to) || input.to.length === 0) {
      throw new GraphApiError(classifyGraphError({ status: 422, providerCode: "InvalidRequest" }));
    }
    if (/[\r\n]/.test(input.subject)) {
      throw new GraphApiError(classifyGraphError({ status: 422, providerCode: "InvalidRequest" }));
    }
    const toRecipients = recipientList(input.to) ?? [];
    const ccRecipients = recipientList(input.cc);
    const bccRecipients = recipientList(input.bcc);
    const replyTo = recipientList(input.replyTo);
    const message: Record<string, unknown> = {
      subject: input.subject,
      body: { contentType: "HTML", content: input.bodyHtml },
      toRecipients,
      importance: input.importance ?? "normal",
      ...(ccRecipients?.length ? { ccRecipients } : {}),
      ...(bccRecipients?.length ? { bccRecipients } : {}),
      ...(replyTo?.length ? { replyTo } : {}),
    };
    const { response } = await this.request(accessToken, "/me/sendMail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: input.saveToSentItems ?? true }),
    });
    // Graph documents 202 Accepted. Other successful 2xx responses are still
    // acceptance by the provider, but retain the status for diagnostics.
    return {
      accepted: true,
      status: response.status,
      requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined,
    };
  }
}

export function createGraphMailProvider(options: GraphProviderOptions = {}): GraphMailProvider {
  return new GraphMailProvider(options);
}

/** Alias for adapters that use the shorter MicrosoftGraphProvider name. */
export const MicrosoftGraphProvider = GraphMailProvider;
