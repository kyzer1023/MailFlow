import { describe, expect, it } from "vitest";
import { AttachmentError, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from "./contracts";
import {
  assertAttachmentSetCapacity,
  containsExecutableContent,
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
  validateAttachmentInput,
} from "./policy";

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof AttachmentError) return error.code;
  }
  return "";
}

describe("attachment policy", () => {
  it("sanitizes path components, controls, and unsafe filename characters", () => {
    expect(sanitizeAttachmentFilename("C:\\Users\\member\\invite list (1).pdf")).toBe("invite list (1).pdf");
    expect(sanitizeAttachmentFilename("../../report<script>.csv\u0000")).toBe("report_script_.csv");
    expect(sanitizeAttachmentFilename("  résumé final  .txt  ")).toBe("résumé final .txt");
    expect(errorCode(() => sanitizeAttachmentFilename("../../..."))).toBe("invalid_filename");
  });

  it("accepts the supported common formats and normalizes browser aliases", () => {
    expect(normalizeAttachmentContentType("brief.pdf", "application/pdf")).toBe("application/pdf");
    expect(normalizeAttachmentContentType("brief.docx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(normalizeAttachmentContentType("data.csv", "application/vnd.ms-excel")).toBe("text/csv");
    expect(normalizeAttachmentContentType("photo.jpg", "image/pjpeg")).toBe("image/jpeg");
    expect(normalizeAttachmentContentType("notes.txt")).toBe("text/plain");
    expect(errorCode(() => normalizeAttachmentContentType("program.exe", "application/octet-stream"))).toBe("unsupported_type");
    expect(errorCode(() => normalizeAttachmentContentType("brief.pdf", "image/png"))).toBe("unsupported_type");
  });

  it("rejects empty, oversized, and unmistakably executable content", () => {
    expect(errorCode(() => validateAttachmentInput({ filename: "empty.txt", bytes: new Uint8Array(), contentType: "text/plain" }))).toBe("empty_file");
    expect(errorCode(() => validateAttachmentInput({ filename: "large.txt", bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1), contentType: "text/plain" }))).toBe("size_limit_exceeded");
    expect(errorCode(() => validateAttachmentInput({ filename: "installer.txt", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]), contentType: "text/plain" }))).toBe("executable_content");
    expect(containsExecutableContent(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toBe(true);
  });

  it("enforces the set limits before persistence", () => {
    expect(() => assertAttachmentSetCapacity(ATTACHMENT_MAX_FILES - 1, 0, 1)).not.toThrow();
    expect(errorCode(() => assertAttachmentSetCapacity(ATTACHMENT_MAX_FILES, 0, 1))).toBe("file_limit_exceeded");
    expect(errorCode(() => assertAttachmentSetCapacity(0, ATTACHMENT_MAX_BYTES, 1))).toBe("size_limit_exceeded");
  });
});
