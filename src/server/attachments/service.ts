import { sha256Hex } from "../auth/crypto";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_ORPHAN_TTL_MS,
  AttachmentError,
  type AttachmentFileRecord,
  type AttachmentObjectStore,
  type AttachmentPayload,
  type AttachmentRepository,
  type AttachmentSetCreateResult,
  type AttachmentSetRecord,
  type AttachmentUploadInput,
  type StoredAttachmentFile,
} from "./contracts";
import { assertAttachmentSetCapacity, validateAttachmentInput } from "./policy";

export interface AttachmentServiceOptions {
  now?: () => string;
  id?: (prefix: string) => string;
  objectKey?: (attachmentSetId: string, fileId: string) => string;
}

export interface AttachmentCleanupResult {
  setId: string;
  deletedFileIds: readonly string[];
  failedFileIds: readonly string[];
  setDeleted: boolean;
}

export interface AttachmentOrphanCleanupResult {
  sets: readonly AttachmentCleanupResult[];
  attempted: number;
  deleted: number;
}

/** Bound OneDrive cleanup work so the hourly Worker stays within its request budget. */
export const ATTACHMENT_CLEANUP_MAX_SETS_PER_RUN = 2;
export const ATTACHMENT_CLEANUP_MAX_OBJECT_DELETES_PER_SET = ATTACHMENT_MAX_FILES;

function defaultId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function defaultObjectKey(attachmentSetId: string, fileId: string): string {
  // OneDrive App Folder filenames use only generated IDs. They never include
  // user filenames, mailbox addresses, or message content.
  return `mailflow-${attachmentSetId}-${fileId}.bin`;
}

function nowIso(now: () => string): string {
  const value = now();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new AttachmentError("invalid_input", "The attachment timestamp is invalid");
  return new Date(parsed).toISOString();
}

function orphanExpiry(createdAt: string): string {
  return new Date(Date.parse(createdAt) + ATTACHMENT_ORPHAN_TTL_MS).toISOString();
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Coordinates policy validation, D1 metadata, and private OneDrive bytes. */
export class AttachmentService {
  private readonly now: () => string;
  private readonly id: (prefix: string) => string;
  private readonly objectKey: (attachmentSetId: string, fileId: string) => string;

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly objectStore: AttachmentObjectStore,
    options: AttachmentServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? defaultId;
    this.objectKey = options.objectKey ?? defaultObjectKey;
  }

  async createSet(ownerUserId: string, uploadIdempotencyKey: string): Promise<AttachmentSetCreateResult> {
    const key = uploadIdempotencyKey.trim();
    if (!ownerUserId.trim() || !key || key.length > 200 || /[\u0000-\u001f\u007f]/u.test(key)) {
      throw new AttachmentError("invalid_input", "A valid attachment upload idempotency key is required");
    }
    const existing = await this.repository.getSetByUploadIdempotencyKey(ownerUserId, key);
    if (existing) return { set: existing, created: false };

    const createdAt = nowIso(this.now);
    const set: AttachmentSetRecord = {
      id: this.id("attachment_set"),
      ownerUserId,
      campaignId: null,
      uploadIdempotencyKey: key,
      fileCount: 0,
      totalBytes: 0,
      state: "open",
      expiresAt: orphanExpiry(createdAt),
      lockedAt: null,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    try {
      await this.repository.createSet(set);
      return { set, created: true };
    } catch (error) {
      // A concurrent first request can win the unique owner/key insert. Make
      // that race idempotent by returning the durable winner.
      const winner = await this.repository.getSetByUploadIdempotencyKey(ownerUserId, key);
      if (winner) return { set: winner, created: false };
      throw error;
    }
  }

  async addFile(ownerUserId: string, attachmentSetId: string, input: AttachmentUploadInput): Promise<StoredAttachmentFile> {
    const set = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!set) throw new AttachmentError("not_found", "Attachment set not found");
    if (set.state !== "open" || set.campaignId) {
      throw new AttachmentError("immutable", "This attachment set can no longer be changed");
    }

    const validated = validateAttachmentInput(input);
    const digest = await sha256Hex(validated.bytes);
    const files = await this.repository.listFiles(set.id);
    if (files.some((file) => file.deletedAt === null && file.sha256 === digest)) {
      throw new AttachmentError("duplicate_file", "That attachment has already been selected");
    }
    assertAttachmentSetCapacity(set.fileCount, set.totalBytes, validated.bytes.byteLength);

    const createdAt = nowIso(this.now);
    const fileId = this.id("attachment_file");
    const file: AttachmentFileRecord = {
      id: fileId,
      attachmentSetId: set.id,
      objectKey: this.objectKey(set.id, fileId),
      originalFilename: validated.filename,
      mediaType: validated.mediaType,
      byteSize: validated.bytes.byteLength,
      sha256: digest,
      position: Math.max(0, ...files.map((entry) => entry.position)) + 1,
      createdAt,
      deletedAt: null,
    };

    let objectStored = false;
    let objectCleanupAttempted = false;
    try {
      await this.objectStore.put(ownerUserId, file.objectKey, bytesToArrayBuffer(validated.bytes), {
        httpMetadata: { contentType: file.mediaType },
        customMetadata: { sha256: file.sha256 },
      });
      objectStored = true;
      const inserted = await this.repository.createFile(file, ownerUserId);
      if (!inserted) {
        await this.deleteObjectAfterFailedInsert(ownerUserId, file.objectKey);
        objectCleanupAttempted = true;
        const latest = await this.repository.getSetByIdForOwner(set.id, ownerUserId);
        if (!latest || latest.state !== "open" || latest.campaignId) {
          throw new AttachmentError("immutable", "This attachment set can no longer be changed");
        }
        if (latest.fileCount >= ATTACHMENT_MAX_FILES) {
          throw new AttachmentError("file_limit_exceeded", `A campaign can contain at most ${ATTACHMENT_MAX_FILES} attachments`);
        }
        if (latest.totalBytes + file.byteSize > ATTACHMENT_MAX_BYTES) {
          throw new AttachmentError("size_limit_exceeded", "The combined attachment size exceeds 20 MiB");
        }
        const latestFiles = await this.repository.listFiles(set.id);
        if (latestFiles.some((entry) => entry.sha256 === digest)) {
          throw new AttachmentError("duplicate_file", "That attachment has already been selected");
        }
        throw new AttachmentError("storage_error", "The attachment could not be recorded");
      }
      const current = await this.repository.getSetByIdForOwner(set.id, ownerUserId);
      return { set: current ?? { ...set, fileCount: set.fileCount + 1, totalBytes: set.totalBytes + file.byteSize, updatedAt: createdAt }, file };
    } catch (error) {
      // If the database write failed after the object was put, remove the
      // private OneDrive object best-effort. The metadata path remains retryable.
      if (objectStored && !objectCleanupAttempted) await this.deleteObjectAfterFailedInsert(ownerUserId, file.objectKey);
      throw error;
    }
  }

  async removeFile(ownerUserId: string, attachmentSetId: string, fileId: string): Promise<boolean> {
    const set = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!set) throw new AttachmentError("not_found", "Attachment set not found");
    if (set.state !== "open" || set.campaignId) {
      throw new AttachmentError("immutable", "This attachment set can no longer be changed");
    }
    const file = await this.repository.getFileByIdForOwner(fileId, attachmentSetId, ownerUserId);
    if (!file) return false;
    // The conditional metadata removal must win before bytes are touched.
    // If campaign creation locked the set concurrently, leave its object
    // intact. A failed object deletion is swept by this set's later cleanup.
    const removed = await this.repository.removeFile(file.id, attachmentSetId, ownerUserId, file.byteSize, nowIso(this.now));
    if (!removed) return false;
    await this.deleteObjectAfterFailedInsert(ownerUserId, file.objectKey);
    return true;
  }

  async lockForSnapshot(ownerUserId: string, attachmentSetId: string): Promise<AttachmentSetRecord> {
    const existing = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!existing) throw new AttachmentError("not_found", "Attachment set not found");
    if (existing.state === "deleted") throw new AttachmentError("immutable", "This attachment set has been deleted");
    if (existing.state === "locked") return existing;
    const now = nowIso(this.now);
    const changed = await this.repository.lockSet(attachmentSetId, ownerUserId, now);
    if (!changed) {
      const latest = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
      if (latest?.state === "locked") return latest;
      throw new AttachmentError("immutable", "This attachment set can no longer be changed");
    }
    const locked = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!locked) throw new AttachmentError("not_found", "Attachment set not found");
    return locked;
  }

  async associateWithCampaign(ownerUserId: string, attachmentSetId: string, campaignId: string): Promise<AttachmentSetRecord> {
    const existing = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!existing) throw new AttachmentError("not_found", "Attachment set not found");
    if (existing.state === "deleted") throw new AttachmentError("immutable", "This attachment set has been deleted");
    if (existing.campaignId === campaignId) return existing;
    if (existing.campaignId && existing.campaignId !== campaignId) {
      throw new AttachmentError("already_associated", "This attachment set belongs to another campaign");
    }
    const changed = await this.repository.associateSet(attachmentSetId, ownerUserId, campaignId, nowIso(this.now));
    if (!changed) {
      const latest = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
      if (latest?.campaignId === campaignId) return latest;
      if (latest?.campaignId) throw new AttachmentError("already_associated", "This attachment set belongs to another campaign");
      throw new AttachmentError("immutable", "This attachment set can no longer be changed");
    }
    const associated = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!associated) throw new AttachmentError("not_found", "Attachment set not found");
    return associated;
  }

  async readFile(ownerUserId: string, file: AttachmentFileRecord): Promise<AttachmentPayload> {
    if (file.deletedAt) throw new AttachmentError("storage_missing", "A campaign attachment was deleted from OneDrive");
    const object = await this.objectStore.get(ownerUserId, file.objectKey);
    if (!object) throw new AttachmentError("storage_missing", "A campaign attachment was deleted from OneDrive");
    if (object.size !== undefined && object.size !== file.byteSize) {
      throw new AttachmentError("integrity_error", "A campaign attachment changed in OneDrive and no longer matches the reviewed file");
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await object.arrayBuffer(file.byteSize));
    } catch (error) {
      if (error instanceof AttachmentError) throw error;
      throw new AttachmentError(
        "network_error",
        "OneDrive could not finish reading the campaign attachment",
        { transient: true },
      );
    }
    if (bytes.byteLength !== file.byteSize) {
      throw new AttachmentError("integrity_error", "A campaign attachment changed in OneDrive and no longer matches the reviewed file");
    }
    if ((await sha256Hex(bytes)) !== file.sha256) {
      throw new AttachmentError("integrity_error", "A campaign attachment changed in OneDrive and no longer matches the reviewed file");
    }
    return { file, bytes };
  }

  async readSet(ownerUserId: string, attachmentSetId: string): Promise<AttachmentPayload[]> {
    const set = await this.repository.getSetByIdForOwner(attachmentSetId, ownerUserId);
    if (!set) throw new AttachmentError("not_found", "Attachment set not found");
    if (set.state === "deleted") throw new AttachmentError("storage_missing", "This campaign attachment set is no longer available");
    const files = await this.repository.listFiles(attachmentSetId);
    const metadataBytes = files.reduce((total, file) => total + file.byteSize, 0);
    if (
      set.fileCount < 0
      || set.fileCount > ATTACHMENT_MAX_FILES
      || set.totalBytes < 0
      || set.totalBytes > ATTACHMENT_MAX_BYTES
      || files.length !== set.fileCount
      || metadataBytes !== set.totalBytes
    ) {
      throw new AttachmentError("integrity_error", "The campaign attachment metadata does not match its reviewed files");
    }
    const payloads: AttachmentPayload[] = [];
    for (const file of files) payloads.push(await this.readFile(ownerUserId, file));
    return payloads;
  }

  async cleanupSetBytes(attachmentSetId: string): Promise<AttachmentCleanupResult> {
    const set = await this.repository.getSetById(attachmentSetId);
    if (!set) return { setId: attachmentSetId, deletedFileIds: [], failedFileIds: [], setDeleted: true };
    const timestamp = nowIso(this.now);
    const deletedFileIds: string[] = [];
    const failedFileIds: string[] = [];
    const files = (await this.repository.listFiles(attachmentSetId))
      .slice(0, ATTACHMENT_CLEANUP_MAX_OBJECT_DELETES_PER_SET);
    if (files.length > 0) {
      try {
        await this.objectStore.delete(set.ownerUserId, files.map((file) => file.objectKey));
        for (const file of files) {
          if (await this.repository.markFileBytesDeleted(file.id, timestamp)) deletedFileIds.push(file.id);
          else failedFileIds.push(file.id);
        }
      } catch {
        // A batched OneDrive delete may partially succeed. Metadata stays active
        // and the next bounded pass safely repeats the idempotent delete.
        failedFileIds.push(...files.map((file) => file.id));
      }
    }
    if (failedFileIds.length > 0) {
      return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted: set.state === "deleted" };
    }
    const remaining = await this.repository.listFiles(attachmentSetId);
    if (remaining.length > 0) {
      return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted: false };
    }

    const fallbackDeleteBudget = ATTACHMENT_CLEANUP_MAX_OBJECT_DELETES_PER_SET - files.length;

    // An object put can succeed while its metadata insert or compensating
    // delete fails. Sweep at most one small private-namespace batch per run.
    // A truncated result deliberately leaves the set active for the next pass.
    try {
      const objects = await this.objectStore.list(set.ownerUserId, {
        prefix: `mailflow-${attachmentSetId}-`,
        limit: Math.max(1, fallbackDeleteBudget),
      });
      if (objects.objects.length) {
        if (fallbackDeleteBudget < 1) {
          return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted: false };
        }
        await this.objectStore.delete(set.ownerUserId, objects.objects.map((object) => object.key));
      }
      if (objects.truncated) {
        return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted: false };
      }
    } catch {
      return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted: false };
    }

    let setDeleted = set.state === "deleted";
    if (set.state !== "deleted") {
      setDeleted = await this.repository.markSetBytesDeleted(attachmentSetId, timestamp);
    }
    return { setId: attachmentSetId, deletedFileIds, failedFileIds, setDeleted };
  }

  async cleanupExpiredOrphans(limit = ATTACHMENT_CLEANUP_MAX_SETS_PER_RUN): Promise<AttachmentOrphanCleanupResult> {
    const sets = await this.repository.listOrphanSets(
      nowIso(this.now),
      Math.max(1, Math.min(ATTACHMENT_CLEANUP_MAX_SETS_PER_RUN, Math.floor(limit))),
    );
    const results: AttachmentCleanupResult[] = [];
    for (const set of sets) {
      try {
        results.push(await this.cleanupSetBytes(set.id));
      } catch {
        // Preserve the set for the next hourly pass and continue within the
        // current bounded batch so one owner's outage cannot block another.
        results.push({ setId: set.id, deletedFileIds: [], failedFileIds: [], setDeleted: false });
      }
    }
    return {
      sets: results,
      attempted: results.length,
      deleted: results.filter((result) => result.setDeleted).length,
    };
  }

  private async deleteObjectAfterFailedInsert(ownerUserId: string, objectKey: string): Promise<void> {
    try {
      await this.objectStore.delete(ownerUserId, objectKey);
    } catch {
      // The metadata insert did not complete, so this orphan is not reachable
      // by a set cleanup query. The object-key namespace is private and the
      // scheduled object-store sweep can remove stale keys operationally.
    }
  }
}

export function createAttachmentService(
  repository: AttachmentRepository,
  objectStore: AttachmentObjectStore,
  options: AttachmentServiceOptions = {},
): AttachmentService {
  return new AttachmentService(repository, objectStore, options);
}
