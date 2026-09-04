export const ATTACHMENT_MAX_FILES = 5;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_FILENAME_LENGTH = 120;
type AttachmentBytes = ArrayBuffer | Uint8Array;

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
  | "authorization_error"
  | "network_error"
  | "throttled"
  | "service_unavailable"
  | "missing_object"
  | "storage_error"
  | "storage_missing"
  | "storage_temporary"
  | "integrity_error";

/** A policy or storage error that the API can map without parsing messages. */
export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;
  /** True only when no provider submission occurred and an automatic retry is safe. */
  readonly transient: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AttachmentErrorCode,
    message: string,
    options: { transient?: boolean; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
    this.transient = options.transient === true;
    this.retryAfterSeconds = Number.isFinite(options.retryAfterSeconds)
      ? Math.max(1, Math.floor(options.retryAfterSeconds!))
      : null;
  }
}

export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "application/csv": "text/csv",
  "application/vnd.ms-excel": "application/vnd.ms-excel",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

function basename(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\\/]+/g, "/");
  return normalized.split("/").at(-1) ?? "";
}

/**
 * Returns a safe display/Graph filename with no path component or control
 * characters. The object key never contains this value.
 */
export function sanitizeAttachmentFilename(value: string): string {
  if (typeof value !== "string") throw new AttachmentError("invalid_filename", "A filename is required");
  let name = basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "");
  if (!name) throw new AttachmentError("invalid_filename", "The filename is empty after sanitization");

  const extensionMatch = name.match(/\.[^.]+$/u);
  const extension = extensionMatch?.[0] ?? "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  if (name.length > ATTACHMENT_MAX_FILENAME_LENGTH) {
    const stemLimit = Math.max(1, ATTACHMENT_MAX_FILENAME_LENGTH - extension.length);
    name = `${stem.slice(0, stemLimit)}${extension}`;
  }
  if (!name || name === extension) throw new AttachmentError("invalid_filename", "The filename is empty after sanitization");
  return name;
}

function extensionOf(filename: string): string {
  const match = filename.match(/\.[^.]+$/u);
  return match?.[0].toLowerCase() ?? "";
}

/**
 * Normalizes the browser-declared media type and cross-checks it against the
 * sanitized filename extension. Empty or generic browser types are inferred
 * from the extension for the supported common formats.
 */
export function normalizeAttachmentContentType(filename: string, declaredType?: string | null): string {
  const extension = extensionOf(filename);
  const inferred = MIME_BY_EXTENSION[extension];
  if (!inferred) throw new AttachmentError("unsupported_type", "This attachment type is not supported");

  const declared = (declaredType ?? "").split(";", 1)[0].trim().toLowerCase();
  const normalized = MIME_ALIASES[declared] ?? declared;
  if (!normalized || normalized === "application/octet-stream") return inferred;
  if (extension === ".csv" && normalized === "application/vnd.ms-excel") return "text/csv";
  if (!ALLOWED_MIME_TYPES.has(normalized)) {
    throw new AttachmentError("unsupported_type", "This attachment type is not supported");
  }

  // Modern Office MIME types are extension-specific.
  // CSV and JPEG aliases are normalized above.
  const extensionMime = inferred;
  if (normalized !== extensionMime) {
    throw new AttachmentError("unsupported_type", "The filename extension and media type do not match");
  }
  return normalized;
}

function asBytes(value: AttachmentBytes): Uint8Array {
  // `File.arrayBuffer()` and test DOM realms can produce a Uint8Array whose
  // constructor is not the same global constructor as this module's. The
  // ArrayBuffer.isView check keeps that boundary runtime-safe.
  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new AttachmentError("invalid_input", "Attachment bytes are invalid");
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** Rejects unmistakable native executable signatures and executable scripts. */
export function containsExecutableContent(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x4d, 0x5a]) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return true;
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])
  ) return true;
  const prefix = new TextDecoder().decode(bytes.slice(0, 128));
  return /^\uFEFF?\s*#!(?:[^\r\n]*\/)?(?:sh|bash|zsh|fish|python(?:\d+(?:\.\d+)*)?|perl|ruby|node)(?:\s|$)/iu.test(prefix);
}

export interface ValidatedAttachmentInput {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
}

export function validateAttachmentInput(input: {
  filename: string;
  contentType?: string | null;
  bytes: AttachmentBytes;
}): ValidatedAttachmentInput {
  const filename = sanitizeAttachmentFilename(input.filename);
  const mediaType = normalizeAttachmentContentType(filename, input.contentType);
  const bytes = asBytes(input.bytes);
  if (bytes.byteLength === 0) throw new AttachmentError("empty_file", "Empty attachments are not supported");
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError("size_limit_exceeded", "This attachment exceeds the campaign attachment size limit");
  }
  if (containsExecutableContent(bytes)) {
    throw new AttachmentError("executable_content", "Executable attachment content is not supported");
  }
  assertFileContent(filename, bytes);
  return { filename, mediaType, bytes };
}

export function assertAttachmentSetCapacity(fileCount: number, totalBytes: number, nextBytes: number): void {
  if (!Number.isInteger(fileCount) || fileCount < 0 || fileCount >= ATTACHMENT_MAX_FILES) {
    throw new AttachmentError("file_limit_exceeded", `A campaign can contain at most ${ATTACHMENT_MAX_FILES} attachments`);
  }
  if (!Number.isSafeInteger(nextBytes) || nextBytes <= 0 || !Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes + nextBytes > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError("size_limit_exceeded", "The combined attachment size exceeds 20 MiB");
  }
}

function mismatch(): never {
  throw new AttachmentError("unsupported_type", "The file content does not match a supported file format.");
}

/** Decode supported text exports without silently replacing malformed bytes. */
export function decodeFileText(bytes: Uint8Array): string {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) mismatch();
    return text;
  } catch { return mismatch(); }
}

/** Inspect package structure without inflating arbitrary attachment content. */
export function assertOfficePackage(bytes: Uint8Array, extension: string): void {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => view.getUint16(offset, true);
    const u32 = (offset: number) => view.getUint32(offset, true);
    if (u32(0) !== 0x04034b50) mismatch();
    let end = bytes.length - 22;
    const floor = Math.max(0, end - 65535);
    while (end >= floor && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
    if (end < floor || u16(end + 4) || u16(end + 6)) mismatch();
    const count = u16(end + 10);
    if (!count || count > 2048 || count !== u16(end + 8)) mismatch();
    const directory = u32(end + 16);
    if (directory + u32(end + 12) !== end) mismatch();
    let cursor = directory;
    let expanded = 0;
    const names = new Set<string>();
    const ranges: [number, number][] = [];
    for (let index = 0; index < count; index++) {
      if (u32(cursor) !== 0x02014b50) mismatch();
      const flags = u16(cursor + 8);
      const method = u16(cursor + 10);
      const compressed = u32(cursor + 20);
      const size = u32(cursor + 24);
      const nameLength = u16(cursor + 28);
      const local = u32(cursor + 42);
      const next = cursor + 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
      if (next > end || flags & 0x41 || ![0, 8].includes(method) || u16(cursor + 34)) mismatch();
      const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!name || names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) mismatch();
      names.add(name);
      expanded += size;
      if (expanded > 64 * 1024 * 1024 || compressed > bytes.length || local >= directory) mismatch();
      if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameLength) mismatch();
      const localName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(local + 30, local + 30 + nameLength));
      const dataStart = local + 30 + nameLength + u16(local + 28);
      if (localName !== name || dataStart + compressed > directory) mismatch();
      if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== size)) mismatch();
      if (method === 0 && compressed !== size) mismatch();
      ranges.push([local, dataStart + compressed]);
      cursor = next;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (cursor !== end || ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1][1])) mismatch();
    const parts: Record<string, string> = { ".docx": "word/document.xml", ".xlsx": "xl/workbook.xml", ".pptx": "ppt/presentation.xml" };
    if (!names.has("[Content_Types].xml") || !names.has("_rels/.rels") || !names.has(parts[extension])) mismatch();
    if (Object.entries(parts).some(([ext, part]) => ext !== extension && names.has(part))) mismatch();
    if ([...names].some((name) => /(?:vbaProject\.bin|vbaData\.xml)$/iu.test(name))) mismatch();
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    mismatch();
  }
}

export function assertFileContent(filename: string, bytes: Uint8Array): void {
  const extension = extensionOf(filename);
  if ([".docx", ".xlsx", ".pptx"].includes(extension)) return assertOfficePackage(bytes, extension);
  if (extension === ".pdf") {
    if (!/^%PDF-\d\.\d[\r\n]/u.test(new TextDecoder().decode(bytes.subarray(0, 9)))) mismatch();
  } else if (extension === ".png") {
    if (!startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) mismatch();
  } else if (extension === ".jpg" || extension === ".jpeg") {
    if (!startsWith(bytes, [255, 216, 255])) mismatch();
  } else if (extension === ".txt" || extension === ".csv") {
    decodeFileText(bytes);
    // PDF is printable ASCII, so decoding alone cannot distinguish it.
    if (startsWith(bytes, [37, 80, 68, 70, 45])) mismatch();
  } else mismatch();
}
