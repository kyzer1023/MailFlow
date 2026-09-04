/**
 * Keep campaign JSON comfortably below the Worker's fixed 128 MB isolate
 * memory after decoding, parsing, validation, and fingerprinting copies.
 */
export const MAX_CAMPAIGN_CREATE_BODY_BYTES = 8 * 1024 * 1024;

/**
 * D1 limits both a bound string and a stored row to 2,000,000 bytes. Leave
 * headroom for JSON framing and the recipient row's remaining columns.
 */
export const MAX_RECIPIENT_SNAPSHOT_BYTES = 1_500_000;
