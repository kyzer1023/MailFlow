import { GraphApiError } from "./graph";
import type { GraphMailProviderContract } from "./graph";

export interface TestSendInput {
  subject: string;
  bodyHtml: string;
}

export interface TestSendResult {
  status: "accepted";
  userMessage: "Accepted by Microsoft";
  senderAddress: string;
  recipientAddress: string;
  graphStatus: number;
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
        to: [self],
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
