import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MAX_FILENAME_LENGTH,
  AttachmentError,
  type AttachmentBytes,
} from "./contracts";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
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
  if (!ALLOWED_MIME_TYPES.has(normalized)) {
    throw new AttachmentError("unsupported_type", "This attachment type is not supported");
  }

  // Word, Excel, and PowerPoint legacy/new MIME pairs are extension-specific.
  // CSV and JPEG aliases are normalized above.
  const extensionMime = inferred;
  if (extension === ".csv" && normalized === "application/vnd.ms-excel") return "text/csv";
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
  return { filename, mediaType, bytes };
}

export function assertAttachmentSetCapacity(fileCount: number, totalBytes: number, nextBytes: number): void {
  if (!Number.isInteger(fileCount) || fileCount < 0 || fileCount >= ATTACHMENT_MAX_FILES) {
    throw new AttachmentError("file_limit_exceeded", `A campaign can contain at most ${ATTACHMENT_MAX_FILES} attachments`);
  }
  if (!Number.isInteger(totalBytes) || totalBytes < 0 || totalBytes + nextBytes > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError("size_limit_exceeded", "The combined attachment size exceeds 20 MiB");
  }
}
