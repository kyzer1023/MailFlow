/** Recipient-job lifecycle entrypoint for API and queue consumers. */
export {
  assertRecipientTransition,
  claimRecipientJob,
  isRecipientTransitionAllowed,
  makeSendKey,
  markRecipientAccepted,
  markRecipientFailed,
  markRecipientSending,
  markRecipientUnknown,
  retryRecipientSafely,
  skipRecipientJob,
  transitionRecipientJob,
  RECIPIENT_TRANSITIONS,
} from "./state";
export type { RecipientJobRecord, RecipientStatus } from "./types";

