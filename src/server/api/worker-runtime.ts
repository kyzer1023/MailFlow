import { createD1Repositories } from "../database/d1";
import {
  delegatedGraphMailProvider,
  delegatedSmtpMailProvider,
  resolveMailTransport,
} from "../microsoft";
import {
  AttachmentError,
  createAttachmentService,
  OneDriveAppFolderAttachmentStore,
  type AttachmentService,
} from "../attachments";
import { handleCampaignQueueMessage, cloudflareQueueAdapter } from "../queue";
import type { MailFlowBindings, QueueBatch } from "./contracts";
import { isCampaignTickMessage } from "./contracts";
import type { MailFlowContext } from "./context";
import { configFor, textEnv } from "./dependencies";
import {
  cleanupCampaignAttachments,
  loadCampaignAttachments,
} from "./attachments";

export async function processQueueBatch(batch: QueueBatch<unknown>, bindings: MailFlowBindings): Promise<void> {
  const queueContext = {
    env: bindings,
    req: { url: textEnv(bindings.PUBLIC_ORIGIN, "https://mailflow.invalid") } as MailFlowContext["req"],
  } as MailFlowContext;
  const repo = createD1Repositories(bindings.DB);
  let authServices: ReturnType<typeof configFor> | null = null;
  let attachmentService: AttachmentService | null = null;
  for (const message of batch.messages) {
    if (!isCampaignTickMessage(message.body)) {
      message.ack();
      continue;
    }
    try {
      if (!authServices) {
        authServices = configFor(queueContext);
        attachmentService = authServices.mailTransport === "smtp"
          ? createAttachmentService(
              repo.attachments,
              new OneDriveAppFolderAttachmentStore(async (ownerUserId) => (await authServices!.storageAuth.refreshUserAccessToken(ownerUserId)).accessToken),
            )
          : null;
      }
      const result = await handleCampaignQueueMessage(message.body, {
        campaigns: repo.campaigns,
        recipientJobs: repo.recipientJobs,
        queue: cloudflareQueueAdapter(bindings.CAMPAIGN_QUEUE),
        attachmentLoader: async (campaign) => {
          const set = await repo.attachments.getSetByCampaignId(campaign.id);
          if (!set) return [];
          if (!attachmentService) throw new AttachmentError("storage_error", "Campaign attachments are temporarily unavailable");
          return loadCampaignAttachments(repo, attachmentService, campaign);
        },
        attachmentCleanup: async (campaignId) => {
          await cleanupCampaignAttachments(repo, attachmentService, campaignId);
        },
        mailProvider: async (campaign) => {
          return authServices!.mailTransport === "smtp"
            ? delegatedSmtpMailProvider(authServices!.smtp, async () => (await authServices!.auth.refreshUserAccessToken(campaign.ownerUserId)).accessToken, campaign.senderAddress)
            : delegatedGraphMailProvider(authServices!.graph, async () => (await authServices!.auth.refreshUserAccessToken(campaign.ownerUserId)).accessToken);
        },
      });
      if (result.kind === "persistence_error") message.retry({ delaySeconds: 60 });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 60 });
    }
  }
}

/** Run the hourly OneDrive App Folder retention sweep for orphan sets. */
export async function processAttachmentCleanup(bindings: MailFlowBindings): Promise<void> {
  if (resolveMailTransport(bindings.MAIL_TRANSPORT) !== "smtp") return;
  const repo = createD1Repositories(bindings.DB);
  const queueContext = {
    env: bindings,
    req: { url: textEnv(bindings.PUBLIC_ORIGIN, "https://mailflow.invalid") } as MailFlowContext["req"],
  } as MailFlowContext;
  const { storageAuth } = configFor(queueContext);
  const service = createAttachmentService(
    repo.attachments,
    new OneDriveAppFolderAttachmentStore(async (ownerUserId) => (await storageAuth.refreshUserAccessToken(ownerUserId)).accessToken),
  );
  await service.cleanupExpiredOrphans(100);
}
