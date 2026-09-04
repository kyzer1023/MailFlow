import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateAttachmentInput, normalizeAttachmentContentType, assertAttachmentSetCapacity, ATTACHMENT_MAX_BYTES } from "./attachment-policy";
import { isSupportedAttachment } from "../client/campaign";
import { parseSpreadsheet, parseCsvText, normalizeHeaders } from "../client/spreadsheet";
import { isValidEmail } from "./validation";
import { isValidEmail as clientEmail } from "../client/validation";
import { renderTemplate as clientRender } from "../client/template";
import { renderTemplate, missingTemplateValues } from "./template";

const encode = (value: string) => new TextEncoder().encode(value);
const check = (filename: string, bytes: Uint8Array, contentType?: string) => validateAttachmentInput({ filename, bytes, contentType });
async function office(extension: string, extras: Record<string, string> = {}) {
  const parts: Record<string, string> = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" };
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file(parts[extension], "<document/>");
  for (const [name, value] of Object.entries(extras)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("shared input hardening", () => {
  it.each(["docx", "xlsx", "pptx"])("accepts %s packages and rejects renamed or truncated packages", async (extension) => {
    const bytes = await office(extension);
    expect(check(`file.${extension}`, bytes).bytes).toEqual(bytes);
    const other = extension === "xlsx" ? "docx" : "xlsx";
    expect(() => check(`file.${other}`, bytes)).toThrow(/content/);
    expect(() => check(`file.${extension}`, bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => check(`file.${extension}`, encode("PK fake zip"))).toThrow();
    expect(() => check(`file.${extension}`, encode("ordinary text"))).toThrow();
  });
  it("rejects legacy, macro, generic ZIP, and contradictory Office packages", async () => {
    for (const extension of ["doc", "xls", "ppt"]) {
      expect(() => check(`file.${extension}`, new Uint8Array([208, 207, 17, 224]))).toThrow();
      expect(isSupportedAttachment({ name: `file.${extension}`, type: "", size: 4 })).toBe(false);
    }
    expect(() => check("file.docx", encode("PK\u0003\u0004"))).toThrow();
    const macro = await office("docx", { "word/vbaProject.bin": "macro" });
    expect(() => check("file.docx", macro)).toThrow();
    const ambiguous = await office("docx", { "xl/workbook.xml": "<workbook/>" });
    expect(() => check("file.docx", ambiguous)).toThrow();
    const contradictory = await office("docx");
    contradictory[30] ^= 1;
    expect(() => check("file.docx", contradictory)).toThrow();
  });
  it("accepts supported signatures and text encodings and rejects mismatches", () => {
    const samples = [
      ["pdf", encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF")],
      ["png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      ["jpg", new Uint8Array([255, 216, 255, 224])],
      ["jpeg", new Uint8Array([255, 216, 255, 225])],
      ["txt", encode("Hello 世界\r\n")], ["csv", encode("Name,Email\nMember,member@example.test")],
    ] as const;
    for (const [extension, bytes] of samples) {
      expect(check(`file.${extension}`, bytes).mediaType).toBe(normalizeAttachmentContentType(`file.${extension}`));
      expect(() => check(`file.${extension}`, new Uint8Array([0, 1, 2]))).toThrow();
    }
    expect(check("text.txt", new Uint8Array([255, 254, 65, 0, 10, 0])).mediaType).toBe("text/plain");
    expect(check("text.csv", new Uint8Array([254, 255, 0, 65])).mediaType).toBe("text/csv");
    for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([255, 254, 65]), encode("%PDF-1.7\n"), encode("#! /bin/bash\necho hello")]) {
      expect(() => check("file.txt", bytes)).toThrow();
    }
  });
  it("agrees on extension-specific MIME types and preserves capacity limits", () => {
    for (const [name, type, valid] of [
      ["file.pdf", "image/png", false], ["file.png", "application/pdf", false],
      ["file.docx", "application/vnd.ms-excel", false], ["file.csv", "application/vnd.ms-excel", true],
      ["file.jpeg", "image/pjpeg", true], ["file.txt", "text/plain; charset=utf-8", true],
      ["file.pdf", "application/octet-stream", true], ["file.xlsx", "", true],
    ] as const) {
      expect(isSupportedAttachment({ name, type, size: 20 })).toBe(valid);
      if (valid) expect(() => normalizeAttachmentContentType(name, type)).not.toThrow();
      else expect(() => normalizeAttachmentContentType(name, type)).toThrow();
    }
    expect(() => assertAttachmentSetCapacity(4, ATTACHMENT_MAX_BYTES - 1, 1)).not.toThrow();
    for (const size of [-1, 0, NaN, Infinity, 1.5]) expect(() => assertAttachmentSetCapacity(0, 0, size)).toThrow();
    expect(() => assertAttachmentSetCapacity(5, 0, 1)).toThrow();
    expect(() => assertAttachmentSetCapacity(0, ATTACHMENT_MAX_BYTES, 1)).toThrow();
  });
  it("rejects unsupported spreadsheet filenames, binary CSV, excessive rows and cells", async () => {
    await expect(parseSpreadsheet("Name\nMember", { fileName: "file.xls" })).rejects.toMatchObject({ code: "unsupported_format" });
    await expect(parseSpreadsheet("Name\nMember", { fileName: "file.csv", format: "xlsx" })).rejects.toMatchObject({ code: "unsupported_format" });
    await expect(parseSpreadsheet(new Uint8Array([0, 1]), { fileName: "file.csv" })).rejects.toMatchObject({ code: "invalid_content" });
    expect(() => parseCsvText("x\n".repeat(10001))).toThrow(/10,000/);
    expect(() => parseCsvText("x,".repeat(100))).toThrow(/100 columns/);
    expect(() => parseCsvText("x".repeat(20001))).toThrow(/20,000/);
    expect(() => parseCsvText('Name\n"Member"junk')).toThrow(/closing quote/);
    expect(() => parseCsvText('Name\nMem"ber')).toThrow(/unexpected quote/);
    expect(normalizeHeaders(["a".repeat(20000)])[0].key.length).toBeLessThanOrEqual(160);
    expect(parseCsvText('Name,Note\nMember,"one\ntwo"')).toHaveLength(2);
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Data").getCell("CW1").value = "too wide";
    await expect(parseSpreadsheet(await workbook.xlsx.writeBuffer() as unknown as Uint8Array, { fileName: "file.xlsx" })).rejects.toThrow(/100 columns/);
  });
  it("rejects unsafe mailbox syntax consistently without accepting inherited dynamic values", () => {
    for (const value of ["a<b@example.test", "a,b@example.test", "a\u0000@example.test", "a..b@example.test", "a@-example.test", "a@exam_ple.test", "ü@example.test"]) {
      expect(isValidEmail(value)).toBe(false);
      expect(clientEmail(value)).toBe(false);
    }
    expect(isValidEmail("First.Last+tag@example.test")).toBe(true);
    expect(renderTemplate("{{constructor}}", {})).toBe("");
    expect(missingTemplateValues("{{toString}}", {})).toEqual(["toString"]);
    expect(clientRender("{{constructor}}", "<p>{{toString}}</p>", {}).missingPlaceholders).toEqual(["constructor", "toString"]);
    expect(clientRender("{{constructor}}", "<p>OK</p>", { constructor: "Own value" }).subject).toBe("Own value");
    expect(normalizeHeaders(["A", "A", "A_2"]).map((item) => item.key)).toEqual(["a", "a_2", "a_2_2"]);
  });
});
