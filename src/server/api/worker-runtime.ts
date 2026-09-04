import { createD1Repositories } from "../database/d1";
import { createD1AuthStores } from "../database/d1-auth";
import { createD1PublicControlStore } from "../database/d1-public-controls";
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

const RETENTION_CLEANUP_BATCH_SIZE = 500;
const RETENTION_CLEANUP_MAX_BATCHES = 10;

export async function drainCleanupBatches(
  cleanup: () => Promise<number>,
  batchSize = RETENTION_CLEANUP_BATCH_SIZE,
  maxBatches = RETENTION_CLEANUP_MAX_BATCHES,
): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const count = await cleanup();
    removed += count;
    if (count < batchSize) break;
  }
  return removed;
}

/** Run bounded hourly cleanup for authentication, controls, and attachments. */
export async function processScheduledCleanup(bindings: MailFlowBindings): Promise<void> {
  const now = Date.now();
  const authStores = createD1AuthStores(bindings.DB);
  const publicControls = createD1PublicControlStore(bindings.DB);
  await drainCleanupBatches(() => authStores.stateStore.cleanupExpired(now, RETENTION_CLEANUP_BATCH_SIZE));
  await drainCleanupBatches(() => authStores.sessionStore.cleanupExpired(now, RETENTION_CLEANUP_BATCH_SIZE));
  for (let batch = 0; batch < RETENTION_CLEANUP_MAX_BATCHES; batch += 1) {
    const result = await publicControls.cleanupExpired(now, RETENTION_CLEANUP_BATCH_SIZE);
    if (result.counters < RETENTION_CLEANUP_BATCH_SIZE && result.staleTestSends < RETENTION_CLEANUP_BATCH_SIZE) break;
  }

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

/** Compatibility name retained for existing imports and focused tests. */
export const processAttachmentCleanup = processScheduledCleanup;
