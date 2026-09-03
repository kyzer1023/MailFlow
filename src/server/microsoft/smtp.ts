import type { MailMessage } from "../../domain/mail-provider";
import { buildMimeMessageChunks, dotStuffMime, smtpEnvelopeRecipients } from "./smtp-mime";

export interface SmtpSocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
  startTls(): SmtpSocketLike;
}

export type SmtpConnect = (
  address: { hostname: string; port: number },
  options: { secureTransport: "starttls" },
) => SmtpSocketLike | Promise<SmtpSocketLike>;

export type SmtpErrorCategory =
  | "authentication"
  | "permission"
  | "invalid_recipient"
  | "invalid_message"
  | "policy"
  | "temporary"
  | "network"
  | "ambiguous"
  | "provider";

export class SmtpProviderError extends Error {
  readonly category: SmtpErrorCategory;
  readonly safeToRetry: boolean;
  readonly responseCode?: number;

  constructor(category: SmtpErrorCategory, message: string, details: { safeToRetry?: boolean; responseCode?: number } = {}) {
    super(message);
    this.name = "SmtpProviderError";
    this.category = category;
    this.safeToRetry = details.safeToRetry ?? false;
    this.responseCode = details.responseCode;
  }
}

export interface SmtpReply {
  code: number;
  lines: string[];
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SMTP operation timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class SmtpWire {
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private lines: string[] = [];

  constructor(private readonly socket: SmtpSocketLike, private readonly timeoutMs: number) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async writeLine(line: string): Promise<void> {
    if (/\r|\n/.test(line)) throw new SmtpProviderError("invalid_message", "An SMTP command contained an invalid line break");
    await withinTimeout(this.writer.write(this.encoder.encode(`${line}\r\n`)), this.timeoutMs);
  }

  async writeRaw(value: string): Promise<void> {
    await withinTimeout(this.writer.write(this.encoder.encode(value)), this.timeoutMs);
  }

  private takeCompleteReply(): SmtpReply | null {
    if (!this.lines.length) return null;
    const first = this.lines[0].match(/^(\d{3})([ -])/);
    if (!first) throw new SmtpProviderError("provider", "Exchange returned an invalid SMTP response");
    const finalIndex = this.lines.findIndex((line) => line.startsWith(`${first[1]} `));
    if (finalIndex < 0) return null;
    return { code: Number(first[1]), lines: this.lines.splice(0, finalIndex + 1) };
  }

  async readReply(): Promise<SmtpReply> {
    for (;;) {
      const complete = this.takeCompleteReply();
      if (complete) return complete;
      const result = await withinTimeout(this.reader.read(), this.timeoutMs);
      if (result.done) throw new Error("SMTP connection closed");
      this.buffer += this.decoder.decode(result.value, { stream: true });
      for (;;) {
        const newline = this.buffer.indexOf("\r\n");
        if (newline < 0) break;
        this.lines.push(this.buffer.slice(0, newline));
        this.buffer = this.buffer.slice(newline + 2);
      }
    }
  }

  release(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  async close(): Promise<void> {
    this.release();
    await this.socket.close();
  }
}

async function cloudflareConnect(address: { hostname: string; port: number }, options: { secureTransport: "starttls" }): Promise<SmtpSocketLike> {
  const sockets = await import("cloudflare:sockets");
  return sockets.connect(address, options) as unknown as SmtpSocketLike;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function requireMailbox(address: string): string {
  const value = address.trim();
  if (!value || /[\r\n]/.test(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new SmtpProviderError("invalid_message", "The authenticated mailbox address is invalid");
  }
  return value;
}

function expect(reply: SmtpReply, expected: readonly number[], stage: string): void {
  if (expected.includes(reply.code)) return;
  if (reply.code === 535) throw new SmtpProviderError("authentication", "Microsoft rejected this mailbox's SMTP authorization", { responseCode: reply.code });
  if (reply.code === 530) throw new SmtpProviderError("permission", "USM has not enabled OAuth SMTP submission for this mailbox", { responseCode: reply.code });
  if (reply.code >= 400 && reply.code < 500) throw new SmtpProviderError("temporary", `Microsoft requested a temporary pause during ${stage}`, { safeToRetry: true, responseCode: reply.code });
  if (reply.code === 552) throw new SmtpProviderError("invalid_message", "The message is larger than the mailbox allows", { responseCode: reply.code });
  if (reply.code === 550 || reply.code === 551 || reply.code === 553) throw new SmtpProviderError("invalid_recipient", "Microsoft rejected a recipient address", { responseCode: reply.code });
  throw new SmtpProviderError("policy", `Microsoft rejected the message during ${stage}`, { responseCode: reply.code });
}

export interface SmtpClientOptions {
  hostname?: string;
  port?: number;
  clientName?: string;
  timeoutMs?: number;
  connect?: SmtpConnect;
}

export interface SmtpProbeResult {
  greetingCode: 220;
  startTlsCode: 220;
  authCode: 235;
  quitCode: 221;
}

export interface SmtpSendAccepted {
  accepted: true;
  status: 250;
}

export class ExchangeOnlineSmtpClient {
  private readonly hostname: string;
  private readonly port: number;
  private readonly clientName: string;
  private readonly timeoutMs: number;
  private readonly connector: SmtpConnect;

  constructor(options: SmtpClientOptions = {}) {
    this.hostname = options.hostname ?? "smtp.office365.com";
    this.port = options.port ?? 587;
    this.clientName = options.clientName ?? "mailflow";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.connector = options.connect ?? cloudflareConnect;
  }

  private async authenticatedWire(accessToken: string, mailboxAddress: string): Promise<{ wire: SmtpWire; auth: SmtpReply; greeting: SmtpReply; startTls: SmtpReply }> {
    if (!accessToken || /\s/.test(accessToken)) throw new SmtpProviderError("authentication", "Microsoft SMTP authorization is missing");
    const mailbox = requireMailbox(mailboxAddress);
    let socket: SmtpSocketLike | null = null;
    let wire: SmtpWire | null = null;
    try {
      socket = await this.connector({ hostname: this.hostname, port: this.port }, { secureTransport: "starttls" });
      await withinTimeout(socket.opened, this.timeoutMs);
      wire = new SmtpWire(socket, this.timeoutMs);
      const greeting = await wire.readReply();
      expect(greeting, [220], "connection");
      await wire.writeLine(`EHLO ${this.clientName}`);
      expect(await wire.readReply(), [250], "greeting");
      await wire.writeLine("STARTTLS");
      const startTls = await wire.readReply();
      expect(startTls, [220], "TLS negotiation");
      wire.release();
      socket = socket.startTls();
      await withinTimeout(socket.opened, this.timeoutMs);
      wire = new SmtpWire(socket, this.timeoutMs);
      await wire.writeLine(`EHLO ${this.clientName}`);
      const secureEhlo = await wire.readReply();
      expect(secureEhlo, [250], "secure greeting");
      if (!secureEhlo.lines.some((line) => /AUTH.*XOAUTH2/i.test(line))) {
        throw new SmtpProviderError("permission", "Microsoft did not offer OAuth SMTP authentication for this mailbox");
      }
      const xoauth2 = base64Utf8(`user=${mailbox}\x01auth=Bearer ${accessToken}\x01\x01`);
      await wire.writeLine(`AUTH XOAUTH2 ${xoauth2}`);
      let auth = await wire.readReply();
      if (auth.code === 334) {
        await wire.writeLine("");
        auth = await wire.readReply();
      }
      expect(auth, [235], "authentication");
      return { wire, auth, greeting, startTls };
    } catch (error) {
      if (wire) await wire.close().catch(() => undefined);
      else if (socket) await socket.close().catch(() => undefined);
      if (error instanceof SmtpProviderError) throw error;
      throw new SmtpProviderError("network", "MailFlow could not establish an authenticated SMTP connection", { safeToRetry: true });
    }
  }

  async probe(accessToken: string, mailboxAddress: string): Promise<SmtpProbeResult> {
    const session = await this.authenticatedWire(accessToken, mailboxAddress);
    try {
      await session.wire.writeLine("QUIT");
      const quit = await session.wire.readReply();
      expect(quit, [221], "session close");
      return { greetingCode: 220, startTlsCode: 220, authCode: 235, quitCode: 221 };
    } finally {
      await session.wire.close().catch(() => undefined);
    }
  }

  async send(accessToken: string, mailboxAddress: string, message: MailMessage): Promise<SmtpSendAccepted> {
    const sender = requireMailbox(mailboxAddress);
    let submissionMayHaveCompleted = false;
    let wire: SmtpWire | null = null;
    try {
      let mimeChunks: Iterable<string>;
      let recipients: string[];
      try {
        mimeChunks = buildMimeMessageChunks(message, { senderAddress: sender });
        recipients = smtpEnvelopeRecipients(message);
      } catch {
        throw new SmtpProviderError("invalid_message", "The message or an attachment is invalid");
      }
      const session = await this.authenticatedWire(accessToken, sender);
      wire = session.wire;
      await wire.writeLine(`MAIL FROM:<${sender}>`);
      expect(await wire.readReply(), [250], "sender validation");
      for (const recipient of recipients) {
        await wire.writeLine(`RCPT TO:<${recipient}>`);
        expect(await wire.readReply(), [250, 251], "recipient validation");
      }
      await wire.writeLine("DATA");
      expect(await wire.readReply(), [354], "message transfer");
      for (const chunk of mimeChunks) await wire.writeRaw(dotStuffMime(chunk));
      // Exchange cannot accept the message before the DATA terminator. A
      // failure while writing the terminator or awaiting its reply is the
      // first point where delivery becomes ambiguous.
      submissionMayHaveCompleted = true;
      await wire.writeRaw(".\r\n");
      const result = await wire.readReply();
      submissionMayHaveCompleted = false;
      expect(result, [250], "message submission");
      try {
        await wire.writeLine("QUIT");
        await wire.readReply();
      } catch {
        // The final 250 is authoritative. A failed QUIT cannot unsend it.
      }
      return { accepted: true, status: 250 };
    } catch (error) {
      if (submissionMayHaveCompleted) {
        throw new SmtpProviderError("ambiguous", "The SMTP connection ended after submission may have completed. The row will not be resent automatically");
      }
      if (error instanceof SmtpProviderError) throw error;
      throw new SmtpProviderError("network", "MailFlow could not complete SMTP submission", { safeToRetry: true });
    } finally {
      if (wire) await wire.close().catch(() => undefined);
    }
  }
}
