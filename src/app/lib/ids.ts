/** Generate a stable-enough client key for one campaign intent. */
export function requestKey(): string {
  try {
    return `campaign-${crypto.randomUUID()}`;
  } catch {
    return `campaign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Generate the temporary key used while an attachment is uploaded. */
export function localAttachmentId(): string {
  try {
    return `attachment-local-${crypto.randomUUID()}`;
  } catch {
    return `attachment-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
