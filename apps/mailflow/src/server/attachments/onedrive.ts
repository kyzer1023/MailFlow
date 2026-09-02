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

function safeStorageKey(key: string): string {
  if (!/^mailflow-attachment_set_[A-Za-z0-9_-]+-attachment_file_[A-Za-z0-9_-]+\.bin$/u.test(key)) {
    throw new AttachmentError("storage_error", "The attachment storage key is invalid");
  }
  return key;
}

async function errorFrom(response: Response): Promise<AttachmentError> {
  if (response.status === 401 || response.status === 403) {
    return new AttachmentError("storage_error", "Reconnect OneDrive before using campaign attachments");
  }
  if (response.status === 507) return new AttachmentError("storage_error", "This OneDrive does not have enough available storage");
  return new AttachmentError("storage_error", "OneDrive could not complete the attachment request");
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
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async token(ownerUserId: string): Promise<string> {
    const token = await this.accessTokenFor(ownerUserId);
    if (!token) throw new AttachmentError("storage_error", "Reconnect OneDrive before using campaign attachments");
    return token;
  }

  private rootId(ownerUserId: string, token: string): Promise<string> {
    const existing = this.appRootIds.get(ownerUserId);
    if (existing) return existing;
    const request = (async () => {
      const response = await this.fetchImpl(`${this.baseUrl}/me/drive/special/approot?$select=id`, {
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
    const response = await this.fetchImpl(this.itemPath(await this.rootId(ownerUserId, token), key, "/content"), {
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
    const response = await this.fetchImpl(this.itemPath(await this.rootId(ownerUserId, token), key, "/content"), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (response.status === 404) return null;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) throw new AttachmentError("storage_error", "OneDrive did not provide the attachment content");
      const download = await this.fetchImpl(location, { redirect: "follow" });
      if (!download.ok) throw await errorFrom(download);
      return { arrayBuffer: () => download.arrayBuffer(), size: Number(download.headers.get("Content-Length")) || undefined };
    }
    if (!response.ok) throw await errorFrom(response);
    return { arrayBuffer: () => response.arrayBuffer(), size: Number(response.headers.get("Content-Length")) || undefined };
  }

  async delete(ownerUserId: string, keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return;
    const token = await this.token(ownerUserId);
    const rootId = await this.rootId(ownerUserId, token);
    for (const key of keys) {
      const itemResponse = await this.fetchImpl(`${this.itemPath(rootId, key)}?$select=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemResponse.status === 404) continue;
      if (!itemResponse.ok) throw await errorFrom(itemResponse);
      const item = await itemResponse.json() as { id?: unknown };
      if (typeof item.id !== "string" || !item.id) throw new AttachmentError("storage_error", "OneDrive did not return the attachment item");
      const response = await this.fetchImpl(`${this.baseUrl}/me/drive/items/${encodeURIComponent(item.id)}`, {
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
    while (nextUrl && objects.length < limit && pages < 20) {
      const response = await this.fetchImpl(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) return { objects: [], truncated: false };
      if (!response.ok) throw await errorFrom(response);
      const page = await response.json() as DriveChildrenPage;
      const values = Array.isArray(page.value) ? page.value : [];
      for (const value of values) {
        if (!value || typeof value !== "object") continue;
        const name = (value as { name?: unknown }).name;
        if (typeof name === "string" && name.startsWith(options.prefix)) objects.push({ key: name });
        if (objects.length >= limit) break;
      }
      nextUrl = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : null;
      pages += 1;
    }
    return { objects, truncated: Boolean(nextUrl) };
  }
}
