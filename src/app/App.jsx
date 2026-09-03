import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Check, Clock,
  DownloadSimple, Envelope, FlowArrow, Gauge,
  MinusCircle, PaperPlaneTilt, Pause, Play,
  Rows, SpinnerGap,
  WarningCircle, X,
} from "@phosphor-icons/react";
import { downloadCampaignExport, getCampaign, getCampaignJobs, pauseCampaign, resumeCampaign } from "./api";
import { formatDate } from "./lib/format";
import { StatusChip } from "./components/common/StatusChip";
import { AppShell } from "./components/shell/AppShell";
import { AppDataProvider, useApi } from "./state/api-context";
import { DraftProvider } from "./state/draft-context";
import { RequireProductSession } from "./routing/RequireProductSession";
import { LandingPage } from "./routes/public/LandingPage";
import { CampaignsPage } from "./routes/overview/CampaignsPage";
import { DashboardPage } from "./routes/overview/DashboardPage";
import { FlowsPage } from "./routes/overview/FlowsPage";
import { DataFirstPage } from "./routes/flows/DataFirstPage";
import { EditFlowTemplatePage, TemplatePage } from "./routes/flows/TemplatePage";
import { RecipientsPage } from "./routes/flows/RecipientsPage";
import { ReviewPage } from "./routes/flows/ReviewPage";

function CampaignPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { csrfToken, user, refreshDashboard } = useApi();
  const [campaignState, setCampaignState] = useState(null);
  const [counts, setCounts] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionState, setActionState] = useState("idle");
  const [copied, setCopied] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const sequence = ++loadSequence.current;
    try {
      const [campaignResponse, jobsResponse] = await Promise.all([getCampaign(campaignId), getCampaignJobs(campaignId, 100, 0)]);
      if (sequence !== loadSequence.current) return;
      setCampaignState(campaignResponse.campaign);
      setCounts(campaignResponse.counts);
      setJobs(jobsResponse.jobs);
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
    void load();
    if (!campaignId) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      loadSequence.current += 1;
      window.clearInterval(timer);
    };
  }, [load, campaignId]);

  if (!campaignId) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>No campaign selected.</h1><p>Choose a campaign from Campaign history.</p><Link className="button button--outline" to="/campaigns">View campaigns</Link></div></AppShell>;
  }

  const paused = campaignState?.state === "paused";
  const activeCounts = counts || { pending: 0, claimed: 0, sending: 0, accepted: 0, skipped: 0, failed: 0, unknown: 0 };
  const total = campaignState?.totalRecipients || 0;
  const processed = activeCounts.accepted + activeCounts.failed + activeCounts.skipped + activeCounts.unknown;
  const progress = campaignState ? Math.min(100, Math.round((processed / Math.max(1, total)) * 100)) : 0;
  const routeCounts = [["Total", total, Rows], ["Pending", activeCounts.pending, Clock], ["Sending", activeCounts.sending + activeCounts.claimed, PaperPlaneTilt], ["Accepted", activeCounts.accepted, Check], ["Skipped", activeCounts.skipped, MinusCircle], ["Failed", activeCounts.failed + activeCounts.unknown, WarningCircle]];
  const displayJobs = jobs || [];
  const sender = campaignState?.senderAddress || user?.mailboxAddress || "Sender not available";
  const statusKind = campaignState?.state || "unknown";
  const statusLabel = statusKind === "paused" ? "Paused safely" : statusKind === "completed" ? "Completed" : statusKind === "failed" ? "Failed" : statusKind === "queued" ? "Queued" : statusKind === "validated" ? "Validated" : statusKind === "draft" ? "Draft" : loadError ? "Unavailable" : "Loading";

  const updateAction = async (action) => {
    if (actionState !== "idle" || !campaignId || !["queued", "running", "paused"].includes(campaignState?.state)) return;
    setActionState(action);
    setLoadError("");
    try {
      const response = action === "pause"
        ? await pauseCampaign(campaignId, csrfToken)
        : await resumeCampaign(campaignId, csrfToken);
      setCampaignState(response.campaign);
      void refreshDashboard();
      await load();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The campaign could not be updated.");
      await load();
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

  return <AppShell><div className="page campaign-page"><header className="page-header campaign-header"><div><span className="section-kicker">CAMPAIGN</span><h1>The campaign can leave without you.</h1><p>Mail Flow keeps pacing and recording each row even after this page closes.</p></div><div className="header-actions"><button className="button button--outline" onClick={() => void updateAction(paused ? "resume" : "pause")} disabled={actionState !== "idle" || !["queued", "running", "paused"].includes(campaignState?.state)}>{actionState !== "idle" ? <SpinnerGap className="spin" /> : paused ? <Play weight="fill" /> : <Pause weight="fill" />}{paused ? "Resume campaign" : "Pause campaign"}</button><button className="button button--outline" onClick={() => navigate("/campaigns")}>Campaign history <X /></button></div></header>{loadError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {loadError}</div>}<div className="campaign-identity"><span className="mini-mark"><Envelope weight="fill" /></span><div><h2>{campaignState?.sourceFilename || "Campaign details"}</h2><code>{sender}</code></div><StatusChip status={statusKind}>{statusLabel}</StatusChip></div><section className="panel route-summary" aria-live="polite"><div className="route-counts">{routeCounts.map(([label, count, Icon]) => <div className={`count count--${label.toLowerCase()}`} key={label}><span><Icon weight="bold" /></span><strong>{count}</strong><small>{label}</small></div>)}</div><div className="progress-meta"><span>{paused ? "Paused, accepted rows remain protected" : `${campaignState?.pacePerMinute || 12} messages/min · About ${Math.max(0, Math.ceil((total - processed) / Math.max(1, campaignState?.pacePerMinute || 12)))} minutes remaining`}</span><strong>{progress}%</strong></div><div className="progress-track" aria-label={`${progress}% processed`}><i style={{ width: `${progress}%` }} /></div></section><div className="campaign-lower"><section className="panel jobs-panel"><div className="section-heading"><div><h2>Recipient jobs</h2><p>Each spreadsheet row has one auditable outcome.</p></div><button className="button button--outline button--small" onClick={() => void exportRows()} disabled={!campaignState}><DownloadSimple /> Export results</button></div>{displayJobs.length > 0 ? <><div className="table-wrap"><table><thead><tr><th>Recipient</th><th>Row</th><th>Status</th><th>Attempts</th><th>Last update</th><th>Note</th></tr></thead><tbody>{displayJobs.slice(0, 5).map((job) => { const status = job.status; const note = job.lastErrorMessage || (status === "accepted" ? "Request accepted" : status === "pending" ? "Queued" : "Waiting for Microsoft"); return <tr key={`${job.recipient}-${job.sourceRow}`}><td><strong>{job.recipient}</strong></td><td>{job.sourceRow}</td><td><StatusChip status={status}>{status === "accepted" ? "Accepted by Microsoft" : status[0].toUpperCase() + status.slice(1)}</StatusChip></td><td>{job.attemptCount}</td><td>{formatDate(job.updatedAt)}</td><td>{note}</td></tr>; })}</tbody></table></div><footer className="table-footer"><span>Showing 1-{Math.min(5, displayJobs.length)} of {total} rows</span></footer></> : <div className="empty-state">{campaignState ? "Recipient jobs will appear as the campaign starts." : "Loading recipient jobs..."}</div>}</section><aside className="campaign-aside"><section className="panel recovery-card"><span className="route-dot"><FlowArrow /></span><h2>If something interrupts</h2><p>Resume from the first unsent row.</p><strong>Accepted recipients are never sent twice.</strong></section><section className="panel campaign-details"><div className="section-heading"><div><span className="section-kicker">CAMPAIGN DETAILS</span><h2>Useful audit information</h2></div></div><dl><div><dt>Campaign ID</dt><dd><code>{campaignId}</code><button className="button button--text button--small" onClick={() => void copyCampaignId()}>{copied ? "Copied" : "Copy"}</button></dd></div><div><dt>Source file</dt><dd>{campaignState?.sourceFilename || "Not available"}</dd></div><div><dt>Flow</dt><dd><code>{campaignState?.flowId || "Not available"}</code></dd></div><div><dt>Template version</dt><dd><code>{campaignState?.templateVersionId || "Not available"}</code></dd></div><div><dt>Started</dt><dd>{formatDate(campaignState?.startedAt)}</dd></div><div><dt>Started by</dt><dd>{user?.displayName || "USM member"}</dd></div></dl></section></aside></div></div></AppShell>;
}

export function App() {
  const protectedRoute = (element) => <RequireProductSession>{element}</RequireProductSession>;
  return <BrowserRouter><AppDataProvider><DraftProvider><Routes><Route path="/" element={<LandingPage />} /><Route path="/dashboard" element={protectedRoute(<DashboardPage />)} /><Route path="/flows" element={protectedRoute(<FlowsPage />)} /><Route path="/flows/new/data" element={protectedRoute(<DataFirstPage />)} /><Route path="/flows/new/template" element={protectedRoute(<TemplatePage />)} /><Route path="/flows/:flowId/edit/template" element={protectedRoute(<EditFlowTemplatePage />)} /><Route path="/flows/new/recipients" element={protectedRoute(<RecipientsPage />)} /><Route path="/flows/new/review" element={protectedRoute(<ReviewPage />)} /><Route path="/campaigns" element={protectedRoute(<CampaignsPage />)} /><Route path="/campaigns/:campaignId" element={protectedRoute(<CampaignPage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></DraftProvider></AppDataProvider></BrowserRouter>;
}
