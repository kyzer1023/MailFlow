import { describe, expect, it } from "vitest";
import type { MailMessage } from "../../domain/mail-provider";
import { delegatedSmtpMailProvider } from "./smtp-adapter";
import { buildMimeMessage, smtpEnvelopeRecipients } from "./smtp-mime";
import { ExchangeOnlineSmtpClient } from "./smtp";
import type { SmtpConnect, SmtpSocketLike } from "./smtp";
import { sendProviderTestToSelf } from "./test-send";

interface Script {
  commands: string[];
  mime: string | null;
  maxWriteBytes?: number;
  authCode?: number;
  finalCode?: number | null;
  dataMode?: boolean;
  failDataWriteAfterBytes?: number;
  dataBytes?: number;
}

class ScriptedSocket implements SmtpSocketLike {
  readonly opened = Promise.resolve({});
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private closed = false;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly script: Script, private readonly secure: boolean) {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        if (!secure) this.reply("220 smtp.office365.com ready");
      },
    });
    this.writable = new WritableStream<Uint8Array>({ write: (value) => this.receive(this.decoder.decode(value)) });
  }

  private reply(value: string): void {
    this.controller.enqueue(this.encoder.encode(`${value}\r\n`));
  }

  private receive(value: string): void {
    this.script.maxWriteBytes = Math.max(this.script.maxWriteBytes ?? 0, this.encoder.encode(value).byteLength);
    if (this.script.dataMode) {
      this.script.dataBytes = (this.script.dataBytes ?? 0) + this.encoder.encode(value).byteLength;
      if (this.script.failDataWriteAfterBytes && this.script.dataBytes >= this.script.failDataWriteAfterBytes) {
        throw new Error("connection lost before DATA terminator");
      }
      this.script.mime = `${this.script.mime ?? ""}${value}`;
      if (!this.script.mime.endsWith("\r\n.\r\n")) return;
      this.script.mime = this.script.mime.slice(0, -3);
      this.script.dataMode = false;
      if (this.script.finalCode === null) throw new Error("connection lost after DATA");
      this.reply(`${this.script.finalCode ?? 250} submission result`);
      return;
    }
    const command = value.replace(/\r\n$/, "");
    this.script.commands.push(command.startsWith("AUTH XOAUTH2 ") ? "AUTH XOAUTH2 [redacted]" : command);
    if (command.startsWith("EHLO ")) {
      this.reply(this.secure ? "250-smtp.office365.com\r\n250-AUTH XOAUTH2\r\n250 SIZE 36700160" : "250-smtp.office365.com\r\n250 STARTTLS");
    } else if (command === "STARTTLS") {
      this.reply("220 ready for TLS");
    } else if (command.startsWith("AUTH XOAUTH2 ")) {
      this.reply(`${this.script.authCode ?? 235} authentication result`);
    } else if (command.startsWith("MAIL FROM:")) {
      this.reply("250 sender accepted");
    } else if (command.startsWith("RCPT TO:")) {
      this.reply("250 recipient accepted");
    } else if (command === "DATA") {
      this.script.dataMode = true;
      this.reply("354 send content");
    } else if (command === "QUIT") {
      this.reply("221 closing");
    }
  }

  startTls(): SmtpSocketLike {
    return new ScriptedSocket(this.script, true);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // A scripted stream may already be errored by the scenario.
    }
  }
}

function fixture(script: Partial<Script> = {}): { client: ExchangeOnlineSmtpClient; script: Script } {
  const state: Script = { commands: [], mime: null, ...script };
  const connect: SmtpConnect = () => new ScriptedSocket(state, false);
  return { client: new ExchangeOnlineSmtpClient({ connect, timeoutMs: 1_000 }), script: state };
}

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    to: "recipient@example.test",
    cc: ["copy@example.test"],
    bcc: ["hidden@example.test"],
    replyTo: ["reply@example.test"],
    importance: "high",
    subject: "Fixture subject",
    htmlBody: "<p>Hello fixture</p>",
    ...overrides,
  };
}

describe("SMTP MIME generation", () => {
  it("builds multiple byte-exact attachments without exposing BCC headers", () => {
    const input = message({
      subject: "Résumé fixture",
      attachments: [
        { filename: "proof one.txt", contentType: "text/plain", content: new TextEncoder().encode("first") },
        { filename: "报告.pdf", contentType: "application/pdf", content: new Uint8Array([0, 1, 2, 253, 254, 255]) },
      ],
    });
    const mime = buildMimeMessage(input, {
      senderAddress: "sender@example.test",
      boundary: "fixture_boundary",
      messageId: "<fixture@mailflow.local>",
      now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="fixture_boundary"');
    expect(mime).toContain('filename="proof one.txt"');
    expect(mime).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
    expect(mime).toContain("Zmlyc3Q=");
    expect(mime).toContain("AAEC/f7/");
    expect(mime).not.toContain("Bcc:");
    expect(smtpEnvelopeRecipients(input)).toEqual(["recipient@example.test", "copy@example.test", "hidden@example.test"]);
  });

  it("rejects header injection and oversized attachment collections", () => {
    expect(() => buildMimeMessage(message({ subject: "hello\r\nBcc: attacker@example.test" }), { senderAddress: "sender@example.test" })).toThrow("Subject");
    expect(() => buildMimeMessage(message({ attachments: [{ filename: "large.bin", contentType: "application/octet-stream", content: new Uint8Array(20 * 1024 * 1024 + 1) }] }), { senderAddress: "sender@example.test" })).toThrow("20 MiB");
  });
});

describe("Exchange Online SMTP client", () => {
  it("performs an authentication-only probe and then quits", async () => {
    const test = fixture();
    await expect(test.client.probe("access-token-fixture", "sender@example.test")).resolves.toEqual({ greetingCode: 220, startTlsCode: 220, authCode: 235, quitCode: 221 });
    expect(test.script.commands).toContain("AUTH XOAUTH2 [redacted]");
    expect(test.script.commands).toContain("QUIT");
    expect(test.script.commands.some((command) => /^(MAIL FROM|RCPT TO|DATA)/.test(command))).toBe(false);
  });

  it("submits one MIME message and includes BCC only in the envelope", async () => {
    const test = fixture();
    await expect(test.client.send("access-token-fixture", "sender@example.test", message())).resolves.toEqual({ accepted: true, status: 250 });
    expect(test.script.commands).toContain("MAIL FROM:<sender@example.test>");
    expect(test.script.commands).toContain("RCPT TO:<hidden@example.test>");
    expect(test.script.mime).toContain("Subject: =?UTF-8?B?");
    expect(test.script.mime).not.toContain("Bcc:");
  });

  it("streams attachment MIME in bounded socket writes", async () => {
    const content = new Uint8Array(512 * 1024 + 7);
    content.fill(0xab);
    const test = fixture();
    await expect(test.client.send("access-token-fixture", "sender@example.test", message({
      attachments: [{ filename: "streamed.bin", contentType: "application/octet-stream", content }],
    }))).resolves.toEqual({ accepted: true, status: 250 });
    expect(test.script.mime).toContain('filename="streamed.bin"');
    expect(test.script.maxWriteBytes).toBeLessThan(100 * 1024);
  });

  it("includes the campaign attachment set in a test-to-self message", async () => {
    const test = fixture();
    const provider = delegatedSmtpMailProvider(test.client, "access-token-fixture", "sender@example.test");
    await expect(sendProviderTestToSelf(provider, "sender@example.test", {
      subject: "Attachment preview",
      bodyHtml: "<p>Review</p>",
      attachments: [{ filename: "proof.txt", contentType: "text/plain", content: new TextEncoder().encode("proof") }],
    })).resolves.toMatchObject({ status: "accepted", smtpStatus: 250 });
    expect(test.script.commands).toContain("RCPT TO:<sender@example.test>");
    expect(test.script.mime).toContain('filename="proof.txt"');
    expect(test.script.mime).toContain("cHJvb2Y=");
  });

  it("marks a lost final submission response unknown", async () => {
    const test = fixture({ finalCode: null });
    const result = await delegatedSmtpMailProvider(test.client, "access-token-fixture", "sender@example.test").send(message());
    expect(result).toMatchObject({ kind: "unknown", category: "ambiguous" });
  });

  it("allows retry when the connection fails before the DATA terminator", async () => {
    const test = fixture({ failDataWriteAfterBytes: 64 });
    const result = await delegatedSmtpMailProvider(test.client, "access-token-fixture", "sender@example.test").send(message({
      attachments: [{ filename: "retryable.txt", contentType: "text/plain", content: new Uint8Array(1024) }],
    }));
    expect(result).toMatchObject({ kind: "retryable", safeToRetry: true });
  });

  it("safely retries an explicit transient rejection and fails a rejected OAuth token", async () => {
    const transient = fixture({ finalCode: 451 });
    await expect(delegatedSmtpMailProvider(transient.client, "access-token-fixture", "sender@example.test").send(message())).resolves.toMatchObject({ kind: "retryable", safeToRetry: true, category: "throttle" });

    const denied = fixture({ authCode: 535 });
    await expect(delegatedSmtpMailProvider(denied.client, "access-token-fixture", "sender@example.test").send(message())).resolves.toMatchObject({ kind: "failed", category: "authentication" });
    expect(denied.script.commands.some((command) => command.startsWith("MAIL FROM"))).toBe(false);
  });

  it("treats an unreadable stored refresh token as authentication failure before SMTP", async () => {
    const test = fixture();
    const provider = delegatedSmtpMailProvider(test.client, async () => {
      throw Object.assign(new Error("Stored Microsoft sign-in could not be opened"), { code: "refresh_token_crypto_failed" });
    }, "sender@example.test");

    await expect(provider.send(message())).resolves.toEqual({
      kind: "failed",
      category: "authentication",
      message: "Reconnect Microsoft before sending this campaign",
    });
    expect(test.script.commands).toEqual([]);
  });
});
