import { GraphApiError } from "./graph";
import type { GraphMailProviderContract } from "./graph";
import type { MailImportance } from "../../domain/types";
import type { MailAttachment, MailProvider } from "../../domain/mail-provider";

export interface TestSendInput {
  subject: string;
  bodyHtml: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  replyTo?: readonly string[];
  importance?: MailImportance;
  attachments?: readonly MailAttachment[];
}

export interface TestSendResult {
  status: "accepted";
  userMessage: "Accepted by Microsoft";
  senderAddress: string;
  recipientAddress: string;
  graphStatus?: number;
  smtpStatus?: number;
  requestId?: string;
}

export class TestSendError extends Error {
  readonly code = "test_send_failed";

  constructor(
    message = "A test message could not be prepared",
    readonly safeToRetry = false,
    readonly retryAfter: number | string | Date | null = null,
    readonly category: string | null = null,
    readonly diagnosticId?: string,
  ) {
    super(message);
    this.name = "TestSendError";
  }
}

function mailboxAddress(mail: string | null, userPrincipalName: string | null): string | null {
  const value = (mail ?? userPrincipalName ?? "").trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Send one rendered message to the authenticated mailbox. The provider is
 * always addressed through `/me`; callers cannot select an arbitrary From
 * mailbox or add any recipient or reply routing outside that mailbox.
 */
export class TestSendService {
  constructor(private readonly provider: GraphMailProviderContract) {}

  async sendToSelf(accessToken: string, input: TestSendInput): Promise<TestSendResult> {
    if (!input || typeof input.subject !== "string" || typeof input.bodyHtml !== "string" || !input.subject.trim()) {
      throw new TestSendError("Add a subject and message before sending a test", true);
    }
    let user;
    try {
      user = await this.provider.getCurrentUser(accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The signed-in Microsoft mailbox could not be checked";
      throw new TestSendError(message, true);
    }
    const self = mailboxAddress(user.mail, user.userPrincipalName);
    if (!self) throw new TestSendError("The signed-in Microsoft mailbox has no usable address", true);
    if (input.attachments?.length) {
      throw new TestSendError("Attachments require the SMTP transport", true);
    }

    try {
      const result = await this.provider.sendMail(accessToken, {
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        importance: input.importance ?? "normal",
        to: [self],
        cc: [],
        bcc: [],
        replyTo: [],
        saveToSentItems: true,
      });
      return {
        status: "accepted",
        userMessage: "Accepted by Microsoft",
        senderAddress: self,
        recipientAddress: self,
        graphStatus: result.status,
        requestId: result.requestId,
      };
    } catch (error) {
      if (error instanceof GraphApiError) throw error;
      throw new TestSendError();
    }
  }
}

export async function sendTestToSelf(
  provider: GraphMailProviderContract,
  accessToken: string,
  input: TestSendInput,
): Promise<TestSendResult> {
  return new TestSendService(provider).sendToSelf(accessToken, input);
}

export async function sendProviderTestToSelf(
  provider: MailProvider,
  senderAddress: string,
  input: TestSendInput,
  sendKey = `test:${crypto.randomUUID()}`,
): Promise<TestSendResult> {
  const self = mailboxAddress(senderAddress, null);
  if (!self) throw new TestSendError("The signed-in Microsoft mailbox has no usable address", true);
  if (!input || typeof input.subject !== "string" || typeof input.bodyHtml !== "string" || !input.subject.trim()) {
    throw new TestSendError("Add a subject and message before sending a test", true);
  }
  const result = await provider.send({
    to: self,
    cc: [],
    bcc: [],
    replyTo: [],
    importance: input.importance ?? "normal",
    subject: input.subject,
    htmlBody: input.bodyHtml,
    attachments: input.attachments,
  }, { sendKey });
  if (result.kind !== "accepted") {
    throw new TestSendError(
      result.message,
      result.kind !== "unknown",
      result.kind === "retryable" ? result.retryAfter ?? null : null,
      result.kind === "retryable" ? result.category : result.kind,
      result.diagnosticId,
    );
  }
  return {
    status: "accepted",
    userMessage: "Accepted by Microsoft",
    senderAddress: self,
    recipientAddress: self,
    smtpStatus: 250,
  };
}
