import { formatMalaysiaDateTime } from "../../domain/mailbox-scheduler";

export function formatTimestamp(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value))} MYT (UTC+8)`;
}

/** Format an ISO timestamp for the compact labels used by the app shell. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/gu;

/** Present scheduler notices in the product's Malaysia operating timezone. */
export function formatSchedulerNotice(message: string, nextAttemptAt: string | null | undefined): string {
  let includesTime = false;
  const formattedMessage = message.replace(ISO_TIMESTAMP_PATTERN, (timestamp) => {
    includesTime = true;
    return formatMalaysiaDateTime(timestamp);
  });
  if (formattedMessage.includes("(Malaysia time, GMT+8)")) includesTime = true;
  if (!nextAttemptAt || includesTime) return formattedMessage;
  return `${formattedMessage} Next check: ${formatMalaysiaDateTime(nextAttemptAt)}.`;
}
