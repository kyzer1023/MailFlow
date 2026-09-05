import { describe, expect, it } from "vitest";
import { formatSchedulerNotice, formatTimestamp } from "./format";

describe("viewer timezone formatting", () => {
  it("uses browser defaults and includes seconds and the offset", () => {
    const value = "2026-09-04T19:20:57.456Z";
    expect(formatTimestamp(value)).toBe(new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(value)));
  });
  it("converts across dates, fractional offsets and daylight saving", () => {
    expect(formatTimestamp("2026-09-04T19:20:57Z", "Asia/Kolkata")).toMatch(/00:50:57.*GMT\+5:30/);
    expect(formatTimestamp("2026-07-01T12:00:00Z", "America/New_York")).toMatch(/08:00:00.*GMT-4/);
    expect(formatTimestamp("2026-01-01T12:00:00Z", "America/New_York")).toMatch(/07:00:00.*GMT-5/);
  });
  it("localizes both legacy Malaysia notices and ISO notices without adding a second time", () => {
    const timestamp = "2026-09-04T17:28:00.000Z";
    const expected = `Wait until ${formatTimestamp(timestamp)}.`;
    expect(formatSchedulerNotice(`Wait until ${timestamp}.`, timestamp)).toBe(expected);
    expect(formatSchedulerNotice("Wait until 5 Sep 2026, 1:28 AM (Malaysia time, GMT+8).", timestamp)).toBe(expected);
    expect(formatSchedulerNotice("Waiting.", timestamp)).toBe(`Waiting. Next check: ${formatTimestamp(timestamp)}.`);
  });
  it("handles missing and invalid timestamps", () => {
    expect(formatTimestamp(null)).toBe("Not available");
    expect(formatTimestamp("invalid")).toBe("Not available");
  });
});
