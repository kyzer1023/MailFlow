import { DomainError } from "./errors";

export function makeSendKey(campaignId: string, sourceRow: number): string {
  const normalizedCampaignId = campaignId.trim();
  if (!normalizedCampaignId || !Number.isSafeInteger(sourceRow) || sourceRow < 1) {
    throw new DomainError("invalid_input", "A campaign id and positive source row are required for a send key.");
  }
  // Campaign ids are opaque and source rows are 1-based. The unique database
  // constraint is the final guard against accidental duplicate insertion.
  return `${normalizedCampaignId}:${sourceRow}`;
}
