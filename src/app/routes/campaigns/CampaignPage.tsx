import {
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  DownloadSimple,
  Envelope,
  FlowArrow,
  MinusCircle,
  PaperPlaneTilt,
  Pause,
  Play,
  Rows,
  SpinnerGap,
  WarningCircle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CampaignCounts, RecipientJobRecord } from "../../../domain/types";
import {
  downloadCampaignExport,
  getCampaign,
  getCampaignJobs,
  pauseCampaign,
  cancelCampaign,
  resumeCampaign,
  type CampaignResponse,
} from "../../api";
import { StatusChip } from "../../components/common/StatusChip";
import { AppShell } from "../../components/shell/AppShell";
import { formatTimestamp, formatSchedulerNotice } from "../../lib/format";
import { campaignTiming, processingDuration } from "../../lib/campaign-timing";
import { completedResult, campaignActivity } from "../../lib/campaign-result";
import { Modal } from "../../components/common/Modal";
import { DeliveryVerification } from "../../components/common/DeliveryVerification";
import { useApi } from "../../state/api-context";

type CampaignAction = "idle" | "pause" | "resume" | "cancel";

const CAMPAIGN_JOB_PAGE_SIZE = 500;
const RECIPIENT_JOBS_PER_PAGE = 9;

export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { csrfToken, user, refreshDashboard } = useApi();
  const [campaignState, setCampaignState] = useState<CampaignResponse["campaign"] | null>(null);
  const [counts, setCounts] = useState<CampaignCounts | null>(null);
  const [jobs, setJobs] = useState<readonly RecipientJobRecord[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionState, setActionState] = useState<CampaignAction>("idle");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);
  const focusAfterCancel = useRef(false);
  const [copied, setCopied] = useState(false);
  const [jobPage, setJobPage] = useState(1);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const sequence = ++loadSequence.current;
    try {
      const [campaignResponse, jobsResponse] = await Promise.all([
        getCampaign(campaignId),
        getCampaignJobs(campaignId, CAMPAIGN_JOB_PAGE_SIZE, 0),
      ]);
      if (sequence !== loadSequence.current) return;
      setCampaignState(campaignResponse.campaign);
      setCounts(campaignResponse.counts);
      setJobs(jobsResponse.jobs);
      setJobPage((currentPage) => Math.min(
        currentPage,
        Math.max(1, Math.ceil(jobsResponse.jobs.length / RECIPIENT_JOBS_PER_PAGE)),
      ));
      setLoadError("");
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setCampaignState(null);
      setCounts(null);
      setJobs(null);
      setLoadError(error instanceof Error ? error.message : "The campaign could not be loaded.");
    }
  }, [campaignId]);

  useEffect(() => {
    setJobPage(1);
    void load();
    if (!campaignId) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      loadSequence.current += 1;
      window.clearInterval(timer);
    };
  }, [load, campaignId]);

  useEffect(() => {
    if (focusAfterCancel.current && ["cancelled", "cancelling"].includes(campaignState?.state ?? "")) {
      focusAfterCancel.current = false;
      statusRef.current?.focus();
    }
  }, [campaignState?.state]);

  if (!campaignId) {
    return (
      <AppShell>
        <div className="route-gate" role="status">
          <WarningCircle weight="fill" />
          <h1>No campaign selected.</h1>
          <p>Choose a campaign from Campaign history.</p>
          <Link className="button button--outline" to="/campaigns">View campaigns</Link>
        </div>
      </AppShell>
    );
  }

  const paused = campaignState?.state === "paused";
  const failedCampaign = campaignState?.state === "failed";
  const completedCampaign = campaignState?.state === "completed";
  const cancelling = campaignState?.state === "cancelling";
  const cancelled = campaignState?.state === "cancelled";
  const cancellation = cancelling || cancelled;
  const attachmentAuthorizationPaused = paused && campaignState?.attachmentIssueCode === "attachment_authorization_required";
  const activeCounts = counts || { pending: 0, claimed: 0, sending: 0, accepted: 0, skipped: 0, failed: 0, unknown: 0 };
  const total = campaignState?.totalRecipients || 0;
  const processed = activeCounts.accepted + activeCounts.failed + activeCounts.skipped + activeCounts.unknown;
  const notSent = activeCounts.pending;
  const progress = campaignState ? Math.min(100, Math.round((processed / Math.max(1, total)) * 100)) : 0;
  const routeCounts: readonly (readonly [string, number, Icon])[] = failedCampaign
    ? [
        ["Total", total, Rows],
        ["Not sent", notSent, Clock],
        ["Accepted", activeCounts.accepted, Check],
        ["Skipped", activeCounts.skipped, MinusCircle],
        ["Recipient failed", activeCounts.failed, WarningCircle],
        ["Unknown", activeCounts.unknown, WarningCircle],
      ]
    : [
        ["Total", total, Rows],
        [cancellation ? "Not sent" : "Pending", activeCounts.pending, Clock],
        ["Sending", activeCounts.sending + activeCounts.claimed, PaperPlaneTilt],
        ["Accepted", activeCounts.accepted, Check],
        ["Skipped", activeCounts.skipped, MinusCircle],
        ["Recipient failed", activeCounts.failed, WarningCircle],
        ["Unknown", activeCounts.unknown, WarningCircle],
      ];
  const displayJobs = jobs || [];
  const verifiedCount = displayJobs.filter(job => job.status === "unknown" && job.deliveryVerifiedAt).length;
  const unverifiedCount = Math.max(0, activeCounts.unknown - verifiedCount);
  const result = completedResult(activeCounts.unknown, activeCounts.failed, activeCounts.skipped, verifiedCount);
  const resultSummary = `${activeCounts.accepted} accepted by Microsoft, ${activeCounts.failed} failed, ${activeCounts.unknown} unknown, ${activeCounts.skipped} skipped`;
  const timing = campaignState ? campaignTiming(campaignState, displayJobs) : null;
  const jobPageCount = Math.max(1, Math.ceil(displayJobs.length / RECIPIENT_JOBS_PER_PAGE));
  const firstJobIndex = (jobPage - 1) * RECIPIENT_JOBS_PER_PAGE;
  const visibleJobs = displayJobs.slice(firstJobIndex, firstJobIndex + RECIPIENT_JOBS_PER_PAGE);
  const firstVisibleJob = displayJobs.length > 0 ? firstJobIndex + 1 : 0;
  const lastVisibleJob = Math.min(firstJobIndex + RECIPIENT_JOBS_PER_PAGE, displayJobs.length);
  const sender = campaignState?.senderAddress || user?.mailboxAddress || "Sender not available";
  const statusKind = campaignState?.state || "unknown";
  const activity = campaignState ? campaignActivity(campaignState) : null;
  const waiting = activity?.tone === "waiting";
  const waitingMessage = activity?.detail ?? "";
  const statusLabel = completedCampaign ? result.label : activity?.label ?? (loadError ? "Unavailable" : "Loading");
  const allSubmitted = completedCampaign && total > 0 && activeCounts.accepted === total;


  const updateAction = async (action: Exclude<CampaignAction, "idle">) => {
    if (actionState !== "idle" || !campaignId) return;
    if (!["queued", "running", "paused"].includes(campaignState?.state as string)) {
      if (action === "cancel") setCancelError("This campaign has already stopped. Close this dialog to review its latest results.");
      return;
    }
    if (action === "cancel" && !cancelConfirmed) return;
    setActionState(action);
    setCancelError("");
    setLoadError("");
    try {
      const response = action === "cancel"
        ? await cancelCampaign(campaignId, csrfToken)
        : action === "pause"
        ? await pauseCampaign(campaignId, csrfToken)
        : await resumeCampaign(campaignId, csrfToken);
      if (action === "cancel") { focusAfterCancel.current = true; setCancelOpen(false); }
      setCampaignState(response.campaign);
      void refreshDashboard();
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The campaign could not be updated.";
      if (action === "cancel") setCancelError(message);
      else setLoadError(message);
    } finally {
      setActionState("idle");
    }
  };

  const exportRows = async () => {
    try {
      const blob = await downloadCampaignExport(campaignId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${campaignId}-results.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The result export could not be prepared.");
    }
  };

  const copyCampaignId = async () => {
    try {
      await navigator.clipboard.writeText(campaignId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setLoadError("The campaign ID could not be copied. Select it manually instead.");
    }
  };

  return (
    <AppShell>
      <div className="page campaign-page">
        <header className="page-header campaign-header">
          <div>
            <span className="section-kicker">CAMPAIGN</span>
            <h1>{cancellation ? cancelling ? "Stopping this campaign." : "This campaign was cancelled." : failedCampaign ? "This campaign stopped safely." : attachmentAuthorizationPaused ? "Reconnect OneDrive to continue." : completedCampaign ? "Every row has a recorded outcome." : "The campaign can leave without you."}</h1>
            <p>{cancellation ? "Remaining rows will not be submitted. Mail Flow cannot withdraw mail already submitted to Microsoft." : failedCampaign ? "No additional recipient will be sent from this campaign." : attachmentAuthorizationPaused ? "Pending rows remain protected until you reconnect and resume." : completedCampaign ? "Processing is finished. Acceptance by Microsoft does not confirm inbox delivery." : "Mail Flow keeps pacing and recording each row even after this page closes."}</p>
          </div>
          <div className="header-actions">
            {!failedCampaign && !completedCampaign && !cancellation && <button
                className="button button--outline"
                onClick={() => void updateAction(paused ? "resume" : "pause")}
                disabled={actionState !== "idle" || !["queued", "running", "paused"].includes(campaignState?.state as string)}
              >
                {actionState !== "idle" ? <SpinnerGap className="spin" /> : paused ? <Play weight="fill" /> : <Pause weight="fill" />}
                {paused ? "Resume pending rows" : "Pause campaign"}
              </button>}
            {["queued", "running", "paused"].includes(campaignState?.state ?? "") && <button
              className="button button--outline" disabled={actionState !== "idle"}
              onClick={() => { setCancelConfirmed(false); setCancelError(""); setCancelOpen(true); }}
            ><X /> Cancel campaign</button>}
            <button className="button button--outline" onClick={() => navigate("/campaigns")}>
              Campaign history <X />
            </button>
          </div>
        </header>

        {cancelOpen && <Modal title="Cancel this campaign?" onClose={() => { if (actionState === "idle") setCancelOpen(false); }}>
          <form className="delivery-verification" onSubmit={(event) => { event.preventDefault(); void updateAction("cancel"); }}>
            <p>Cancellation permanently stops the remaining rows. An email already being submitted will finish and keep its actual result.</p>
            <p>Mail Flow cannot withdraw submitted mail. Accepted, failed, and unknown outcomes remain in the results.</p>
            <label className="ack"><input type="checkbox" checked={cancelConfirmed} disabled={actionState !== "idle"}
              onChange={event => setCancelConfirmed(event.target.checked)} />I understand this campaign cannot be resumed and submitted mail cannot be withdrawn.</label>
            {cancelError && <p role="alert">{cancelError}</p>}
            <div className="header-actions">
              <button type="button" className="button button--outline" disabled={actionState !== "idle"} onClick={() => setCancelOpen(false)}>Keep campaign</button>
              <button className="button button--coral" disabled={!cancelConfirmed || actionState !== "idle"}>{actionState === "cancel" ? "Cancelling..." : "Confirm cancellation"}</button>
            </div>
          </form>
        </Modal>}
        {loadError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {loadError}</div>}
        {activeCounts.unknown > 0 && <div className="notice notice--warn" role="status"><WarningCircle weight="fill" /><span><strong>{unverifiedCount > 0 ? `${unverifiedCount} unknown ${unverifiedCount === 1 ? "outcome needs" : "outcomes need"} receipt verification.` : "Receipt has been manually verified for every unknown outcome."}</strong>{unverifiedCount > 0 && "Check receipt before considering any resend. Microsoft may already have submitted these messages. "}{verifiedCount > 0 && `${verifiedCount} manually verified; original provider outcomes remain Unknown.`}</span></div>}
        {failedCampaign && <div className="notice notice--danger" role="alert"><WarningCircle weight="fill" /><span><strong>Campaign-level failure</strong>{campaignState?.pauseReason || "The campaign stopped before every pending row was sent."}</span></div>}
        {attachmentAuthorizationPaused && <div className="notice notice--warn campaign-reconnect" role="status"><WarningCircle weight="fill" /><span><strong>OneDrive needs to be reconnected</strong>Reconnect the same Microsoft account, then resume from the pending rows. Accepted and unknown rows will not be sent again.</span><a className="button button--outline button--small" href={`/auth/microsoft/onedrive/start?returnTo=${encodeURIComponent(`/campaigns/${campaignId}`)}`}>Reconnect OneDrive</a></div>}
        {(campaignState?.state === "queued" || cancellation) && <div className="notice" role="status"><Clock /><span>{activity?.detail}</span></div>}
        {waiting && <div className="notice notice--warn" role="status" aria-live="polite"><Clock weight="fill" /><span>{waitingMessage}</span></div>}

        <div className="campaign-identity" ref={statusRef} tabIndex={-1}>
          <span className="mini-mark"><Envelope weight="fill" /></span>
          <div>
            <h2>{campaignState?.sourceFilename || "Campaign details"}</h2>
            <code>{sender}</code>
          </div>
          <StatusChip status={completedCampaign ? result.tone : activity?.tone ?? statusKind}>{statusLabel}</StatusChip>
        </div>

        <section className={`panel route-summary${completedCampaign || cancelled ? " route-summary--finished" : ""}`} aria-live="polite">
          <div className="route-counts">
            {routeCounts.map(([label, count, IconComponent]) => (
              <div className={`count count--${label.toLowerCase().replace(/\s+/gu, "-")}`} key={label}>
                <span><IconComponent weight="bold" /></span>
                <strong>{count}</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>
          <div className="progress-meta">
            <span>
              {cancellation
                ? `${notSent} ${notSent === 1 ? "row will" : "rows will"} not be sent${cancelling ? "; the current attempt is settling" : " because this campaign was cancelled"}`
                : failedCampaign
                ? `${notSent} ${notSent === 1 ? "row was" : "rows were"} not sent after the campaign stopped`
                : completedCampaign
                  ? allSubmitted ? `All ${total} emails were submitted successfully to Microsoft.` : `Processing finished: ${resultSummary}`
                  : paused
                    ? "Paused, accepted and unknown rows remain protected"
                    : waiting ? "Waiting safely; remaining time is not estimated"
                      : timing?.remainingMinutes ? `About ${timing.remainingMinutes} ${timing.remainingMinutes === 1 ? "minute" : "minutes"} remaining at observed processing speed`
                        : "Remaining time is not available yet"}
              {` · ${processed} of ${total} rows processed`}
            </span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track" aria-label={`${progress}% processed`}><i style={{ width: `${progress}%` }} /></div>
        </section>

        <div className="campaign-lower">
          <section className="panel jobs-panel">
            <div className="section-heading">
              <div>
                <h2>Recipient jobs</h2>
                <p>Each spreadsheet row has one auditable outcome.</p>
              </div>
              <button className="button button--outline button--small" onClick={() => void exportRows()} disabled={!campaignState}>
                <DownloadSimple /> Export results
              </button>
            </div>
            {displayJobs.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Row</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th>Last update</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleJobs.map((job) => {
                        const status = job.status;
                        const stoppedBeforeSend = (failedCampaign || cancellation) && status === "pending";
                        const pausedBeforeSend = paused && status === "pending";
                        const visibleStatus = stoppedBeforeSend ? cancellation ? "cancelled" : "not-sent" : status;
                        const statusText = stoppedBeforeSend
                          ? "Not sent"
                          : status === "accepted"
                            ? "Accepted by Microsoft"
                            : status[0].toUpperCase() + status.slice(1);
                        const note = stoppedBeforeSend
                          ? cancellation ? "Not sent because this campaign was cancelled" : "Campaign stopped before this row"
                          : pausedBeforeSend
                            ? "Paused before send"
                            : (job.lastErrorMessage ? formatSchedulerNotice(job.lastErrorMessage) : "") || (status === "unknown" ? "Outcome unknown. Check receipt before any resend." : status === "accepted" ? "Request accepted" : status === "pending" ? "Queued" : "Waiting for Microsoft");
                        return (
                          <tr key={`${job.recipient}-${job.sourceRow}`}>
                            <td><strong>{job.recipient}</strong></td>
                            <td>{job.sourceRow}</td>
                            <td>
                              <StatusChip status={visibleStatus}>{statusText}</StatusChip>
                            </td>
                            <td>{job.attemptCount}</td>
                            <td>{formatTimestamp(job.updatedAt)}</td>
                            <td><div className="recipient-outcome-note"><p>{note}</p>{status === "unknown" && <DeliveryVerification job={job} csrfToken={csrfToken} onVerified={() => { void load(); void refreshDashboard(); }} />}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="table-footer">
                  <span>Showing {firstVisibleJob}-{lastVisibleJob} of {displayJobs.length} recipient jobs</span>
                  <nav className="table-pagination" aria-label="Recipient job pages">
                    <button
                      className="button button--outline button--small"
                      type="button"
                      aria-label="Previous recipient jobs page"
                      title="Previous page"
                      onClick={() => setJobPage((page) => Math.max(1, page - 1))}
                      disabled={jobPage === 1}
                    >
                      <CaretLeft aria-hidden="true" />
                    </button>
                    <span aria-live="polite">Page {jobPage} of {jobPageCount}</span>
                    <button
                      className="button button--outline button--small"
                      type="button"
                      aria-label="Next recipient jobs page"
                      title="Next page"
                      onClick={() => setJobPage((page) => Math.min(jobPageCount, page + 1))}
                      disabled={jobPage === jobPageCount}
                    >
                      <CaretRight aria-hidden="true" />
                    </button>
                  </nav>
                </footer>
              </>
            ) : (
              <div className="empty-state">{campaignState ? "Recipient jobs will appear as the campaign starts." : "Loading recipient jobs..."}</div>
            )}
          </section>

          <aside className="campaign-aside">
            <section className={`panel recovery-card${failedCampaign ? " recovery-card--failed" : ""}`}>
              <span className="route-dot"><FlowArrow /></span>
              <h2>{cancellation ? "Cancellation is permanent" : failedCampaign ? "Campaign stopped" : attachmentAuthorizationPaused ? "Reconnect, then resume" : "If something interrupts"}</h2>
              <p>{cancellation ? "Pending rows will not be submitted, and this campaign cannot be resumed." : failedCampaign ? "This is a campaign-level failure. Pending rows were not attempted." : attachmentAuthorizationPaused ? "The immutable attachment set and pending rows are still safe." : "Mail Flow recovers unsent work safely."}</p>
              <strong>{failedCampaign ? `${activeCounts.failed} recipient-level ${activeCounts.failed === 1 ? "failure" : "failures"}, ${activeCounts.unknown} unknown, and ${notSent} not sent.` : "Accepted and unknown outcomes are never sent again automatically."}</strong>
              {attachmentAuthorizationPaused && <a className="button button--outline button--small" href={`/auth/microsoft/onedrive/start?returnTo=${encodeURIComponent(`/campaigns/${campaignId}`)}`}>Reconnect OneDrive</a>}
            </section>
            <section className="panel campaign-details">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">CAMPAIGN DETAILS</span>
                  <h2>Useful audit information</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Campaign ID</dt>
                  <dd>
                    <code>{campaignId}</code>
                    <button className="button button--text button--small" onClick={() => void copyCampaignId()}>{copied ? "Copied" : "Copy"}</button>
                  </dd>
                </div>
                <div><dt>Source file</dt><dd>{campaignState?.sourceFilename || "Not available"}</dd></div>
                <div><dt>Flow</dt><dd><code>{campaignState?.flowId || "Not available"}</code></dd></div>
                <div><dt>Template version</dt><dd><code>{campaignState?.templateVersionId || "Not available"}</code></dd></div>
                <div><dt>Created</dt><dd>{formatTimestamp(campaignState?.createdAt)}</dd></div>
                <div><dt>Started</dt><dd>{formatTimestamp(campaignState?.startedAt)}</dd></div>
                <div><dt>{cancelled ? "Cancelled" : "Processing finished"}</dt><dd>{formatTimestamp(campaignState?.completedAt)}</dd></div>
                {campaignState?.cancelRequestedAt && <div><dt>Cancellation requested</dt><dd>{formatTimestamp(campaignState.cancelRequestedAt)}</dd></div>}
                <div><dt>Elapsed since processing started</dt><dd>{processingDuration(timing?.elapsedSeconds ?? null)} (includes waits)</dd></div>
                <div><dt>Configured maximum pace</dt><dd>{campaignState?.pacePerMinute ?? "Not available"} messages/min</dd></div>
                <div><dt>Observed processing speed</dt><dd>{timing?.throughput ? `${timing.throughput.toFixed(1)} rows/min` : "Not enough completed rows"}</dd></div>
                <div><dt>Started by</dt><dd>{user?.displayName || "USM member"}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
