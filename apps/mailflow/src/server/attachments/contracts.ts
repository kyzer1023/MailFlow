/**
 * Attachment persistence and object-store contracts.
 *
 * These are deliberately structural. The application can pass a Cloudflare
 * R2 binding to the adapter without importing Cloudflare runtime types into
 * the domain or attachment policy modules.
 */

export const ATTACHMENT_MAX_FILES = 5;
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_MAX_FILENAME_LENGTH = 120;

// Descriptive aliases make the limits easy to discover at call sites.
export const MAX_ATTACHMENT_FILES = ATTACHMENT_MAX_FILES;
export const MAX_ATTACHMENT_BYTES = ATTACHMENT_MAX_BYTES;

export type AttachmentSetState = "open" | "locked" | "deleted";

export interface AttachmentSetRecord {
  id: string;
  ownerUserId: string;
  campaignId: string | null;
  uploadIdempotencyKey: string;
  fileCount: number;
  totalBytes: number;
  state: AttachmentSetState;
  expiresAt: string;
  lockedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentFileRecord {
  id: string;
  attachmentSetId: string;
  objectKey: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  position: number;
  createdAt: string;
  /** Set after the private object bytes have been deleted. */
  deletedAt: string | null;
}

export interface AttachmentSetCreateResult {
  set: AttachmentSetRecord;
  /** False when the owner replayed an existing upload idempotency key. */
  created: boolean;
}

export interface AttachmentObjectPutOptions {
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Readonly<Record<string, string>>;
}

export interface AttachmentObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly size?: number;
}

/** Narrow structural subset implemented by a private R2 bucket adapter. */
export interface AttachmentObjectStore {
  put(key: string, value: ArrayBuffer, options?: AttachmentObjectPutOptions): Promise<unknown>;
  get(key: string): Promise<AttachmentObjectBody | null>;
  delete(key: string): Promise<unknown>;
}

export interface AttachmentRepository {
  getSetById(id: string): Promise<AttachmentSetRecord | null>;
  getSetByIdForOwner(id: string, ownerUserId: string): Promise<AttachmentSetRecord | null>;
  getSetByUploadIdempotencyKey(ownerUserId: string, uploadIdempotencyKey: string): Promise<AttachmentSetRecord | null>;
  getSetByCampaignId(campaignId: string): Promise<AttachmentSetRecord | null>;
  createSet(set: AttachmentSetRecord): Promise<void>;

  /**
   * Inserts one file and increments the set totals as one conditional write.
   * False means the set was not open, the limits were reached, or a unique
   * constraint (usually a duplicate digest) prevented insertion.
   */
  createFile(file: AttachmentFileRecord, ownerUserId: string): Promise<boolean>;
  getFileById(id: string): Promise<AttachmentFileRecord | null>;
  getFileByIdForOwner(id: string, attachmentSetId: string, ownerUserId: string): Promise<AttachmentFileRecord | null>;
  listFiles(attachmentSetId: string, includeDeleted?: boolean): Promise<AttachmentFileRecord[]>;
  /** Removes a pre-association file and decrements its set totals atomically. */
  removeFile(id: string, attachmentSetId: string, ownerUserId: string, byteSize: number, now: string): Promise<boolean>;

  /** Makes an open set immutable for a test-send snapshot. */
  lockSet(id: string, ownerUserId: string, now: string): Promise<boolean>;
  /** Associates an immutable or open set with one owner-matching campaign. */
  associateSet(id: string, ownerUserId: string, campaignId: string, now: string): Promise<boolean>;

  /** Marks bytes gone while retaining file metadata for campaign audit. */
  markFileBytesDeleted(id: string, deletedAt: string): Promise<boolean>;
  /** Marks the set's bytes gone once no active file metadata remains. */
  markSetBytesDeleted(id: string, deletedAt: string): Promise<boolean>;
  listOrphanSets(now: string, limit?: number): Promise<AttachmentSetRecord[]>;
}

export type AttachmentBytes = ArrayBuffer | Uint8Array;

export interface AttachmentUploadInput {
  filename: string;
  contentType?: string | null;
  bytes: AttachmentBytes;
}

export interface StoredAttachmentFile {
  set: AttachmentSetRecord;
  file: AttachmentFileRecord;
}

export interface AttachmentPayload {
  file: AttachmentFileRecord;
  bytes: Uint8Array;
}

export type AttachmentErrorCode =
  | "invalid_input"
  | "invalid_filename"
  | "unsupported_type"
  | "empty_file"
  | "executable_content"
  | "file_limit_exceeded"
  | "size_limit_exceeded"
  | "duplicate_file"
  | "not_found"
  | "immutable"
  | "already_associated"
  | "storage_error"
  | "integrity_error";

/** A policy or storage error that the API can map without parsing messages. */
export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
  }
}
