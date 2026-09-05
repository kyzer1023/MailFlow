// Presentation only: completed is the scheduler's terminal processing state.
export function completedResult(unknown: number, failed: number, skipped: number, verified = 0) {
  if (unknown > verified) return { label: "Finished, receipt unverified", tone: "unknown" };
  if (failed > 0) return { label: "Finished with recipient failures", tone: "failed" };
  if (unknown > 0) return { label: "Finished, receipt verified", tone: "completed" };
  if (skipped > 0) return { label: "Finished with skipped rows", tone: "paused" };
  return { label: "Processing finished", tone: "completed" };
}
