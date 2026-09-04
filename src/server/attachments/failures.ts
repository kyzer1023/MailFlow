import { MAX_QUEUE_DELAY_SECONDS } from "../../domain/pacing";
import { AuthFlowError } from "../auth/service";
import { OAuthProviderError } from "../microsoft/oauth";
import { RefreshTokenCryptoError } from "../microsoft/token-crypto";
import { AttachmentError } from "./contracts";

export type AttachmentLoadFailureCategory =
  | "network"
  | "throttled"
  | "service_unavailable"
  | "authorization"
  | "missing_object"
  | "integrity"
  | "storage";

export type AttachmentLoadFailure =
  | {
      readonly disposition: "retry";
      readonly category: "network" | "throttled" | "service_unavailable";
      readonly retryAfterSeconds: number | null;
      readonly userMessage: string;
    }
  | {
      readonly disposition: "pause";
      readonly category: "authorization";
      readonly retryAfterSeconds: null;
      readonly userMessage: string;
    }
  | {
      readonly disposition: "fail";
      readonly category: "missing_object" | "integrity" | "storage";
      readonly retryAfterSeconds: null;
      readonly userMessage: string;
    };

const TEMPORARY_MESSAGE = "Campaign attachments are temporarily unavailable. Sending will retry automatically.";

/** Convert provider and storage errors into a bounded, user-safe recovery decision. */
export function classifyAttachmentLoadFailure(error: unknown): AttachmentLoadFailure {
  if (error instanceof AttachmentError) {
    if (
      error.transient
      || error.code === "network_error"
      || error.code === "throttled"
      || error.code === "service_unavailable"
      || error.code === "storage_temporary"
    ) {
      return {
        disposition: "retry",
        category: error.code === "network_error"
          ? "network"
          : error.code === "throttled"
            ? "throttled"
            : "service_unavailable",
        retryAfterSeconds: error.retryAfterSeconds,
        userMessage: TEMPORARY_MESSAGE,
      };
    }
    if (error.code === "authorization_error") {
      return {
        disposition: "pause",
        category: "authorization",
        retryAfterSeconds: null,
        userMessage: "Reconnect OneDrive, then resume from the pending rows.",
      };
    }
    if (error.code === "missing_object" || error.code === "storage_missing" || error.code === "not_found") {
      return {
        disposition: "fail",
        category: "missing_object",
        retryAfterSeconds: null,
        userMessage: "A campaign attachment is no longer available in OneDrive. No additional message was sent.",
      };
    }
    if (error.code === "integrity_error") {
      return {
        disposition: "fail",
        category: "integrity",
        retryAfterSeconds: null,
        userMessage: "A campaign attachment no longer matches the reviewed file. No additional message was sent.",
      };
    }
  }

  if (error instanceof RefreshTokenCryptoError || error instanceof AuthFlowError) {
    return {
      disposition: "pause",
      category: "authorization",
      retryAfterSeconds: null,
      userMessage: "Reconnect OneDrive, then resume from the pending rows.",
    };
  }

  if (error instanceof OAuthProviderError) {
    if (error.retryable) {
      return {
        disposition: "retry",
        category: error.category === "network" ? "network" : "service_unavailable",
        retryAfterSeconds: null,
        userMessage: TEMPORARY_MESSAGE,
      };
    }
    return {
      disposition: "pause",
      category: "authorization",
      retryAfterSeconds: null,
      userMessage: "Reconnect OneDrive, then resume from the pending rows.",
    };
  }

  return {
    disposition: "fail",
    category: "storage",
    retryAfterSeconds: null,
    userMessage: "Campaign attachments could not be loaded safely. No additional message was sent.",
  };
}

/** Durable exponential retry delay: 30s, 60s, 120s, up to 15 minutes. */
export function attachmentRetryDelaySeconds(retryOrdinal: number, retryAfterSeconds: number | null): number {
  const ordinal = Math.max(1, Math.min(31, Math.floor(retryOrdinal)));
  const exponential = Math.min(15 * 60, 30 * (2 ** (ordinal - 1)));
  const providerDelay = retryAfterSeconds === null ? 0 : Math.max(0, Math.floor(retryAfterSeconds));
  return Math.min(MAX_QUEUE_DELAY_SECONDS, Math.max(exponential, providerDelay));
}
