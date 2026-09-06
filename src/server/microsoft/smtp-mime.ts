import { isValidEmail } from "../../domain/validation";
import { Buffer } from "node:buffer";
import type { MailAttachment, MailMessage } from "../../domain/mail-provider";
import { ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_BYTES } from "../../domain/attachment-policy";
import { sha256Hex } from "../auth/crypto";

const encoder = new TextEncoder();
const BASE64_INPUT_CHUNK_BYTES = 57 * 1024;

export const MAX_SMTP_HTML_BODY_BYTES = 1024 * 1024;
export const MAX_SMTP_SUBJECT_BYTES = 4 * 1024;
export const MAX_SMTP_MIME_CHUNK_BYTES = 80 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function utf8Base64(value: string): string {
  return bytesToBase64(encoder.encode(value));
}

function encodedHeader(value: string): string {
  const words: string[] = [];
  let part = "";
  for (const character of value) {
    if (encoder.encode(part + character).byteLength > 45 && part) {
      words.push(`=?UTF-8?B?${utf8Base64(part)}?=`);
      part = "";
    }
    part += character;
  }
  words.push(`=?UTF-8?B?${utf8Base64(part)}?=`);
  return words.join("\r\n ");
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function requireAddress(value: string): string {
  const address = value.trim();
  if (!isValidEmail(address)) {
    throw new Error("A mail recipient address is invalid");
  }
  return address;
}

function requireHeader(value: string, label: string): string {
  if (/\r|\n/.test(value)) throw new Error(`${label} contains an invalid line break`);
  return value;
}

function filenameParameter(filename: string): string {
  const clean = requireHeader(filename.trim(), "Attachment filename");
  if (!clean) throw new Error("Attachment filename is required");
  if (encoder.encode(clean).byteLength > 512) throw new Error("Attachment filename exceeds the MIME safety limit");
  return `UTF-8''${encodeURIComponent(clean).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

function contentType(attachment: MailAttachment): string {
  const value = requireHeader(attachment.contentType.trim(), "Attachment content type").toLowerCase();
  if (value.length > 200) throw new Error("Attachment content type exceeds the MIME safety limit");
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value) ? value : "application/octet-stream";
}

function importanceHeaders(importance: MailMessage["importance"]): string[] {
  if (importance === "high") return ["Importance: high", "X-Priority: 1"];
  if (importance === "low") return ["Importance: low", "X-Priority: 5"];
  return ["Importance: normal", "X-Priority: 3"];
}

function attachmentHeaders(boundary: string, attachment: MailAttachment): string {
  if (!attachment.content || typeof attachment.content.byteLength !== "number" || typeof attachment.content.subarray !== "function") {
    throw new Error("Attachment content is invalid");
  }
  const encodedFilename = filenameParameter(attachment.filename);
  const fallbackFilename = attachment.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return [
    `--${boundary}`,
    `Content-Type: ${contentType(attachment)}; name*=${encodedFilename}`,
    `Content-Disposition: attachment; filename="${fallbackFilename}"; filename*=${encodedFilename}`,
    "Content-Transfer-Encoding: base64",
    "",
  ].join("\r\n");
}

function* attachmentBodyChunks(content: Uint8Array): Generator<string> {
  for (let offset = 0; offset < content.byteLength; offset += BASE64_INPUT_CHUNK_BYTES) {
    const encoded = bytesToBase64(content.subarray(offset, offset + BASE64_INPUT_CHUNK_BYTES));
    yield `${wrapBase64(encoded)}\r\n`;
  }
}

function* encodedBodyChunks(content: Uint8Array): Generator<string> {
  yield* attachmentBodyChunks(content);
}

export interface MimeBuildOptions {
  senderAddress: string;
  boundary?: string;
  messageId?: string;
  now?: Date;
}

interface PreparedMimeMessage {
  headers: string[];
  htmlBody: Uint8Array;
  attachments: readonly {
    attachment: MailAttachment;
    headers: string;
  }[];
  boundary: string;
}

function prepareMimeMessage(message: MailMessage, options: MimeBuildOptions): PreparedMimeMessage {
  const sender = requireAddress(options.senderAddress);
  const to = requireAddress(message.to);
  const cc = message.cc.map(requireAddress);
  const replyTo = message.replyTo.map(requireAddress);
  const bcc = message.bcc.map(requireAddress);
  if (cc.length > 50 || bcc.length > 50 || replyTo.length > 50) {
    throw new Error("A mail recipient header contains too many addresses");
  }
  const subject = requireHeader(message.subject, "Subject");
  if (encoder.encode(subject).byteLength > MAX_SMTP_SUBJECT_BYTES) {
    throw new Error("The mail subject exceeds MailFlow's MIME safety limit");
  }
  const htmlBody = encoder.encode(message.htmlBody);
  if (htmlBody.byteLength > MAX_SMTP_HTML_BODY_BYTES) {
    throw new Error("The HTML body exceeds MailFlow's MIME safety limit");
  }
  const sourceAttachments = [...(message.attachments ?? [])];
  if (sourceAttachments.length > ATTACHMENT_MAX_FILES) {
    throw new Error(`A message can contain at most ${ATTACHMENT_MAX_FILES} attachments`);
  }
  const rawAttachmentBytes = sourceAttachments.reduce((total, attachment) => total + attachment.content.byteLength, 0);
  if (rawAttachmentBytes > ATTACHMENT_MAX_BYTES) {
    throw new Error("Combined attachments exceed MailFlow's 20 MiB safety limit");
  }
  const boundary = options.boundary ?? `mailflow_${crypto.randomUUID().replaceAll("-", "")}`;
  requireHeader(boundary, "MIME boundary");
  if (!boundary || boundary.length > 200) throw new Error("MIME boundary exceeds the safety limit");
  const attachments = sourceAttachments.map((attachment) => ({
    attachment,
    headers: attachmentHeaders(boundary, attachment),
  }));
  const messageId = requireHeader(options.messageId ?? `<${crypto.randomUUID()}@mailflow.local>`, "Message ID");
  if (!messageId || messageId.length > 998) throw new Error("Message ID exceeds the MIME safety limit");
  const headers = [
    `From: ${sender}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(replyTo.length ? [`Reply-To: ${replyTo.join(", ")}`] : []),
    `Subject: ${encodedHeader(subject)}`,
    `Date: ${(options.now ?? new Date()).toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...importanceHeaders(message.importance),
    "MIME-Version: 1.0",
  ];
  const preamble = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
  ].join("\r\n");
  if (encoder.encode(preamble).byteLength > MAX_SMTP_MIME_CHUNK_BYTES) {
    throw new Error("MIME headers exceed MailFlow's chunk safety limit");
  }
  if (attachments.some((attachment) => encoder.encode(attachment.headers).byteLength > MAX_SMTP_MIME_CHUNK_BYTES)) {
    throw new Error("Attachment MIME headers exceed MailFlow's chunk safety limit");
  }
  return { headers, htmlBody, attachments, boundary };
}

/** Stable MIME identity for proven pre-submission retries of one send key. */
export async function smtpMimeIdentityForSendKey(sendKey: string): Promise<Pick<MimeBuildOptions, "boundary" | "messageId">> {
  const key = sendKey.trim();
  if (!key || key.length > 300 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new Error("A valid send key is required for deterministic MIME identity");
  }
  const digest = await sha256Hex(encoder.encode(key));
  return {
    boundary: `mailflow_${digest.slice(0, 32)}`,
    messageId: `<${digest.slice(0, 48)}@mailflow.local>`,
  };
}

/**
 * Yield a complete MIME message in bounded chunks. Attachment bytes remain
 * in their original Uint8Arrays while each base64 segment is encoded and
 * written, avoiding a second message-sized buffer in the Worker.
 */
export function buildMimeMessageChunks(message: MailMessage, options: MimeBuildOptions): Iterable<string> {
  // Prepare eagerly so malformed headers or attachment metadata fail before
  // an SMTP DATA transaction begins.
  const prepared = prepareMimeMessage(message, options);
  return (function* chunks(): Generator<string> {
    const { headers, htmlBody, attachments, boundary } = prepared;
    if (!attachments.length) {
      yield `${[
        ...headers,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
      ].join("\r\n")}\r\n`;
      yield* encodedBodyChunks(htmlBody);
      return;
    }

    yield `${[
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
    ].join("\r\n")}\r\n`;
    yield* encodedBodyChunks(htmlBody);

    for (const { attachment, headers: attachmentHeaderBlock } of attachments) {
      yield `${attachmentHeaderBlock}\r\n`;
      yield* attachmentBodyChunks(attachment.content);
    }
    yield `--${boundary}--\r\n`;
  })();
}

/** Convenience helper for deterministic tests and small-message inspection. */
export function buildMimeMessage(message: MailMessage, options: MimeBuildOptions): string {
  return [...buildMimeMessageChunks(message, options)].join("");
}

export function smtpEnvelopeRecipients(message: MailMessage): string[] {
  return [message.to, ...message.cc, ...message.bcc].map(requireAddress);
}

export function dotStuffMime(mime: string): string {
  return mime.replace(/(^|\r\n)\./g, "$1..");
}
