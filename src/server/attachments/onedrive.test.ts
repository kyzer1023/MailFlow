import { describe, expect, it, vi } from "vitest";
import { OneDriveAppFolderAttachmentStore } from "./onedrive";

const key = "mailflow-attachment_set_fixture-attachment_file_fixture.bin";

describe("OneDrive App Folder attachment store", () => {
  it("uploads generated storage names to the current user's app folder", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/special/approot")
      ? new Response(JSON.stringify({ id: "app-root" }), { status: 200 })
      : new Response(JSON.stringify({ id: "drive-item" }), { status: 201 })) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async (owner) => `token-for-${owner}`, {
      graphBaseUrl: "https://graph.example.test/v1.0",
      fetchImpl,
    });

    await store.put("user-1", key, new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: "text/plain" } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[1];
    expect(String(url)).toBe(`https://graph.example.test/v1.0/me/drive/items/app-root:/${key}:/content`);
    expect(init).toMatchObject({ method: "PUT", headers: { Authorization: "Bearer token-for-user-1", "Content-Type": "text/plain" } });
  });

  it("follows the preauthenticated content URL without forwarding the Graph bearer token", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/special/approot")) {
        return new Response(JSON.stringify({ id: "app-root" }), { status: 200 });
      }
      if (String(input).startsWith("https://graph.example.test")) {
        expect(init?.headers).toEqual({ Authorization: "Bearer storage-token" });
        return new Response(null, { status: 302, headers: { Location: "https://download.example.test/content" } });
      }
      expect(init?.headers).toBeUndefined();
      return new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "Content-Length": "3" } });
    }) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "storage-token", {
      graphBaseUrl: "https://graph.example.test/v1.0",
      fetchImpl,
    });

    const object = await store.get("user-1", key);

    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    expect(object?.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("lists only MailFlow keys for the requested attachment set and deletes idempotently", async () => {
    const matching = key;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/special/approot")) return new Response(JSON.stringify({ id: "app-root" }), { status: 200 });
      if (String(input).includes("?$select=id")) return new Response(null, { status: 404 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ value: [{ name: matching }, { name: "unrelated.bin" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "storage-token", {
      graphBaseUrl: "https://graph.example.test/v1.0",
      fetchImpl,
    });

    const result = await store.list("user-1", { prefix: "mailflow-attachment_set_fixture-" });
    await expect(store.delete("user-1", matching)).resolves.toBeUndefined();

    expect(result).toEqual({ objects: [{ key: matching }], truncated: false });
  });

  it("turns a denied Graph request into a reconnectable storage error", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "expired-token", { fetchImpl });

    await expect(store.put("user-1", key, new ArrayBuffer(1))).rejects.toMatchObject({
      code: "storage_error",
      message: "Reconnect OneDrive before using campaign attachments",
    });
  });

  it("classifies Graph throttles and network failures as transient pre-send storage errors", async () => {
    const throttled = new OneDriveAppFolderAttachmentStore(async () => "token", {
      fetchImpl: vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } })) as unknown as typeof fetch,
    });
    await expect(throttled.get("user-1", key)).rejects.toMatchObject({
      code: "storage_temporary",
      transient: true,
      retryAfterSeconds: 120,
    });

    const offline = new OneDriveAppFolderAttachmentStore(async () => "token", {
      fetchImpl: vi.fn(async () => { throw new TypeError("network unavailable"); }) as unknown as typeof fetch,
    });
    await expect(offline.get("user-1", key)).rejects.toMatchObject({
      code: "storage_temporary",
      transient: true,
    });
  });

  it("reports a file deleted after Graph issued its download redirect", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/special/approot")) return new Response(JSON.stringify({ id: "app-root" }), { status: 200 });
      if (String(input).startsWith("https://graph.microsoft.test")) {
        return new Response(null, { status: 302, headers: { Location: "https://download.microsoft.test/content" } });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "token", {
      graphBaseUrl: "https://graph.microsoft.test/v1.0",
      fetchImpl,
    });

    await expect(store.get("user-1", key)).rejects.toMatchObject({
      code: "storage_missing",
      message: expect.stringContaining("deleted from OneDrive"),
    });
  });

  it("stops a changed OneDrive response at the reviewed byte bound", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/special/approot")) return new Response(JSON.stringify({ id: "app-root" }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "token", {
      graphBaseUrl: "https://graph.example.test/v1.0",
      fetchImpl,
    });
    const object = await store.get("user-1", key);

    await expect(object!.arrayBuffer(3)).rejects.toMatchObject({ code: "integrity_error" });
  });

  it("marks a same-page listing as truncated when the match limit stops scanning", async () => {
    const names = Array.from({ length: 7 }, (_, index) => ({
      name: `mailflow-attachment_set_fixture-attachment_file_${index}.bin`,
    }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/special/approot")
      ? new Response(JSON.stringify({ id: "app-root" }), { status: 200 })
      : new Response(JSON.stringify({ value: names }), { status: 200 })) as unknown as typeof fetch;
    const store = new OneDriveAppFolderAttachmentStore(async () => "token", {
      graphBaseUrl: "https://graph.example.test/v1.0",
      fetchImpl,
    });

    await expect(store.list("user-1", { prefix: "mailflow-attachment_set_fixture-", limit: 5 })).resolves.toMatchObject({
      truncated: true,
      objects: expect.arrayContaining(names.slice(0, 5).map(({ name }) => ({ key: name }))),
    });
  });
});
