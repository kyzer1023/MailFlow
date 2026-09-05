import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";

export function campaignTiming(
  campaign: Pick<
    CampaignRecord,
    | "state"
    | "startedAt"
    | "completedAt"
    | "updatedAt"
    | "schedulerMessage"
    | "pacePerMinute"
  >,
  jobs: readonly RecipientJobRecord[],
  now = Date.now(),
) {
  const terminal =
    ["completed", "failed", "cancelled"].includes(campaign.state);
  const start = Date.parse(campaign.startedAt || "");
  const end = terminal
    ? Date.parse(campaign.completedAt || campaign.updatedAt)
    : now;
  const elapsedSeconds =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? Math.floor((end - start) / 1000)
      : null;
  // Use recorded processing intervals, excluding skipped rows and manual evidence.
  // At least three outcomes are needed; long gaps remain in the sample.
  const finishes = jobs
    .filter((j) => ["accepted", "failed", "unknown"].includes(j.status))
    .map((j) => Date.parse(j.updatedAt))
    .filter((t) => Number.isFinite(t) && t >= start && t <= end)
    .sort((a, b) => a - b);
  const span =
    finishes.length >= 3 ? finishes[finishes.length - 1] - finishes[0] : 0;
  const throughput =
    span >= 1000 ? ((finishes.length - 1) * 60_000) / span : null;
  const remaining = jobs.filter((j) =>
    ["pending", "claimed", "sending"].includes(j.status),
  ).length;
  const stale =
    finishes.length > 0 &&
    now - finishes[finishes.length - 1] >
      Math.max(120_000, (span / Math.max(1, finishes.length - 1)) * 3);
  const remainingMinutes =
    campaign.state === "running" &&
    !campaign.schedulerMessage &&
    !stale &&
    throughput &&
    remaining > 0
      ? Math.max(
          1,
          Math.ceil(remaining / Math.min(throughput, campaign.pacePerMinute)),
        )
      : null;
  return { elapsedSeconds, throughput, remainingMinutes };
}

export function processingDuration(seconds: number | null): string {
  if (seconds === null) return "Not started";
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}h ` : ""}${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}
