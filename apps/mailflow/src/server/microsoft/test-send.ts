import { GraphApiError } from "./graph";
import type { GraphMailProviderContract } from "./graph";
import type { MailImportance } from "../../domain/types";
import type { MailProvider } from "../../domain/mail-provider";

export interface TestSendInput {
  subject: string;
  bodyHtml: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  replyTo?: readonly string[];
  importance?: MailImportance;
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

  constructor(message = "A test message could not be prepared") {
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
 * mailbox or override the recipient.
 */
export class TestSendService {
  constructor(private readonly provider: GraphMailProviderContract) {}

  async sendToSelf(accessToken: string, input: TestSendInput): Promise<TestSendResult> {
    if (!input || typeof input.subject !== "string" || typeof input.bodyHtml !== "string" || !input.subject.trim()) {
      throw new TestSendError("Add a subject and message before sending a test");
    }
    const user = await this.provider.getCurrentUser(accessToken);
    const self = mailboxAddress(user.mail, user.userPrincipalName);
    if (!self) throw new TestSendError("The signed-in Microsoft mailbox has no usable address");

    try {
      const result = await this.provider.sendMail(accessToken, {
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        importance: input.importance ?? "normal",
        to: [self],
        cc: input.cc ? [...input.cc] : undefined,
        bcc: input.bcc ? [...input.bcc] : undefined,
        replyTo: input.replyTo ? [...input.replyTo] : undefined,
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
): Promise<TestSendResult> {
  const self = mailboxAddress(senderAddress, null);
  if (!self) throw new TestSendError("The signed-in Microsoft mailbox has no usable address");
  if (!input || typeof input.subject !== "string" || typeof input.bodyHtml !== "string" || !input.subject.trim()) {
    throw new TestSendError("Add a subject and message before sending a test");
  }
  const result = await provider.send({
    to: self,
    cc: [...(input.cc ?? [])],
    bcc: [...(input.bcc ?? [])],
    replyTo: [...(input.replyTo ?? [])],
    importance: input.importance ?? "normal",
    subject: input.subject,
    htmlBody: input.bodyHtml,
  }, { sendKey: `test:${crypto.randomUUID()}` });
  if (result.kind !== "accepted") throw new TestSendError(result.message);
  return {
    status: "accepted",
    userMessage: "Accepted by Microsoft",
    senderAddress: self,
    recipientAddress: self,
    smtpStatus: 250,
  };
}
