export function formatTimestamp(value: string | null | undefined, timeZone?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    timeZone, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZoneName: "shortOffset",
  }).format(new Date(value));
}

/** Compact dates use the same browser locale and timezone as detailed times. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/gu;
// Compatibility with persisted scheduler notices and the current API text.
const MALAYSIA_TIMESTAMP_PATTERN = /(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM) \(Malaysia time, GMT\+8\)/gu;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display server notice timestamps locally without changing scheduler evidence. */
export function formatSchedulerNotice(message: string, nextAttemptAt?: string | null): string {
  let includesTime = false;
  const formattedMessage = message.replace(ISO_TIMESTAMP_PATTERN, timestamp => {
    includesTime = true;
    return formatTimestamp(timestamp);
  }).replace(MALAYSIA_TIMESTAMP_PATTERN, (original, day, month, year, hour, minute, period) => {
    const monthIndex = MONTHS.indexOf(month);
    if (monthIndex < 0) return original;
    includesTime = true;
    const utc = Date.UTC(Number(year), monthIndex, Number(day), Number(hour) % 12 + (period === "PM" ? 12 : 0) - 8, Number(minute));
    return formatTimestamp(new Date(utc).toISOString());
  });
  if (!nextAttemptAt || includesTime) return formattedMessage;
  return `${formattedMessage} Next check: ${formatTimestamp(nextAttemptAt)}.`;
}
