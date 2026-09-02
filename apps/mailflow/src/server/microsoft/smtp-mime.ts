import type { MailAttachment, MailMessage } from "../../domain/mail-provider";

const encoder = new TextEncoder();

export const MAX_SMTP_ATTACHMENTS = 20;
export const MAX_SMTP_RAW_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
  if (!address || /[^\x21-\x7e]/.test(address) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
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
  return `UTF-8''${encodeURIComponent(clean).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

function contentType(attachment: MailAttachment): string {
  const value = requireHeader(attachment.contentType.trim(), "Attachment content type").toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value) ? value : "application/octet-stream";
}

function importanceHeaders(importance: MailMessage["importance"]): string[] {
  if (importance === "high") return ["Importance: high", "X-Priority: 1"];
  if (importance === "low") return ["Importance: low", "X-Priority: 5"];
  return ["Importance: normal", "X-Priority: 3"];
}

function attachmentPart(boundary: string, attachment: MailAttachment): string {
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
    wrapBase64(bytesToBase64(attachment.content)),
  ].join("\r\n");
}

export interface MimeBuildOptions {
  senderAddress: string;
  boundary?: string;
  messageId?: string;
  now?: Date;
}

export function buildMimeMessage(message: MailMessage, options: MimeBuildOptions): string {
  const sender = requireAddress(options.senderAddress);
  const to = requireAddress(message.to);
  const cc = message.cc.map(requireAddress);
  const replyTo = message.replyTo.map(requireAddress);
  message.bcc.map(requireAddress);
  const subject = requireHeader(message.subject, "Subject");
  const attachments = [...(message.attachments ?? [])];
  if (attachments.length > MAX_SMTP_ATTACHMENTS) throw new Error(`A message can contain at most ${MAX_SMTP_ATTACHMENTS} attachments`);
  const rawAttachmentBytes = attachments.reduce((total, attachment) => total + attachment.content.byteLength, 0);
  if (rawAttachmentBytes > MAX_SMTP_RAW_ATTACHMENT_BYTES) throw new Error("Combined attachments exceed MailFlow's 20 MiB safety limit");

  const boundary = options.boundary ?? `mailflow_${crypto.randomUUID().replaceAll("-", "")}`;
  requireHeader(boundary, "MIME boundary");
  const messageId = requireHeader(options.messageId ?? `<${crypto.randomUUID()}@mailflow.local>`, "Message ID");
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

  if (!attachments.length) {
    return [
      ...headers,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(utf8Base64(message.htmlBody)),
    ].join("\r\n");
  }

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8Base64(message.htmlBody)),
    ...attachments.map((attachment) => attachmentPart(boundary, attachment)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function smtpEnvelopeRecipients(message: MailMessage): string[] {
  return [message.to, ...message.cc, ...message.bcc].map(requireAddress);
}

export function dotStuffMime(mime: string): string {
  return mime.replace(/(^|\r\n)\./g, "$1..");
}
