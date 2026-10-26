import { ATTACHMENT_MAX_BYTES, AttachmentError, type AttachmentObjectStore, type AttachmentObjectBody } from "../attachments/contracts";
import { AuthFlowError } from "../auth/service";

interface DriveFile { id: string; name: string; size?: string }
export class GoogleAppDataAttachmentStore implements AttachmentObjectStore {
  constructor(private readonly accessTokenFor: (owner: string) => Promise<string>, private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}
  private key(key: string) {
    if (!/^mailflow-[A-Za-z0-9_-]{1,240}\.bin$/u.test(key)) throw new AttachmentError("storage_error", "Invalid attachment storage key");
    return key;
  }
  private async request(owner: string, url: string, init: RequestInit = {}) {
    let token: string;
    try { token = await this.accessTokenFor(owner); }
    catch (error) {
      if (error instanceof AuthFlowError && error.category === "token") throw new AttachmentError("authorization_error", "Reconnect Google to use attachments");
      throw new AttachmentError("network_error", "Google authorization is temporarily unavailable", { transient: true });
    }
    let response: Response;
    try { response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000), headers: { ...init.headers, Authorization: `Bearer ${token}` } }); }
    catch { throw new AttachmentError("network_error", "Google Drive is temporarily unavailable", { transient: true }); }
    if (response.ok || response.status === 404) return response;
    if (response.status === 401) throw new AttachmentError("authorization_error", "Reconnect Google to use attachments");
    if (response.status === 403) {
      let reason = "";
      try { reason = ((await response.json()) as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason ?? ""; } catch { reason = ""; }
      if (!["rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) throw new AttachmentError("authorization_error", "Reconnect Google or check available Drive storage");
    }
    if ([403, 408, 429].includes(response.status) || response.status >= 500) throw new AttachmentError("service_unavailable", "Google Drive is temporarily unavailable", { transient: true, retryAfterSeconds: 60 });
    throw new AttachmentError("storage_error", "Google Drive rejected the attachment request");
  }
  private async files(owner: string, query: string, limit = 100) {
    const parameters = new URLSearchParams({ spaces: "appDataFolder", q: `trashed = false and (${query})`,
      fields: "files(id,name,size),nextPageToken", pageSize: String(Math.min(1000, Math.max(1, limit))) });
    const response = await this.request(owner, `https://www.googleapis.com/drive/v3/files?${parameters}`);
    if (!response.ok) throw new AttachmentError("storage_error", "Attachment metadata unavailable");
    return await response.json() as { files: DriveFile[]; nextPageToken?: string };
  }
  async put(owner: string, key: string, value: ArrayBuffer): Promise<void> {
    this.key(key);
    if (value.byteLength > ATTACHMENT_MAX_BYTES) throw new AttachmentError("size_limit_exceeded", "Attachments exceed 20 MiB");
    const existing = await this.files(owner, `name = '${key}'`);
    if (existing.files.length) throw new AttachmentError("immutable", "Attachment bytes already exist");
    const started = await this.request(owner, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(value.byteLength) },
      body: JSON.stringify({ name: key, parents: ["appDataFolder"] }),
    });
    const location = started.headers.get("Location");
    if (!location || new URL(location).origin !== "https://www.googleapis.com" || !new URL(location).pathname.startsWith("/upload/drive/")) throw new AttachmentError("storage_error", "Google Drive did not create an upload session");
    const uploaded = await this.request(owner, location, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: value });
    if (!uploaded.ok) throw new AttachmentError("storage_error", "Google Drive upload did not complete");
  }
  async get(owner: string, key: string): Promise<AttachmentObjectBody | null> {
    const found = await this.files(owner, `name = '${this.key(key)}'`);
    if (!found.files.length) return null;
    if (found.files.length !== 1 || found.nextPageToken) throw new AttachmentError("integrity_error", "Attachment identity is ambiguous");
    const file = found.files[0];
    const response = await this.request(owner, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
    if (response.status === 404) return null;
    return { size: Number(file.size), arrayBuffer: async (maxBytes = ATTACHMENT_MAX_BYTES) => {
      const limit = Math.min(ATTACHMENT_MAX_BYTES, maxBytes);
      if (!Number.isInteger(limit) || limit < 0 || Number(file.size) > limit || !response.body) {
        await response.body?.cancel();
        throw new AttachmentError("integrity_error", "Attachment size does not match reviewed metadata");
      }
      const bytes = new Uint8Array(limit);
      const reader = response.body.getReader();
      let offset = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          if (offset + next.value.byteLength > limit) { await reader.cancel(); throw new AttachmentError("integrity_error", "Attachment exceeds reviewed size"); }
          bytes.set(next.value, offset); offset += next.value.byteLength;
        }
      } catch (error) {
        if (error instanceof AttachmentError) throw error;
        throw new AttachmentError("network_error", "Google Drive download interrupted", { transient: true });
      } finally { reader.releaseLock(); }
      return offset === limit ? bytes.buffer : bytes.slice(0, offset).buffer;
    } };
  }
  async delete(owner: string, keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      const found = await this.files(owner, `name = '${this.key(key)}'`);
      for (const file of found.files) await this.request(owner, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
      if (found.nextPageToken) throw new AttachmentError("service_unavailable", "Attachment cleanup will continue later", { transient: true });
    }
  }
  async list(owner: string, options: { prefix: string; limit?: number }) {
    if (!/^mailflow-[A-Za-z0-9_-]*$/u.test(options.prefix)) throw new AttachmentError("storage_error", "Invalid attachment prefix");
    const found = await this.files(owner, `name contains '${options.prefix}'`, options.limit);
    return { objects: found.files.filter(file => file.name.startsWith(options.prefix)).map(file => ({ key: file.name })), truncated: Boolean(found.nextPageToken) };
  }
}
