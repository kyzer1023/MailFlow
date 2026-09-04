import { AttachmentError, type AttachmentObjectBody, type AttachmentObjectPutOptions, type AttachmentObjectStore } from "./contracts";

export type OneDriveAccessTokenProvider = (ownerUserId: string) => Promise<string>;

export interface OneDriveAttachmentStoreOptions {
  graphBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface DriveChildrenPage {
  value?: unknown;
  "@odata.nextLink"?: unknown;
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400, Math.max(1, Math.ceil(seconds)));
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.min(86_400, Math.max(1, Math.ceil((at - Date.now()) / 1_000)));
}

function safeStorageKey(key: string): string {
  if (!/^mailflow-attachment_set_[A-Za-z0-9_-]+-attachment_file_[A-Za-z0-9_-]+\.bin$/u.test(key)) {
    throw new AttachmentError("storage_error", "The attachment storage key is invalid");
  }
  return key;
}

async function errorFrom(response: Response): Promise<AttachmentError> {
  let graphCode = "unknown";
  try {
    const payload = await response.clone().json() as { error?: { code?: unknown } };
    if (typeof payload.error?.code === "string" && payload.error.code) graphCode = payload.error.code;
  } catch {
    // Some download hosts and proxies return a non-JSON error response.
  }
  console.warn("OneDrive attachment request failed", {
    status: response.status,
    graphCode,
    requestId: response.headers.get("request-id") ?? response.headers.get("x-ms-request-id") ?? undefined,
  });
  if (response.status === 401 || response.status === 403) {
    return new AttachmentError("storage_error", "Reconnect OneDrive before using campaign attachments");
  }
  if (response.status === 404) {
    return new AttachmentError("storage_missing", "A campaign attachment was deleted from OneDrive");
  }
  if (response.status === 507) return new AttachmentError("storage_error", "This OneDrive does not have enough available storage");
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return new AttachmentError(
      "storage_temporary",
      "OneDrive is temporarily unavailable. Try again shortly",
      { transient: true, retryAfterSeconds: retryAfterSeconds(response) },
    );
  }
  return new AttachmentError("storage_error", "OneDrive could not complete the attachment request");
}

async function boundedArrayBuffer(response: Response, maxBytes?: number): Promise<ArrayBuffer> {
  const limit = maxBytes === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(maxBytes));
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new AttachmentError("integrity_error", "The OneDrive attachment is larger than its reviewed metadata");
  }
  if (!response.body) {
    const value = await response.arrayBuffer();
    if (value.byteLength > limit) {
      throw new AttachmentError("integrity_error", "The OneDrive attachment is larger than its reviewed metadata");
    }
    return value;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new AttachmentError("integrity_error", "The OneDrive attachment is larger than its reviewed metadata");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError(
      "storage_temporary",
      "OneDrive could not finish reading the campaign attachment",
      { transient: true },
    );
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** Stores temporary bytes only inside the signed-in user's OneDrive App Folder. */
export class OneDriveAppFolderAttachmentStore implements AttachmentObjectStore {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly appRootIds = new Map<string, Promise<string>>();

  constructor(
    private readonly accessTokenFor: OneDriveAccessTokenProvider,
    options: OneDriveAttachmentStoreOptions = {},
  ) {
    this.baseUrl = (options.graphBaseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/u, "");
    // Cloudflare's fetch is runtime-bound and throws an illegal-invocation
    // TypeError when stored and called as a detached function.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async token(ownerUserId: string): Promise<string> {
    const token = await this.accessTokenFor(ownerUserId);
    if (!token) throw new AttachmentError("storage_error", "Reconnect OneDrive before using campaign attachments");
    return token;
  }

  private async request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch {
      throw new AttachmentError(
        "storage_temporary",
        "OneDrive could not be reached. Try again shortly",
        { transient: true },
      );
    }
  }

  private rootId(ownerUserId: string, token: string): Promise<string> {
    const existing = this.appRootIds.get(ownerUserId);
    if (existing) return existing;
    const request = (async () => {
      const response = await this.request(`${this.baseUrl}/me/drive/special/approot?$select=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw await errorFrom(response);
      const value = await response.json() as { id?: unknown };
      if (typeof value.id !== "string" || !value.id) throw new AttachmentError("storage_error", "OneDrive did not return the MailFlow app folder");
      return value.id;
    })();
    this.appRootIds.set(ownerUserId, request);
    request.catch(() => this.appRootIds.delete(ownerUserId));
    return request;
  }

  private itemPath(rootId: string, key: string, suffix = ""): string {
    const path = `${this.baseUrl}/me/drive/items/${encodeURIComponent(rootId)}:/${encodeURIComponent(safeStorageKey(key))}`;
    return suffix ? `${path}:${suffix}` : path;
  }

  async put(ownerUserId: string, key: string, value: ArrayBuffer, options?: AttachmentObjectPutOptions): Promise<void> {
    const token = await this.token(ownerUserId);
    const response = await this.request(this.itemPath(await this.rootId(ownerUserId, token), key, "/content"), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": options?.httpMetadata?.contentType ?? "application/octet-stream",
      },
      body: value,
    });
    if (!response.ok) throw await errorFrom(response);
  }

  async get(ownerUserId: string, key: string): Promise<AttachmentObjectBody | null> {
    const token = await this.token(ownerUserId);
    const response = await this.request(this.itemPath(await this.rootId(ownerUserId, token), key, "/content"), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (response.status === 404) return null;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) throw new AttachmentError("storage_error", "OneDrive did not provide the attachment content");
      const download = await this.request(location, { redirect: "follow" });
      if (download.status === 404) throw new AttachmentError("storage_missing", "A campaign attachment was deleted from OneDrive");
      if (!download.ok) throw await errorFrom(download);
      return { arrayBuffer: (maxBytes) => boundedArrayBuffer(download, maxBytes), size: Number(download.headers.get("Content-Length")) || undefined };
    }
    if (!response.ok) throw await errorFrom(response);
    return { arrayBuffer: (maxBytes) => boundedArrayBuffer(response, maxBytes), size: Number(response.headers.get("Content-Length")) || undefined };
  }

  async delete(ownerUserId: string, keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return;
    const token = await this.token(ownerUserId);
    const rootId = await this.rootId(ownerUserId, token);
    for (const key of keys) {
      const itemResponse = await this.request(`${this.itemPath(rootId, key)}?$select=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemResponse.status === 404) continue;
      if (!itemResponse.ok) throw await errorFrom(itemResponse);
      const item = await itemResponse.json() as { id?: unknown };
      if (typeof item.id !== "string" || !item.id) throw new AttachmentError("storage_error", "OneDrive did not return the attachment item");
      const response = await this.request(`${this.baseUrl}/me/drive/items/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok && response.status !== 404) throw await errorFrom(response);
    }
  }

  async list(ownerUserId: string, options: { prefix: string; limit?: number }): Promise<{ objects: readonly { key: string }[]; truncated: boolean }> {
    const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 1000)));
    const token = await this.token(ownerUserId);
    const rootId = await this.rootId(ownerUserId, token);
    const objects: { key: string }[] = [];
    let nextUrl: string | null = `${this.baseUrl}/me/drive/items/${encodeURIComponent(rootId)}/children?$select=name&$top=200`;
    let pages = 0;
    let stoppedEarly = false;
    while (nextUrl && objects.length < limit && pages < 20) {
      if (!nextUrl.startsWith(`${this.baseUrl}/`)) {
        throw new AttachmentError("storage_error", "OneDrive returned an invalid attachment listing link");
      }
      const response = await this.request(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) return { objects: [], truncated: false };
      if (!response.ok) throw await errorFrom(response);
      const page = await response.json() as DriveChildrenPage;
      const values = Array.isArray(page.value) ? page.value : [];
      for (const [index, value] of values.entries()) {
        if (!value || typeof value !== "object") continue;
        const name = (value as { name?: unknown }).name;
        if (typeof name === "string" && name.startsWith(options.prefix)) objects.push({ key: name });
        if (objects.length >= limit) {
          stoppedEarly = index < values.length - 1;
          break;
        }
      }
      nextUrl = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : null;
      pages += 1;
    }
    return { objects, truncated: stoppedEarly || Boolean(nextUrl) };
  }
}
