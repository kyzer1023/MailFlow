export interface CampaignHistoryCursor { createdAt: string; id: string }

export function historyCursor(value: CampaignHistoryCursor): string {
  return btoa(JSON.stringify({ createdAt: value.createdAt, id: value.id })).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function parseHistoryCursor(value: string | null): CampaignHistoryCursor | null {
  if (value === null) return null;
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid history cursor");
  const decoded = JSON.parse(atob(value.replace(/-/gu, "+").replace(/_/gu, "/"))) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid history cursor");
  const candidate = decoded as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2 || typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(candidate.id)
    || typeof candidate.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate.createdAt)
    || !Number.isFinite(Date.parse(candidate.createdAt))) throw new Error("Invalid history cursor");
  return { createdAt: candidate.createdAt, id: candidate.id };
}
