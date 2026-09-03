import type { AddressSeparator } from "./types";

export const DEFAULT_PACE_PER_MINUTE = 12;
export const MIN_PACE_PER_MINUTE = 1;
export const MAX_PACE_PER_MINUTE = 600;
export const MAX_QUEUE_DELAY_SECONDS = 86_400;

export function validatePacePerMinute(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= MIN_PACE_PER_MINUTE && value <= MAX_PACE_PER_MINUTE;
}

/** Delay between two messages for a paced campaign. */
export function paceDelaySeconds(pacePerMinute: number): number {
  const pace = validatePacePerMinute(pacePerMinute) ? pacePerMinute : DEFAULT_PACE_PER_MINUTE;
  return Math.max(1, Math.ceil(60 / pace));
}

export function estimateCampaignDurationSeconds(recipientCount: number, pacePerMinute: number): number {
  if (!Number.isFinite(recipientCount) || recipientCount <= 0) return 0;
  return Math.max(0, Math.ceil(recipientCount) - 1) * paceDelaySeconds(pacePerMinute);
}

/**
 * Parse an HTTP Retry-After value without depending on a runtime's Headers
 * implementation. Numeric values are seconds; dates are measured from now.
 */
export function parseRetryAfterSeconds(
  value: number | string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.ceil(value));
  }
  if (value instanceof Date) {
    return retryAfterFromDate(value, now);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    return parseRetryAfterSeconds(Number(trimmed), now);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return retryAfterFromDate(date, now);
}

function retryAfterFromDate(value: Date, now: Date): number {
  return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(0, Math.ceil((value.getTime() - now.getTime()) / 1_000)));
}

export function addressSeparatorPattern(separator: AddressSeparator): RegExp {
  switch (separator) {
    case "semicolon":
      return /;/u;
    case "newline":
      return /\r?\n/u;
    case "auto":
      return /[,;\r\n]+/u;
    case "comma":
    default:
      return /,/u;
  }
}

