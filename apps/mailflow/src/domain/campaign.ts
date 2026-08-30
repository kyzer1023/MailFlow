/** Campaign lifecycle entrypoint kept small for API and queue consumers. */
export {
  assertCampaignTransition,
  isCampaignTransitionAllowed,
  transitionCampaign,
  CAMPAIGN_TRANSITIONS,
} from "./state";
export {
  estimateCampaignDurationSeconds,
  paceDelaySeconds,
  DEFAULT_PACE_PER_MINUTE,
  MAX_PACE_PER_MINUTE,
  MIN_PACE_PER_MINUTE,
} from "./pacing";
export type { CampaignRecord, CampaignState, CampaignCounts } from "./types";

