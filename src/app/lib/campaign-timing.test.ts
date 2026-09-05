import { describe, expect, it } from "vitest";
import type { CampaignRecord, RecipientJobRecord } from "../../domain/types";
import { campaignTiming, processingDuration } from "./campaign-timing";
import { formatTimestamp } from "./format";

const start = Date.parse("2026-09-05T00:00:00.000Z");
const campaign = {
  state: "running",
  startedAt: new Date(start).toISOString(),
  completedAt: null,
  updatedAt: new Date(start + 90_000).toISOString(),
  pacePerMinute: 12,
} as CampaignRecord;
const jobs = ["accepted", "unknown", "failed", "pending"].map(
  (status, index) => ({
    status,
    updatedAt: new Date(start + (index + 1) * 30_000).toISOString(),
  }),
) as RecipientJobRecord[];
describe("processing timing", () => {
  it("uses observed outcomes, excludes skips, and preserves timing after manual verification", () => {
    const result = campaignTiming(campaign, jobs, start + 95_000);
    expect(result).toEqual({
      elapsedSeconds: 95,
      throughput: 2,
      remainingMinutes: 1,
    });
    expect(
      campaignTiming(
        campaign,
        [
          ...jobs,
          {
            status: "skipped",
            updatedAt: new Date(start).toISOString(),
          } as RecipientJobRecord,
        ],
        start + 95_000,
      ),
    ).toEqual(result);
    expect(
      campaignTiming(
        campaign,
        jobs.map((j) => ({
          ...j,
          deliveryVerifiedAt: new Date(start + 1_000_000).toISOString(),
        })),
        start + 95_000,
      ),
    ).toEqual(result);
  });
  it("suppresses unsupported estimates for paused, waiting, stale, terminal and sparse states", () => {
    for (const state of ["paused", "queued", "completed", "failed"] as const)
      expect(
        campaignTiming({ ...campaign, state }, jobs, start + 95_000)
          .remainingMinutes,
      ).toBeNull();
    expect(
      campaignTiming(
        { ...campaign, schedulerMessage: "Waiting" },
        jobs,
        start + 95_000,
      ).remainingMinutes,
    ).toBeNull();
    expect(
      campaignTiming(campaign, jobs, start + 900_000).remainingMinutes,
    ).toBeNull();
    expect(
      campaignTiming(campaign, jobs.slice(1), start + 95_000).remainingMinutes,
    ).toBeNull();
    expect(
      campaignTiming({ ...campaign, startedAt: null }, jobs).elapsedSeconds,
    ).toBeNull();
  });
  it("freezes terminal elapsed time independently of timezone", () => {
    expect(
      campaignTiming(
        {
          ...campaign,
          state: "completed",
          completedAt: new Date(start + 168_000).toISOString(),
        },
        jobs,
      ).elapsedSeconds,
    ).toBe(168);
    expect(processingDuration(168)).toBe("2m 48s");
    expect(formatTimestamp("2026-09-04T19:20:57.456Z", "Asia/Kuala_Lumpur")).toMatch(
      /03:20:57.*GMT\+8/,
    );
  });
});
