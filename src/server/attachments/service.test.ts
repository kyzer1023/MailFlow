import { describe, expect, it } from "vitest";
import { sha256Hex } from "../auth/crypto";
import {
  ATTACHMENT_MAX_BYTES,
  type AttachmentFileRecord,
  type AttachmentObjectBody,
  type AttachmentObjectStore,
  type AttachmentRepository,
  type AttachmentSetRecord,
} from "./contracts";
import { AttachmentService } from "./service";

class MemoryObjectStore implements AttachmentObjectStore {
  readonly values = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  failDelete = false;

  async put(_ownerUserId: string, key: string, value: ArrayBuffer): Promise<void> {
    this.values.set(key, new Uint8Array(value.slice(0)));
  }

  async get(_ownerUserId: string, key: string): Promise<AttachmentObjectBody | null> {
    const value = this.values.get(key);
    if (!value) return null;
    return {
      size: value.byteLength,
      async arrayBuffer(maxBytes?: number) {
        if (maxBytes !== undefined && value.byteLength > maxBytes) {
          throw new Error("bounded read exceeded");
        }
        return value.slice().buffer;
      },
    };
  }

  async delete(_ownerUserId: string, key: string | string[]): Promise<void> {
    if (this.failDelete) throw new Error("temporary object-store failure");
    for (const entry of Array.isArray(key) ? key : [key]) {
      this.deleted.push(entry);
      this.values.delete(entry);
    }
  }

  async list(_ownerUserId: string, options: { prefix: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean }> {
    const keys = [...this.values.keys()].filter((key) => key.startsWith(options.prefix));
    const limit = options.limit ?? 1000;
    return { objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit };
  }
}

class MemoryAttachmentRepository implements AttachmentRepository {
  readonly sets = new Map<string, AttachmentSetRecord>();
  readonly files = new Map<string, AttachmentFileRecord>();

  async getSetById(id: string): Promise<AttachmentSetRecord | null> {
    return this.sets.get(id) ?? null;
  }

  async getSetByIdForOwner(id: string, ownerUserId: string): Promise<AttachmentSetRecord | null> {
    const set = this.sets.get(id);
    return set?.ownerUserId === ownerUserId ? set : null;
  }

  async getSetByUploadIdempotencyKey(ownerUserId: string, key: string): Promise<AttachmentSetRecord | null> {
    return Array.from(this.sets.values()).find((set) => set.ownerUserId === ownerUserId && set.uploadIdempotencyKey === key) ?? null;
  }

  async getSetByCampaignId(campaignId: string): Promise<AttachmentSetRecord | null> {
    return Array.from(this.sets.values()).find((set) => set.campaignId === campaignId) ?? null;
  }

  async createSet(set: AttachmentSetRecord): Promise<void> {
    if (Array.from(this.sets.values()).some((entry) => entry.ownerUserId === set.ownerUserId && entry.uploadIdempotencyKey === set.uploadIdempotencyKey)) throw new Error("duplicate");
    this.sets.set(set.id, set);
  }

  async createFile(file: AttachmentFileRecord, ownerUserId: string): Promise<boolean> {
    const set = this.sets.get(file.attachmentSetId);
    if (!set || set.ownerUserId !== ownerUserId || set.state !== "open" || set.fileCount >= 5 || set.totalBytes + file.byteSize > ATTACHMENT_MAX_BYTES) return false;
    if (Array.from(this.files.values()).some((entry) => entry.attachmentSetId === file.attachmentSetId && entry.sha256 === file.sha256 && !entry.deletedAt)) return false;
    if (Array.from(this.files.values()).some((entry) => entry.attachmentSetId === file.attachmentSetId && entry.position === file.position)) return false;
    this.files.set(file.id, file);
    this.sets.set(set.id, { ...set, fileCount: set.fileCount + 1, totalBytes: set.totalBytes + file.byteSize, updatedAt: file.createdAt });
    return true;
  }

  async getFileById(id: string): Promise<AttachmentFileRecord | null> {
    return this.files.get(id) ?? null;
  }

  async getFileByIdForOwner(id: string, attachmentSetId: string, ownerUserId: string): Promise<AttachmentFileRecord | null> {
    const file = this.files.get(id);
    const set = this.sets.get(attachmentSetId);
    return file?.attachmentSetId === attachmentSetId && set?.ownerUserId === ownerUserId && !file.deletedAt ? file : null;
  }

  async listFiles(attachmentSetId: string, includeDeleted = false): Promise<AttachmentFileRecord[]> {
    return Array.from(this.files.values())
      .filter((file) => file.attachmentSetId === attachmentSetId && (includeDeleted || !file.deletedAt))
      .sort((left, right) => left.position - right.position);
  }

  async removeFile(id: string, attachmentSetId: string, ownerUserId: string, byteSize: number, now: string): Promise<boolean> {
    const set = this.sets.get(attachmentSetId);
    const file = this.files.get(id);
    if (!set || !file || set.ownerUserId !== ownerUserId || set.state !== "open" || file.attachmentSetId !== attachmentSetId) return false;
    this.files.delete(id);
    this.sets.set(attachmentSetId, { ...set, fileCount: Math.max(0, set.fileCount - 1), totalBytes: Math.max(0, set.totalBytes - byteSize), updatedAt: now });
    return true;
  }

  async lockSet(id: string, ownerUserId: string, now: string): Promise<boolean> {
    const set = this.sets.get(id);
    if (!set || set.ownerUserId !== ownerUserId || set.state !== "open" || set.campaignId) return false;
    this.sets.set(id, { ...set, state: "locked", lockedAt: now, updatedAt: now });
    return true;
  }

  async associateSet(id: string, ownerUserId: string, campaignId: string, now: string): Promise<boolean> {
    const set = this.sets.get(id);
    if (!set || set.ownerUserId !== ownerUserId || set.campaignId || !["open", "locked"].includes(set.state)) return false;
    this.sets.set(id, { ...set, state: "locked", campaignId, lockedAt: set.lockedAt ?? now, updatedAt: now });
    return true;
  }

  async markFileBytesDeleted(id: string, deletedAt: string): Promise<boolean> {
    const file = this.files.get(id);
    if (!file || file.deletedAt) return false;
    this.files.set(id, { ...file, deletedAt });
    return true;
  }

  async markSetBytesDeleted(id: string, deletedAt: string): Promise<boolean> {
    const set = this.sets.get(id);
    if (!set || set.state === "deleted" || (await this.listFiles(id)).length > 0) return false;
    this.sets.set(id, { ...set, state: "deleted", deletedAt, updatedAt: deletedAt });
    return true;
  }

  async listOrphanSets(now: string, limit = 100): Promise<AttachmentSetRecord[]> {
    return Array.from(this.sets.values())
      .filter((set) => ["open", "locked"].includes(set.state) && !set.campaignId && set.expiresAt <= now)
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
      .slice(0, limit);
  }
}

function createService(nowRef: { value: string }) {
  const repository = new MemoryAttachmentRepository();
  const objectStore = new MemoryObjectStore();
  let id = 0;
  const service = new AttachmentService(repository, objectStore, {
    now: () => nowRef.value,
    id: (prefix) => `${prefix}_${++id}`,
  });
  return { repository, objectStore, service };
}

async function addText(service: AttachmentService, ownerUserId: string, setId: string, value: string, filename = "notes.txt") {
  return service.addFile(ownerUserId, setId, { filename, contentType: "text/plain", bytes: new TextEncoder().encode(value) });
}

describe("attachment service", () => {
  it("creates an owned set idempotently and stores validated bytes once", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    const replay = await service.createSet("user-1", "request-1");
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.set.id).toBe(first.set.id);
    const result = await addText(service, "user-1", first.set.id, "hello");
    expect(result.file.mediaType).toBe("text/plain");
    expect(result.file.sha256).toBe(await sha256Hex(new TextEncoder().encode("hello")));
    expect(repository.files.size).toBe(1);
    expect(objectStore.values.size).toBe(1);
  });

  it("rejects duplicate bytes, enforces five-file and 20 MiB limits, and isolates owners", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    await addText(service, "user-1", first.set.id, "same");
    await expect(addText(service, "user-1", first.set.id, "same", "copy.txt")).rejects.toMatchObject({ code: "duplicate_file" });
    await expect(service.addFile("user-2", first.set.id, { filename: "other.txt", bytes: new TextEncoder().encode("no") })).rejects.toMatchObject({ code: "not_found" });

    const files = ["a", "b", "c", "d"];
    for (const [index, value] of files.entries()) await addText(service, "user-1", first.set.id, value, `${index}.txt`);
    await expect(addText(service, "user-1", first.set.id, "fifth", "fifth.txt")).rejects.toMatchObject({ code: "file_limit_exceeded" });

    const large = await service.createSet("user-1", "request-large");
    await expect(service.addFile("user-1", large.set.id, { filename: "large.txt", bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1), contentType: "text/plain" })).rejects.toMatchObject({ code: "size_limit_exceeded" });
  });

  it("removes only an open set's file and blocks changes after locking or campaign association", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    const result = await addText(service, "user-1", first.set.id, "remove me");
    expect(await service.removeFile("user-1", first.set.id, result.file.id)).toBe(true);
    expect(objectStore.deleted).toEqual([result.file.objectKey]);
    expect(repository.files.size).toBe(0);
    expect((await repository.getSetById(first.set.id))?.fileCount).toBe(0);

    const locked = await service.lockForSnapshot("user-1", first.set.id);
    expect(locked.state).toBe("locked");
    await expect(addText(service, "user-1", first.set.id, "nope", "nope.txt")).rejects.toMatchObject({ code: "immutable" });
    await expect(service.removeFile("user-1", first.set.id, result.file.id)).rejects.toMatchObject({ code: "immutable" });
  });

  it("keeps remaining ordering valid when a removed file is replaced", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository } = createService(now);
    const { set } = await service.createSet("user-1", "replace-request");
    const first = await addText(service, "user-1", set.id, "first", "first.txt");
    await addText(service, "user-1", set.id, "second", "second.txt");
    await service.removeFile("user-1", set.id, first.file.id);
    await addText(service, "user-1", set.id, "replacement", "replacement.txt");
    expect((await repository.listFiles(set.id)).map((file) => file.position)).toEqual([2, 3]);
  });

  it("leaves bytes intact when campaign locking wins the removal race", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const { set } = await service.createSet("user-1", "race-request");
    const file = await addText(service, "user-1", set.id, "keep me");
    repository.removeFile = async () => false;
    expect(await service.removeFile("user-1", set.id, file.file.id)).toBe(false);
    expect(objectStore.values.has(file.file.objectKey)).toBe(true);
  });

  it("sweeps untracked object bytes from an expired locked set", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const { set } = await service.createSet("user-1", "orphan-object-request");
    await service.lockForSnapshot("user-1", set.id);
    objectStore.values.set(`mailflow-${set.id}-attachment_file_untracked.bin`, new Uint8Array([1, 2, 3]));
    now.value = "2026-09-03T00:00:01.000Z";
    const cleanup = await service.cleanupExpiredOrphans();
    expect(cleanup.deleted).toBe(1);
    expect(objectStore.values.size).toBe(0);
    expect((await repository.getSetById(set.id))?.state).toBe("deleted");
  });

  it("verifies integrity before a send and deletes terminal bytes idempotently", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    const result = await addText(service, "user-1", first.set.id, "payload");
    const payloads = await service.readSet("user-1", first.set.id);
    expect(new TextDecoder().decode(payloads[0]?.bytes)).toBe("payload");
    objectStore.values.set(result.file.objectKey, new TextEncoder().encode("tampered"));
    await expect(service.readSet("user-1", first.set.id)).rejects.toMatchObject({ code: "integrity_error" });

    objectStore.values.set(result.file.objectKey, new TextEncoder().encode("payload"));
    const cleanup = await service.cleanupSetBytes(first.set.id);
    expect(cleanup.setDeleted).toBe(true);
    expect((await repository.getSetById(first.set.id))?.state).toBe("deleted");
    const replay = await service.cleanupSetBytes(first.set.id);
    expect(replay.setDeleted).toBe(true);
    expect(objectStore.deleted).toHaveLength(1);
    expect((await repository.listFiles(first.set.id, true))[0]?.deletedAt).toBeTruthy();
  });

  it("distinguishes deleted OneDrive bytes from changed bytes before a send", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, objectStore } = createService(now);
    const first = await service.createSet("user-1", "missing-and-changed");
    const result = await addText(service, "user-1", first.set.id, "reviewed");

    objectStore.values.delete(result.file.objectKey);
    await expect(service.readSet("user-1", first.set.id)).rejects.toMatchObject({
      code: "storage_missing",
      message: expect.stringContaining("deleted from OneDrive"),
      transient: false,
    });

    objectStore.values.set(result.file.objectKey, new TextEncoder().encode("longer than reviewed"));
    await expect(service.readSet("user-1", first.set.id)).rejects.toMatchObject({
      code: "integrity_error",
      message: expect.stringContaining("changed in OneDrive"),
      transient: false,
    });
  });

  it("rejects inconsistent set totals before reading any OneDrive object", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "metadata-corruption");
    await addText(service, "user-1", first.set.id, "reviewed");
    const stored = repository.sets.get(first.set.id)!;
    repository.sets.set(first.set.id, { ...stored, totalBytes: ATTACHMENT_MAX_BYTES + 1 });
    let reads = 0;
    objectStore.get = async () => {
      reads += 1;
      return null;
    };

    await expect(service.readSet("user-1", first.set.id)).rejects.toMatchObject({ code: "integrity_error" });
    expect(reads).toBe(0);
  });

  it("retries failed orphan cleanup after the object store recovers", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    await addText(service, "user-1", first.set.id, "orphan");
    objectStore.failDelete = true;
    now.value = "2026-09-03T00:00:01.000Z";
    const failed = await service.cleanupExpiredOrphans();
    expect(failed.attempted).toBe(1);
    expect(failed.deleted).toBe(0);
    expect((await repository.getSetById(first.set.id))?.state).toBe("open");
    objectStore.failDelete = false;
    const cleaned = await service.cleanupExpiredOrphans();
    expect(cleaned.deleted).toBe(1);
    expect((await repository.getSetById(first.set.id))?.state).toBe("deleted");
  });

  it("bounds untracked-object cleanup and resumes it on the next pass", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository, objectStore } = createService(now);
    const first = await service.createSet("user-1", "bounded-cleanup");
    for (let index = 0; index < 7; index += 1) {
      objectStore.values.set(`mailflow-${first.set.id}-attachment_file_orphan_${index}.bin`, new Uint8Array([index]));
    }
    now.value = "2026-09-03T00:00:01.000Z";

    const firstPass = await service.cleanupExpiredOrphans();
    expect(firstPass.deleted).toBe(0);
    expect(objectStore.deleted).toHaveLength(5);
    expect((await repository.getSetById(first.set.id))?.state).toBe("open");

    const secondPass = await service.cleanupExpiredOrphans();
    expect(secondPass.deleted).toBe(1);
    expect(objectStore.deleted).toHaveLength(7);
    expect((await repository.getSetById(first.set.id))?.state).toBe("deleted");
  });

  it("allows a locked test snapshot to be associated with one campaign once", async () => {
    const now = { value: "2026-09-02T00:00:00.000Z" };
    const { service, repository } = createService(now);
    const first = await service.createSet("user-1", "request-1");
    await service.lockForSnapshot("user-1", first.set.id);
    const associated = await service.associateWithCampaign("user-1", first.set.id, "campaign-1");
    expect(associated.campaignId).toBe("campaign-1");
    expect(await service.associateWithCampaign("user-1", first.set.id, "campaign-1")).toMatchObject({ campaignId: "campaign-1" });
    await expect(service.associateWithCampaign("user-1", first.set.id, "campaign-2")).rejects.toMatchObject({ code: "already_associated" });
    expect((await repository.getSetById(first.set.id))?.state).toBe("locked");
  });
});
