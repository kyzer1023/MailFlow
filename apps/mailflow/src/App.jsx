import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BracketsCurly, CaretLeft, CaretRight, Check, CheckCircle, Clock,
  DownloadSimple, Envelope, FileArrowUp, FileCsv, Files, FlowArrow, Gauge, House, Info,
  MicrosoftOutlookLogo, MinusCircle, PaperPlaneTilt, Pause, Play, Plus,
  Rows, SignOut, SpinnerGap, Trash, Users, WarningCircle, X,
} from "@phosphor-icons/react";
import {
  ApiRequestError,
  archiveFlow,
  createCampaign as createCampaignRequest,
  createFlow as createFlowRequest,
  createTemplateVersion as createTemplateVersionRequest,
  downloadCampaignExport,
  getCampaign,
  getCampaignJobs,
  getCampaigns,
  getFlow,
  getFlows,
  getMe,
  logout,
  pauseCampaign,
  resumeCampaign,
  sendCampaignTest,
  startCampaign,
  updateFlow as updateFlowRequest,
} from "./app/api";
import {
  buildMessagePreviews,
  createCampaignPayload,
  extractPlaceholders,
  getHeaderRowCandidates,
  mapSpreadsheetRows,
  mappingsForCurrentTable,
  mappingToRecipientConfiguration,
  parseSpreadsheet,
  recipientConfigurationToClientMapping,
  selectSpreadsheetTable,
  validateClientCampaign,
} from "./client";
import { escapeMergeValue } from "./client/template";

const DraftContext = createContext(null);
const ApiContext = createContext(null);

const fallbackConfig = { defaultPacePerMinute: 12, maxCampaignRecipients: 300 };
const emptyDraft = () => ({
  name: "",
  subject: "",
  cc: "",
  bcc: "",
  replyTo: "",
  body: "",
  fileName: "",
  fileSize: "",
  rowCount: 0,
  worksheet: "",
  headerRow: "Row 1",
  pace: fallbackConfig.defaultPacePerMinute,
  importance: "normal",
  toField: "",
  separator: "auto",
  ccMode: "fixed",
  bccMode: "fixed",
  replyToMode: "fixed",
  ccColumn: "",
  bccColumn: "",
  replyToColumn: "",
  mappings: {},
});

function requestKey() {
  try {
    return `campaign-${crypto.randomUUID()}`;
  } catch {
    return `campaign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function formatDate(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function bodyHtmlFromDraft(body) {
  const source = String(body || "");
  if (/<[a-z][^>]*>/iu.test(source)) return source;
  return source
    .split(/\r?\n/u)
    // DOMPurify serializes void elements as `<br>`. Keep generated drafts in
    // that same canonical form so a harmless blank line is not reported as
    // an unsafe-template change during Review validation.
    .map((line) => line ? `<p>${escapeMergeValue(line)}</p>` : "<br>")
    .join("");
}

function columnOptions(table) {
  return table ? table.columns.map((column) => ({ value: column.key, label: column.label || column.key })) : [];
}

function findColumn(table, words, fallback = "") {
  if (!table) return fallback;
  const match = table.columns.find((column) => {
    const haystack = `${column.key} ${column.label}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
  return match?.key || table.columns[0]?.key || fallback;
}

function displayFlow(flow) {
  return {
    id: flow.id,
    name: flow.name,
    fields: ["Saved template"],
    metaLabel: `Updated ${formatDate(flow.updatedAt)}`,
    status: flow.state === "archived" ? "draft" : "ready",
  };
}

function displayCampaign(campaign, counts, flowName = "") {
  const status = campaign.state === "completed" ? "completed" : campaign.state === "paused" ? "paused" : campaign.state === "failed" ? "failed" : campaign.state;
  return {
    id: campaign.id,
    name: flowName.trim() || campaign.sourceFilename || "Campaign",
    date: formatDate(campaign.createdAt),
    updated: formatDate(campaign.updatedAt),
    status: ["completed", "paused", "running", "queued", "failed"].includes(status) ? status : "queued",
    accepted: counts?.accepted ?? 0,
    failed: (counts?.failed ?? 0) + (counts?.unknown ?? 0),
    sent: (counts?.accepted ?? 0) + (counts?.failed ?? 0) + (counts?.unknown ?? 0),
    total: campaign.totalRecipients,
  };
}

const dashboardDataRoutes = new Set(["/dashboard", "/flows", "/campaigns"]);

function AppDataProvider({ children }) {
  const location = useLocation();
  const [session, setSession] = useState({ status: "loading", user: null, csrfToken: "", config: fallbackConfig });
  const [dashboard, setDashboard] = useState({ status: "idle", flows: null, campaigns: null, error: "" });
  const dashboardRequestRef = useRef(0);
  const activeUserIdRef = useRef(session.user?.id || null);
  activeUserIdRef.current = session.user?.id || null;

  const refreshDashboard = useCallback(async () => {
    const userId = activeUserIdRef.current;
    if (!userId) return;
    const requestId = ++dashboardRequestRef.current;
    setDashboard({ status: "loading", flows: null, campaigns: null, error: "" });
    try {
      const [flowsResponse, campaignsResponse] = await Promise.all([getFlows(), getCampaigns()]);
      const flowNames = new Map(flowsResponse.flows.map((flow) => [flow.id, flow.name]));
      // The list endpoint intentionally returns only campaign records. Fetch
      // each owner-scoped detail to obtain authoritative result counts for the
      // dashboard rather than displaying guessed or fixture totals.
      const campaigns = await Promise.all(campaignsResponse.campaigns.map(async (campaign) => {
        const detail = await getCampaign(campaign.id);
        return { campaign, counts: detail.counts, flowName: flowNames.get(campaign.flowId) || "" };
      }));
      if (requestId !== dashboardRequestRef.current || activeUserIdRef.current !== userId) return;
      setDashboard({ status: "ready", flows: flowsResponse.flows, campaigns, error: "" });
    } catch (error) {
      if (requestId !== dashboardRequestRef.current || activeUserIdRef.current !== userId) return;
      setDashboard({ status: "error", flows: null, campaigns: null, error: error instanceof Error ? error.message : "The dashboard could not be loaded." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    getMe().then((response) => {
      if (!active) return;
      setSession({ status: "authenticated", user: response.user, csrfToken: response.csrfToken, config: response.config || fallbackConfig });
    }).catch((error) => {
      if (!active) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
        return;
      }
      setSession({ status: "error", user: null, csrfToken: "", config: fallbackConfig, error: error instanceof Error ? error.message : "Mail Flow could not verify this session." });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    dashboardRequestRef.current += 1;
    setDashboard({ status: "idle", flows: null, campaigns: null, error: "" });
  }, [session.user?.id]);

  useEffect(() => {
    if (session.user && dashboardDataRoutes.has(location.pathname)) void refreshDashboard();
  }, [location.key, location.pathname, session.user, refreshDashboard]);

  const value = useMemo(() => ({
    ...session,
    isLive: session.status === "authenticated" && Boolean(session.user),
    dashboard,
    refreshDashboard,
    setSession,
  }), [session, dashboard, refreshDashboard]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

function useApi() {
  return useContext(ApiContext);
}

function RequireProductSession({ children }) {
  const { status, user, error } = useApi();
  if (status === "loading") return <div className="route-gate" role="status"><SpinnerGap className="spin" /> Loading Mail Flow...</div>;
  if (status === "error") return <div className="route-gate" role="alert"><WarningCircle weight="fill" /><h1>Mail Flow could not load this session.</h1><p>{error || "Try again in a moment."}</p><a className="button button--outline" href="/">Return to sign in</a></div>;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

function Brand({ compact = false }) {
  return <Link className={`brand ${compact ? "brand--compact" : ""}`} to="/" aria-label="MailFlow home"><img src="/assets/mailflow-logo-horizontal.png" alt="MailFlow" /></Link>;
}

function useSignOut() {
  const { csrfToken, setSession } = useApi();
  const [state, setState] = useState({ status: "idle", error: "" });
  const signOut = async () => {
    if (state.status === "working") return;
    setState({ status: "working", error: "" });
    try {
      await logout(csrfToken);
      setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
      window.location.assign("/");
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Mail Flow could not sign you out." });
    }
  };
  return { signOut, signingOut: state.status === "working", signOutError: state.error };
}

function LandingAction({ compact = false, allowSignOut = false }) {
  const { status, user } = useApi();
  const [leaving, setLeaving] = useState(false);
  const { signOut, signingOut, signOutError } = useSignOut();
  const authenticated = status === "authenticated" && Boolean(user);
  const checking = status === "loading";

  if (authenticated) {
    return <div className="landing-auth-actions"><a className={compact ? "button button--outline button--small landing-action" : "button button--coral button--hero landing-action"} href="/dashboard"><House weight="bold" />{compact ? "Dashboard" : "Go to dashboard"}</a>{allowSignOut && <button className="button button--text button--small" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <SpinnerGap className="spin" /> : <SignOut />} Sign out</button>}{signOutError && <span className="error-text" role="alert">{signOutError}</span>}</div>;
  }

  const onClick = () => { setLeaving(true); window.location.assign(`/auth/microsoft/start?returnTo=${encodeURIComponent("/dashboard")}`); };
  const label = checking ? "Checking session" : leaving ? (compact ? "Opening" : "Opening Microsoft") : compact ? "Sign in" : "Continue with Microsoft";
  return <button className={compact ? "button button--outline button--small landing-action" : "button button--coral button--hero landing-action"} type="button" onClick={onClick} disabled={checking || leaving} aria-busy={checking || leaving}>{checking || leaving ? <SpinnerGap className="spin" weight="bold" /> : <MicrosoftOutlookLogo weight="fill" />}{label}</button>;
}

function LandingPage() {
  return <div className="landing">
    <header className="marketing-header"><Brand /><LandingAction compact allowSignOut /></header>
    <main className="landing-hero">
      <section className="hero-copy"><h1>Every send,<br />accounted for.</h1><p>Personalized campaign email for student societies, sent safely through your own USM Outlook.</p><LandingAction /><div className="trust-note"><span className="trust-note__item"><CheckCircle weight="fill" /> Uses delegated Mail.Send</span><span className="trust-note__item"><span className="trust-note__separator" aria-hidden="true">•</span> Your mailbox stays yours</span></div></section>
    </main>
  </div>;
}

function Sidebar() {
  const { user } = useApi();
  const { signOut, signingOut, signOutError } = useSignOut();
  const navItems = [["/dashboard", "Overview", House], ["/flows", "Flows", FlowArrow], ["/campaigns", "Campaigns", PaperPlaneTilt]];
  const initials = user?.displayName?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "US";
  return <aside className="sidebar"><div className="sidebar-brand"><Brand /></div><p className="society-name">For student societies</p><nav aria-label="Product navigation">{navItems.map(([to, label, Icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}><Icon weight="bold" /><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom">{signOutError && <p className="sidebar-error" role="alert">{signOutError}</p>}<div className="member-card"><span className="avatar">{initials}</span><span><strong>{user?.displayName || "USM member"}</strong><small>{user?.mailboxAddress || user?.principalName || "Signed in with Microsoft"}</small></span><button type="button" title="Sign out" aria-label="Sign out" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <SpinnerGap className="spin" /> : <SignOut />}</button></div></div></aside>;
}

function SupportFooter() {
  return <footer className="support-footer">Need help? Contact us at <a href="mailto:support@example.org">support@example.org</a></footer>;
}

function AppShell({ children }) {
  return <div className="app-frame"><a className="skip-link" href="#main">Skip to content</a><Sidebar /><main className="workspace" id="main"><div className="workspace-content">{children}</div><SupportFooter /></main></div>;
}

function StatusChip({ status, children }) { return <span className={`status status--${status}`}><span aria-hidden="true" />{children || status}</span>; }

function FlowCard({ flow, loading = false, removing = false, confirmingRemove = false, onUse, onEdit, onBeginRemove, onCancelRemove, onConfirmRemove, compact = false }) {
  const busy = loading || removing;
  return <article className={`flow-card ${compact ? "flow-card--compact" : ""}`} aria-busy={busy}>
    <div className="flow-title"><span className="mini-mark"><Envelope weight="fill" /></span><h3>{flow.name}</h3>{busy && <SpinnerGap className="spin" aria-label={removing ? "Removing flow" : "Opening flow"} />}</div>
    <div className="card-divider" />
    <small>Template</small>
    <div className="field-list">{flow.fields.map((field) => <code key={field}>{field}</code>)}</div>
    <footer><span><Clock /> {flow.metaLabel}</span><StatusChip status={flow.status}>{flow.status === "ready" ? "Ready" : "Draft"}</StatusChip></footer>
    <div className="flow-card-actions">
      <button type="button" className="button button--coral button--small" onClick={onUse} disabled={busy}>Use flow <ArrowRight /></button>
      {onEdit && <button type="button" className="button button--outline button--small" onClick={onEdit} disabled={busy}>Edit</button>}
      {onBeginRemove && !confirmingRemove && <button type="button" className="button button--outline button--small" onClick={onBeginRemove} disabled={busy} aria-label={`Remove ${flow.name}`}><Trash /> Remove</button>}
      {confirmingRemove && <><span className="flow-remove-note">Campaign history stays available.</span><button type="button" className="button button--outline button--small" onClick={onCancelRemove} disabled={busy}>Keep flow</button><button type="button" className="button button--danger button--small" onClick={onConfirmRemove} disabled={busy} aria-label={`Confirm remove ${flow.name}`}>{removing ? <SpinnerGap className="spin" /> : <Trash />} {removing ? "Removing" : "Confirm remove"}</button></>}
    </div>
  </article>;
}

function useFlowActions() {
  const navigate = useNavigate();
  const { hydrateSavedFlow, resetWizardState } = useContext(DraftContext);
  const [openingFlowId, setOpeningFlowId] = useState(null);
  const [openFlowError, setOpenFlowError] = useState("");
  const openFlow = async (flow, mode = "use") => {
    if (openingFlowId) return;
    setOpenFlowError("");
    setOpeningFlowId(flow.id);
    try {
      const response = await getFlow(flow.id);
      hydrateSavedFlow(response.flow, response.templateVersion);
      navigate(mode === "edit" ? `/flows/${flow.id}/edit/template` : "/flows/new/data");
    } catch (error) {
      setOpenFlowError(error instanceof Error ? error.message : "The saved flow could not be opened.");
    } finally {
      setOpeningFlowId(null);
    }
  };
  const startNewFlow = () => { resetWizardState(); navigate("/flows/new/data"); };
  return { openingFlowId, openFlowError, openFlow, startNewFlow };
}

function CampaignTable({ campaigns }) {
  return <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Last updated</th><th>Status</th><th>Results</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.date}</small></td><td>{campaign.updated}</td><td><StatusChip status={campaign.status}>{campaign.status[0].toUpperCase() + campaign.status.slice(1)}</StatusChip></td><td><strong>{campaign.accepted}</strong> accepted<br /><small>{campaign.failed} failed</small></td><td><Link className="table-open" to={`/campaigns/${campaign.id}`} aria-label={`Open ${campaign.name}`}><CaretRight /></Link></td></tr>)}</tbody></table></div>;
}

function DashboardPage() {
  const { user, dashboard } = useApi();
  const { openingFlowId, openFlowError, openFlow, startNewFlow } = useFlowActions();
  const flows = dashboard.flows ? dashboard.flows.map(displayFlow) : [];
  const campaigns = dashboard.campaigns ? dashboard.campaigns.map((entry) => displayCampaign(entry.campaign, entry.counts, entry.flowName)) : [];
  const hasRemoteError = dashboard.status === "error";
  const campaignTarget = campaigns[0]?.id;
  return <AppShell><div className="page dashboard-page"><header className="page-header"><div><h1>Good afternoon, {user?.displayName?.split(" ")[0] || "there"}.</h1><p>Your society mail, in one clear view.</p></div><button className="button button--coral" onClick={startNewFlow}><Plus weight="bold" /> New flow</button></header>{dashboard.error && <div className="notice notice--warn" role="status"><WarningCircle weight="fill" /> {dashboard.error}</div>}{openFlowError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {openFlowError}</div>}<section className="section-heading"><h2>Reusable flows</h2><Link to="/flows">View all flows <ArrowRight /></Link></section>{dashboard.status === "loading" && !dashboard.flows ? <div className="panel empty-state">Loading your flows...</div> : hasRemoteError ? <div className="panel empty-state">Your flows could not be loaded. Try again shortly.</div> : flows.length > 0 ? <div className="flow-grid">{flows.slice(0, 2).map((flow) => <FlowCard compact flow={flow} key={flow.id} loading={openingFlowId === flow.id} onUse={() => void openFlow(flow, "use")} />)}</div> : <div className="panel empty-state"><h2>No flows yet</h2><p>Start with a spreadsheet so Mail Flow can discover the fields available for personalization.</p><button className="button button--coral" onClick={startNewFlow}><Plus weight="bold" /> Create your first flow</button></div>}<div className="dashboard-lower"><section className="panel campaign-list"><div className="section-heading"><h2>Recent campaigns</h2>{campaignTarget ? <Link to="/campaigns">View campaigns <ArrowRight /></Link> : <span className="empty-link">No campaigns yet</span>}</div>{dashboard.status === "loading" && !dashboard.campaigns ? <p className="empty-state">Loading campaign results...</p> : hasRemoteError ? <p className="empty-state">Campaign results could not be loaded. Try again shortly.</p> : campaigns.length > 0 ? <CampaignTable campaigns={campaigns.slice(0, 3)} /> : <p className="empty-state">No campaigns yet. Your first reviewed send will appear here.</p>}</section><aside className="panel route-card"><h2>Today&apos;s route</h2>{[["Draft", `${flows.length} flows ready`, Check], ["Validated", `${campaigns.filter((campaign) => campaign.failed > 0).length} need attention`, WarningCircle], ["Accepted", `${campaigns.reduce((sum, campaign) => sum + campaign.accepted, 0)} by Microsoft`, PaperPlaneTilt]].map(([label, value, Icon], index) => <div className="route-row" key={label}><span className={`route-dot route-dot--${index}`}><Icon weight="bold" /></span><span><strong>{label}</strong><small>{value}</small></span></div>)}{campaignTarget ? <Link to={`/campaigns/${campaignTarget}`}>View route details <ArrowRight /></Link> : <span className="empty-link">No campaign route yet</span>}</aside></div></div></AppShell>;
}

function FlowsPage() {
  const { dashboard, csrfToken, refreshDashboard } = useApi();
  const { openingFlowId, openFlowError, openFlow, startNewFlow } = useFlowActions();
  const [removeState, setRemoveState] = useState({ confirmingId: null, workingId: null, error: "" });
  const flows = dashboard.flows ? dashboard.flows.map(displayFlow) : [];
  const confirmRemove = (flowId) => setRemoveState({ confirmingId: flowId, workingId: null, error: "" });
  const cancelRemove = () => setRemoveState({ confirmingId: null, workingId: null, error: "" });
  const removeFlow = async (flowId) => {
    if (removeState.workingId) return;
    setRemoveState({ confirmingId: flowId, workingId: flowId, error: "" });
    try {
      await archiveFlow(flowId, csrfToken);
      setRemoveState({ confirmingId: null, workingId: null, error: "" });
      await refreshDashboard();
    } catch (error) {
      setRemoveState({ confirmingId: flowId, workingId: null, error: error instanceof Error ? error.message : "The flow could not be removed." });
    }
  };
  return <AppShell><div className="page library-page"><header className="page-header"><div><h1>Your reusable flows.</h1><p>Use an existing message with a new file, or edit its saved template.</p></div><button className="button button--coral" onClick={startNewFlow}><Plus weight="bold" /> New flow</button></header>{openFlowError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {openFlowError}</div>}{removeState.error && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {removeState.error}</div>}{dashboard.status === "loading" && !dashboard.flows ? <div className="panel empty-state">Loading your flows...</div> : dashboard.status === "error" ? <div className="panel empty-state">Your flows could not be loaded. Try again shortly.</div> : flows.length > 0 ? <div className="flow-library-grid">{flows.map((flow) => <FlowCard flow={flow} key={flow.id} loading={openingFlowId === flow.id} removing={removeState.workingId === flow.id} confirmingRemove={removeState.confirmingId === flow.id} onUse={() => void openFlow(flow, "use")} onEdit={() => void openFlow(flow, "edit")} onBeginRemove={() => confirmRemove(flow.id)} onCancelRemove={cancelRemove} onConfirmRemove={() => void removeFlow(flow.id)} />)}</div> : <div className="panel empty-state empty-state--large"><span className="empty-state-icon"><FlowArrow weight="duotone" /></span><h2>No flows yet</h2><p>Import a CSV or Excel file first. Its headers become the dynamic fields in your message.</p><button className="button button--coral" onClick={startNewFlow}><Plus weight="bold" /> Create your first flow</button></div>}</div></AppShell>;
}

function CampaignsPage() {
  const { dashboard } = useApi();
  const campaigns = dashboard.campaigns ? dashboard.campaigns.map((entry) => displayCampaign(entry.campaign, entry.counts, entry.flowName)) : [];
  return <AppShell><div className="page library-page"><header className="page-header"><div><h1>Campaign history.</h1><p>Every spreadsheet row keeps its own auditable outcome.</p></div></header><section className="panel campaign-list campaign-list--page"><div className="section-heading"><h2>All campaigns</h2><span className="empty-link">Newest first</span></div>{dashboard.status === "loading" && !dashboard.campaigns ? <p className="empty-state">Loading campaign results...</p> : dashboard.status === "error" ? <p className="empty-state">Campaign results could not be loaded. Try again shortly.</p> : campaigns.length > 0 ? <CampaignTable campaigns={campaigns} /> : <div className="empty-state"><h2>No campaigns yet</h2><p>Completed reviews and sends will appear here.</p></div>}</section></div></AppShell>;
}

const steps = [["Data", "/flows/new/data"], ["Template", "/flows/new/template"], ["Recipients", "/flows/new/recipients"], ["Review", "/flows/new/review"]];
function WizardStepper({ current }) {
  return <div className="stepper-wrap">
    <ol className="stepper" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map(([label, to], index) => {
        const state = index < current ? "complete" : index === current ? "current" : "future";
        const content = <><span className="stepper-node" aria-hidden="true">{state === "complete" ? <Check weight="bold" /> : index + 1}</span><span className="stepper-label">{label}</span></>;
        return <li className={state} key={label}>{state === "future" ? <span className="stepper-future">{content}</span> : <Link to={to} aria-current={state === "current" ? "step" : undefined}>{content}</Link>}</li>;
      })}
    </ol>
    <span className="wizard-count" aria-hidden="true">{current + 1} of {steps.length}</span>
  </div>;
}
function WizardShell({ current, title, subtitle, actions, children }) { return <AppShell><WizardStepper current={current} /><div className="page wizard-page"><header className="page-header wizard-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{actions}</div></header>{children}</div></AppShell>; }
function Field({ label, children, hint, error, errorId }) { return <label className={`field${error ? " field--error" : ""}`}><span>{label}</span>{children}{error ? <small className="field-error" id={errorId} role="alert">{error}</small> : hint && <small>{hint}</small>}</label>; }

function dynamicFieldLabel(key, options = []) {
  const match = options.find((option) => option.value === key);
  return match?.label || String(key || "").replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function DynamicValueChip({ value, options = [], compact = false }) {
  return <span className={`dynamic-value-chip${compact ? " dynamic-value-chip--compact" : ""}`}><BracketsCurly weight="bold" aria-hidden="true" />{dynamicFieldLabel(value, options)}</span>;
}

function serializeTokenEditor(root) {
  if (!root) return "";
  return [...root.childNodes].map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    if (element.dataset?.dynamicField) return `{{${element.dataset.dynamicField}}}`;
    if (element.tagName === "BR") return "\n";
    const nested = serializeTokenEditor(element);
    return element.tagName === "DIV" || element.tagName === "P" ? `${nested}\n` : nested;
  }).join("");
}

function appendTokenEditorContent(root, value, options) {
  root.replaceChildren();
  const pattern = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu;
  let cursor = 0;
  for (const match of String(value || "").matchAll(pattern)) {
    if (match.index > cursor) root.append(document.createTextNode(value.slice(cursor, match.index)));
    const token = document.createElement("span");
    token.className = "dynamic-inline-token";
    token.contentEditable = "false";
    token.dataset.dynamicField = match[1];
    token.setAttribute("aria-label", `Dynamic value: ${dynamicFieldLabel(match[1], options)}`);
    token.textContent = dynamicFieldLabel(match[1], options);
    root.append(token);
    cursor = match.index + match[0].length;
  }
  if (cursor < String(value || "").length) root.append(document.createTextNode(value.slice(cursor)));
}

const TokenMessageEditor = forwardRef(function TokenMessageEditor({ value, onChange, options, placeholder, onFocus }, forwardedRef) {
  const rootRef = useRef(null);
  const savedRangeRef = useRef(null);

  const saveRange = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root && serializeTokenEditor(root) !== String(value || "")) appendTokenEditorContent(root, String(value || ""), options);
  }, [value, options]);

  useImperativeHandle(forwardedRef, () => ({
    insertToken(key) {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const selection = window.getSelection();
      const range = savedRangeRef.current?.cloneRange() || document.createRange();
      if (!savedRangeRef.current || !root.contains(range.commonAncestorContainer)) range.selectNodeContents(root), range.collapse(false);
      const token = document.createElement("span");
      token.className = "dynamic-inline-token";
      token.contentEditable = "false";
      token.dataset.dynamicField = key;
      token.setAttribute("aria-label", `Dynamic value: ${dynamicFieldLabel(key, options)}`);
      token.textContent = dynamicFieldLabel(key, options);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // insertHTML participates in the browser's editing transaction history,
      // unlike Range.insertNode. This makes dynamic token insertion and text
      // replacement reversible with the same Ctrl+Z flow as ordinary typing.
      const insertedWithHistory = document.execCommand?.("insertHTML", false, token.outerHTML) ?? false;
      if (!insertedWithHistory) {
        range.deleteContents();
        range.insertNode(token);
        range.setStartAfter(token);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      saveRange();
      onChange(serializeTokenEditor(root));
    },
  }), [onChange, options, saveRange]);

  const insertPlainText = (text) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const insertedWithHistory = document.execCommand?.("insertText", false, text) ?? false;
    if (!insertedWithHistory) {
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    saveRange();
    onChange(serializeTokenEditor(rootRef.current));
  };

  return <div
    ref={rootRef}
    className="message-editor token-message-editor"
    contentEditable
    suppressContentEditableWarning
    role="textbox"
    aria-multiline="true"
    aria-label="Message body"
    data-placeholder={placeholder}
    onFocus={(event) => { saveRange(); onFocus?.(event); }}
    onKeyUp={saveRange}
    onMouseUp={saveRange}
    onInput={() => { saveRange(); onChange(serializeTokenEditor(rootRef.current)); }}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); insertPlainText("\n"); }
    }}
    onPaste={(event) => { event.preventDefault(); insertPlainText(event.clipboardData.getData("text/plain")); }}
  />;
});

function splitFixedAddresses(value) {
  return String(value || "").split(/[;,\n]+/u).map((part) => part.trim()).filter(Boolean);
}

function AddressRuleField({ fieldKey, label, value, mode, column, options, onValue, onMode, onColumn, hint }) {
  const [pending, setPending] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const fieldRef = useRef(null);
  const addresses = splitFixedAddresses(value);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => { if (!fieldRef.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const commitPending = (raw = pending) => {
    const additions = splitFixedAddresses(raw);
    if (additions.length > 0) {
      const seen = new Set(addresses.map((address) => address.toLowerCase()));
      onValue([...addresses, ...additions.filter((address) => !seen.has(address.toLowerCase()))].join("; "));
    }
    setPending("");
  };
  const removeAddress = (index) => onValue(addresses.filter((_, itemIndex) => itemIndex !== index).join("; "));
  const removeDynamic = () => { onMode("fixed"); onColumn(""); };

  return <div className="recipient-rule" ref={fieldRef}>
    <label htmlFor={`${fieldKey}-fixed-input`}>{label}</label>
    <div className={`address-chip-input${mode === "column" ? " address-chip-input--dynamic" : ""}`}>
      <div className="address-chip-values">
        {mode === "column" && column ? <span className="selected-dynamic-value"><DynamicValueChip value={column} options={options} /><button type="button" onClick={removeDynamic} aria-label={`Remove dynamic ${label} value`}><X /></button></span> : addresses.map((address, index) => <span className="address-chip" key={`${address}-${index}`}><span aria-hidden="true">{address.charAt(0).toUpperCase()}</span><span className="address-chip-label">{address}</span><button type="button" onClick={() => removeAddress(index)} aria-label={`Remove ${address}`}><X /></button></span>)}
        {mode === "fixed" && <input id={`${fieldKey}-fixed-input`} value={pending} onChange={(event) => setPending(event.target.value)} onBlur={() => commitPending()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "," || event.key === ";") { event.preventDefault(); commitPending(); } else if (event.key === "Backspace" && !pending && addresses.length > 0) removeAddress(addresses.length - 1); }} placeholder={addresses.length ? "Add another" : "Add email addresses"} autoComplete="off" />}
      </div>
      <button type="button" className="dynamic-menu-trigger" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="listbox" aria-label={`Choose a dynamic value for ${label}`} title="Choose a spreadsheet value"><BracketsCurly weight="bold" /></button>
    </div>
    {menuOpen && <div className="dynamic-value-menu" role="listbox" aria-label={`Dynamic values for ${label}`} onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}><div><strong>Dynamic values</strong><small>Choose a spreadsheet column containing email addresses.</small></div>{options.length > 0 ? options.map((option) => <button type="button" role="option" aria-selected={mode === "column" && column === option.value} key={option.value} onClick={() => { onMode("column"); onColumn(option.value); setPending(""); setMenuOpen(false); }}><DynamicValueChip value={option.value} options={options} compact />{mode === "column" && column === option.value && <Check weight="bold" />}</button>) : <p>No spreadsheet fields are available.</p>}</div>}
    {hint && <small className="recipient-rule-hint">{hint}</small>}
  </div>;
}

function DraftProvider({ children }) {
  const { user, config } = useApi();
  const [draft, setDraft] = useState(emptyDraft);
  const [workbook, setWorkbook] = useState(null);
  const [table, setTable] = useState(null);
  const [flowId, setFlowId] = useState(null);
  const [templateVersionId, setTemplateVersionId] = useState(null);
  const [campaignResponse, setCampaignResponse] = useState(null);
  const [skipInvalidRows, setSkipInvalidRows] = useState(false);
  const [campaignRequestKey, setCampaignRequestKey] = useState(requestKey);
  const bodyHtml = useMemo(() => bodyHtmlFromDraft(draft.body), [draft.body]);
  const mapping = useMemo(() => {
    const source = (key) => {
      const mode = draft[`${key}Mode`];
      const column = draft[`${key}Column`];
      if (mode === "column" && column) return { kind: "column", field: column };
      return { kind: "fixed", value: draft[key] || "" };
    };
    return {
      toField: draft.toField || "",
      cc: source("cc"),
      bcc: source("bcc"),
      replyTo: source("replyTo"),
      importance: draft.importance || "normal",
      separator: draft.separator || "auto",
      placeholders: draft.mappings,
    };
  }, [draft]);
  const mappedRows = useMemo(() => table ? mapSpreadsheetRows(table, mapping).rows : [], [table, mapping]);
  const mappingIssues = useMemo(() => table ? mapSpreadsheetRows(table, mapping).issues : [], [table, mapping]);
  const validation = useMemo(() => table ? validateClientCampaign({
    senderAddress: user?.mailboxAddress || user?.principalName || "",
    subjectTemplate: draft.subject,
    bodyHtml,
    rows: mappedRows,
    mappedFields: draft.mappings,
    separator: draft.separator || "auto",
    maxRecipients: config.maxCampaignRecipients,
    pacePerMinute: draft.pace,
    mappingIssues,
  }) : null, [table, user, draft, bodyHtml, mappedRows, mappingIssues, config]);
  const campaignValidation = useMemo(() => {
    if (!validation || !skipInvalidRows || validation.ok) return validation;
    const rowOnly = validation.issues.length > 0 && validation.issues.every((issue) => issue.row !== undefined);
    return rowOnly ? { ...validation, ok: true, issues: [] } : validation;
  }, [validation, skipInvalidRows]);
  const updateDraft = useCallback((key, value) => setDraft((current) => ({ ...current, [key]: value })), []);
  const resetWizardState = useCallback(() => {
    setDraft(emptyDraft());
    setWorkbook(null);
    setTable(null);
    setFlowId(null);
    setTemplateVersionId(null);
    setCampaignResponse(null);
    setSkipInvalidRows(false);
    setCampaignRequestKey(requestKey());
  }, []);
  const hydrateSavedFlow = useCallback((flow, templateVersion) => {
    const savedMapping = templateVersion
      ? recipientConfigurationToClientMapping(templateVersion.recipientConfiguration)
      : { toField: "", cc: null, bcc: null, replyTo: null, separator: "auto", placeholders: {} };
    const sourceFields = (value) => value?.kind === "column"
      ? { mode: "column", fixed: "", column: value.field }
      : { mode: "fixed", fixed: value?.value || "", column: "" };
    const cc = sourceFields(savedMapping.cc);
    const bcc = sourceFields(savedMapping.bcc);
    const replyTo = sourceFields(savedMapping.replyTo);
    setDraft({
      ...emptyDraft(),
      name: flow.name,
      subject: templateVersion?.subjectTemplate || "",
      body: templateVersion?.bodyHtml || "",
      cc: cc.fixed,
      bcc: bcc.fixed,
      replyTo: replyTo.fixed,
      importance: savedMapping.importance || "normal",
      fileName: "",
      fileSize: "",
      rowCount: 0,
      worksheet: "",
      headerRow: "Row 1",
      toField: savedMapping.toField,
      separator: savedMapping.separator,
      ccMode: cc.mode,
      bccMode: bcc.mode,
      replyToMode: replyTo.mode,
      ccColumn: cc.column,
      bccColumn: bcc.column,
      replyToColumn: replyTo.column,
      mappings: { ...savedMapping.placeholders },
    });
    setWorkbook(null);
    setTable(null);
    setFlowId(flow.id);
    setTemplateVersionId(templateVersion?.id || null);
    setCampaignResponse(null);
    setSkipInvalidRows(false);
    setCampaignRequestKey(requestKey());
  }, []);
  const value = useMemo(() => ({ draft, setDraft, updateDraft, workbook, setWorkbook, table, setTable, flowId, setFlowId, templateVersionId, setTemplateVersionId, campaignResponse, setCampaignResponse, campaignRequestKey, bodyHtml, mapping, mappedRows, validation, campaignValidation, skipInvalidRows, setSkipInvalidRows, config, hydrateSavedFlow, resetWizardState }), [draft, updateDraft, workbook, table, flowId, templateVersionId, campaignResponse, campaignRequestKey, bodyHtml, mapping, mappedRows, validation, campaignValidation, skipInvalidRows, config, hydrateSavedFlow, resetWizardState]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

function TemplatePage() {
  const { draft, updateDraft, flowId, mapping, setFlowId, setTemplateVersionId, table } = useContext(DraftContext);
  const { csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const { flowId: editingFlowId } = useParams();
  const bodyRef = useRef(null);
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [nameError, setNameError] = useState("");
  const dynamicOptions = columnOptions(table);
  const dynamicFields = dynamicOptions.map((option) => option.value);
  const editingExisting = Boolean(editingFlowId) && !table;
  const canSave = Boolean(draft.name.trim() && draft.subject.trim() && draft.body.trim() && mapping.toField);

  const editDraft = (key, value) => {
    updateDraft(key, value);
    setSaveState("idle");
    setSaveError("");
    if (key === "name") setNameError("");
  };

  const insertDynamicField = (key) => {
    bodyRef.current?.insertToken(key);
  };

  const saveFlowDraft = async (destination = "") => {
    if (!canSave) {
      setSaveError("Add a flow name, subject, message body, and primary recipient before saving.");
      return;
    }
    setSaveState("saving"); setSaveError(""); setNameError("");
    let flowNameSaved = false;
    try {
      const bodyHtml = bodyHtmlFromDraft(draft.body);
      const recipientConfiguration = mappingToRecipientConfiguration(mapping);
      const templatePayload = { subjectTemplate: draft.subject, bodyHtml, placeholderManifest: extractPlaceholders(draft.subject, bodyHtml), recipientConfiguration };
      if (!flowId) {
        const response = await createFlowRequest({ name: draft.name, ...templatePayload }, csrfToken);
        setFlowId(response.flow.id);
        setTemplateVersionId(response.templateVersion?.id || null);
      } else {
        await updateFlowRequest(flowId, { name: draft.name }, csrfToken);
        flowNameSaved = true;
        const response = await createTemplateVersionRequest(flowId, templatePayload, csrfToken);
        setTemplateVersionId(response.version.id);
      }
      await refreshDashboard();
      setSaveState("saved");
      if (destination) navigate(destination);
    } catch (error) {
      setSaveState("error");
      if (error instanceof ApiRequestError && error.code === "flow_name_conflict") {
        setNameError(error.message);
      } else {
        const message = error instanceof Error ? error.message : "The flow could not be saved.";
        setSaveError(flowNameSaved ? `The flow name was saved, but the message changes were not saved. ${message}` : message);
      }
    }
  };
  const nextDestination = editingExisting ? "/flows" : "/flows/new/recipients";
  if (!table && !editingExisting) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>Import your data first.</h1><p>The template editor builds its dynamic fields from your spreadsheet headers.</p><Link className="button button--coral" to="/flows/new/data">Start with data</Link></div></AppShell>;
  }
  return <WizardShell current={1} title="Compose the reusable message." subtitle="Your spreadsheet headers are ready to use as dynamic fields." actions={<><button className="button button--outline" onClick={() => navigate(editingExisting ? "/flows" : "/flows/new/data")}><ArrowLeft /> Back</button><button className="button button--text" onClick={() => void saveFlowDraft()} disabled={saveState === "saving" || !canSave}><Files /> {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save draft"}</button><button className="button button--coral" onClick={() => void saveFlowDraft(nextDestination)} disabled={saveState === "saving" || !canSave}>{editingExisting ? "Save changes" : "Continue to recipients"} <ArrowRight /></button></>}>
    <div className="template-layout">
      <section className="panel editor-card">
        {saveError && <div className="notice notice--warn template-save-error" role="alert"><WarningCircle weight="fill" /><span><strong>Changes were not fully saved.</strong>{saveError}</span></div>}
        <Field label="Flow name" error={nameError} errorId="flow-name-error"><input value={draft.name} onChange={(event) => editDraft("name", event.target.value)} placeholder="For example, Event invitation" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "flow-name-error" : undefined} /></Field>
        <Field label="Subject"><input value={draft.subject} onChange={(event) => editDraft("subject", event.target.value)} placeholder="Add a clear email subject" /></Field>
        <Field label="Message body" hint="Select text to replace it with a dynamic value, or place the cursor where it should appear."><TokenMessageEditor ref={bodyRef} value={draft.body} onChange={(value) => editDraft("body", value)} options={dynamicOptions} placeholder="Write the reusable message here." /></Field>
      </section>
      <aside className="panel dynamic-panel"><h2>Dynamic values</h2><p>Detected from your spreadsheet headers</p>{dynamicFields.length > 0 ? <div className="token-stack">{dynamicFields.map((key) => <button type="button" key={key} onClick={() => insertDynamicField(key)} aria-label={`Insert ${dynamicFieldLabel(key, dynamicOptions)}`}><DynamicValueChip value={key} options={dynamicOptions} /></button>)}</div> : <div className="empty-state empty-state--compact">No fields are available. Return to Data and import a spreadsheet.</div>}<div className="notice"><Info weight="fill" /><span>Click a value to insert it in the message. Highlighted text is replaced.</span></div><div className="envelope-preview"><img src="/assets/mailflow-logo-horizontal.png" alt="" /><strong>Safe preview</strong><small>HTML is cleaned before preview. Unsafe elements are removed before sending.</small></div></aside>
    </div>
  </WizardShell>;
}

function EditFlowTemplatePage() {
  const { flowId: routeFlowId } = useParams();
  const { flowId, hydrateSavedFlow } = useContext(DraftContext);
  const [loadState, setLoadState] = useState({ status: "idle", error: "" });

  useEffect(() => {
    if (!routeFlowId || flowId === routeFlowId) return undefined;
    let active = true;
    setLoadState({ status: "loading", error: "" });
    void getFlow(routeFlowId).then((response) => {
      if (!active) return;
      hydrateSavedFlow(response.flow, response.templateVersion);
      setLoadState({ status: "ready", error: "" });
    }).catch((error) => {
      if (!active) return;
      setLoadState({ status: "error", error: error instanceof Error ? error.message : "The saved flow could not be opened." });
    });
    return () => { active = false; };
  }, [routeFlowId, flowId, hydrateSavedFlow]);

  if (routeFlowId && flowId !== routeFlowId) {
    return <AppShell><div className="route-gate" role={loadState.status === "error" ? "alert" : "status"}>{loadState.status === "error" ? <WarningCircle weight="fill" /> : <SpinnerGap className="spin" />}<h1>{loadState.status === "error" ? "This flow could not be opened." : "Opening your flow..."}</h1>{loadState.error && <p>{loadState.error}</p>}{loadState.status === "error" && <Link className="button button--outline" to="/flows">Return to flows</Link>}</div></AppShell>;
  }
  return <TemplatePage />;
}

function DataFirstPage() {
  const { draft, setDraft, workbook, setWorkbook, table, setTable, validation, mappedRows } = useContext(DraftContext);
  const navigate = useNavigate();
  const [uploadState, setUploadState] = useState("ready");
  const [uploadError, setUploadError] = useState("");
  const options = columnOptions(table);
  const worksheet = workbook?.worksheets.find((item) => item.name === draft.worksheet) || workbook?.worksheets[0];
  const headerCandidates = worksheet ? getHeaderRowCandidates(worksheet) : [];
  const templateFields = extractPlaceholders(draft.subject, bodyHtmlFromDraft(draft.body));
  const mappingFields = templateFields.length > 0 ? templateFields : Object.keys(draft.mappings || {});

  const rebuildTable = (sourceWorkbook, worksheetName, headerRow) => {
    try {
      const nextTable = selectSpreadsheetTable(sourceWorkbook, { worksheet: worksheetName, headerRow });
      const nextMappings = mappingsForCurrentTable(nextTable);
      const nextTo = draft.toField && nextTable.columns.some((column) => column.key === draft.toField) ? draft.toField : findColumn(nextTable, ["email", "mail"]);
      setTable(nextTable);
      setDraft((current) => ({ ...current, worksheet: nextTable.worksheetName, headerRow: `Row ${nextTable.headerRow}`, rowCount: nextTable.rows.length, toField: nextTo, mappings: nextMappings }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "We could not select that worksheet.");
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState("loading");
    setUploadError("");
    try {
      const parsed = await parseSpreadsheet(await file.arrayBuffer(), { fileName: file.name });
      setWorkbook(parsed);
      const first = parsed.worksheets.find((item) => item.visibility === "visible") || parsed.worksheets[0];
      rebuildTable(parsed, first.name, "auto");
      setDraft((value) => ({ ...value, fileName: file.name, fileSize: `${Math.max(1, Math.round(file.size / 1024))} KB` }));
      setUploadState("ready");
    } catch (error) {
      setUploadState("error");
      setUploadError(error instanceof Error ? error.message : "We could not read that file.");
    }
  };

  const previewColumns = table?.columns.slice(0, 6) || [];
  const previewRows = table?.rows.slice(0, 8) || [];
  const readyCount = validation?.validRecipientCount ?? 0;
  const attentionCount = validation?.invalidRows.length ?? 0;
  const firstIssue = validation?.issues.find((issue) => issue.row !== undefined) || null;
  const canContinue = Boolean(table && draft.toField);
  const subtitle = table ? `We found ${draft.rowCount} rows in ${draft.fileName}.` : "Start with a CSV or Excel file so we can discover its dynamic fields.";

  return (
    <WizardShell
      current={0}
      title="Bring in the recipient data."
      subtitle={subtitle}
      actions={(
        <>
          <button className="button button--outline" onClick={() => navigate("/flows")}><ArrowLeft /> Back to flows</button>
          <button className="button button--coral" onClick={() => navigate("/flows/new/template")} disabled={!canContinue}>Continue to template <ArrowRight /></button>
        </>
      )}
    >
      <div className={`data-layout ${!table ? "data-layout--empty" : ""}`}>
        <section className="panel upload-panel">
          <div className="upload-card">
            <span className="upload-icon"><FileArrowUp weight="duotone" /></span>
            <div>
              <h2>{draft.fileName || "Upload CSV or Excel"}</h2>
              <p>{draft.fileName ? `${draft.fileSize} · ${draft.rowCount} rows` : "Choose a .csv or .xlsx file. It stays in this browser until you confirm the campaign."}</p>
              {uploadError && <p className="error-text" role="alert"><WarningCircle /> {uploadError}</p>}
            </div>
            <label className="button button--outline file-button">
              {uploadState === "loading" ? <SpinnerGap className="spin" /> : <FileCsv />}
              {draft.fileName ? "Replace file" : "Choose file"}
              <input type="file" accept=".csv,.xlsx" onChange={onFile} />
            </label>
          </div>
          {table ? (
            <>
              <div className="sheet-controls">
                <Field label="Worksheet">
                  <select value={draft.worksheet} onChange={(event) => rebuildTable(workbook, event.target.value, Number.parseInt(draft.headerRow.replace(/\D/gu, ""), 10) || "auto")}>
                    {workbook.worksheets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="Header row">
                  <select value={draft.headerRow} onChange={(event) => rebuildTable(workbook, draft.worksheet, Number.parseInt(event.target.value.replace(/\D/gu, ""), 10) || "auto")}>
                    {headerCandidates.map((row) => <option key={row}>Row {row}</option>)}
                  </select>
                </Field>
                <div className="validation-badge">
                  <CheckCircle weight="fill" />
                  <span><strong>{readyCount} ready</strong><small>{attentionCount} rows need attention</small></span>
                </div>
              </div>
              <div className="preview-table table-wrap">
                <table>
                  <thead><tr><th>Row</th>{previewColumns.map((column) => <th key={column.key}>{column.label || column.key}</th>)}</tr></thead>
                  <tbody>
                    {previewRows.map((row) => {
                      const invalid = validation?.invalidRows.includes(row.sourceRow);
                      return (
                        <tr key={row.sourceRow} className={invalid ? "row-error" : ""}>
                          <td>{row.sourceRow}</td>
                          {previewColumns.map((column) => <td key={column.key}>{row.values[column.key]}{invalid && column.key === draft.toField && <WarningCircle />}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {firstIssue && (
                <div className="issue-strip">
                  <WarningCircle weight="fill" />
                  <span><strong>Row {firstIssue.row}. Recipient data needs attention</strong><small>{firstIssue.message}</small></span>
                  <span>{attentionCount} flagged {attentionCount === 1 ? "row" : "rows"}</span>
                </div>
              )}
            </>
          ) : (
            <div className="upload-empty">
              <h3>Your file defines the flow.</h3>
              <p>Once imported, the header row becomes the set of dynamic fields available in the template. No sample recipients are preloaded.</p>
              <span><CheckCircle weight="fill" /> Parsed locally in your browser</span>
            </div>
          )}
        </section>
        <aside className="panel mapping-panel">
          <div className="section-heading">
            <div>
              <h2>{table ? "Map your spreadsheet" : "Why data comes first"}</h2>
              <p>{table ? "Choose the email column, then match each message value to a column." : "The message editor should only offer values that truly exist in your file."}</p>
            </div>
            <Rows />
          </div>
          {table ? (
            <>
              <Field label="Recipient email column">
                <select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}>
                  <option value="">Choose a column</option>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              {templateFields.length > 0 && mappingFields.map((key) => (
                <Field key={key} label={`${dynamicFieldLabel(key, options)} in message`}>
                  <select value={draft.mappings[key] || ""} onChange={(event) => setDraft((value) => ({ ...value, mappings: { ...value.mappings, [key]: event.target.value } }))}>
                    <option value="">Choose a column</option>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
              ))}
              <div className="detected-field-group">
                <span className="detected-field-group__label">Columns found in your file</span>
                <div className="detected-field-list">
                  {options.map((option) => <span className="detected-field-name" key={option.value}>{option.label}</span>)}
                </div>
              </div>
              <div className="validation-metrics">
                <span><CheckCircle weight="fill" /><strong>{readyCount}</strong><small>ready</small></span>
                <span><WarningCircle weight="fill" /><strong>{attentionCount}</strong><small>attention</small></span>
                <span><Users weight="fill" /><strong>{validation?.duplicateRecipients.length ?? 0}</strong><small>duplicate</small></span>
              </div>
              <div className="locked-note"><CheckCircle weight="fill" /> Nothing is sent until Review.</div>
            </>
          ) : (
            <ol className="data-first-list">
              <li>Import the file.</li>
              <li>Confirm the header row.</li>
              <li>Use those headers in the message.</li>
            </ol>
          )}
        </aside>
      </div>
    </WizardShell>
  );
}

function RecipientsPage() {
  const { draft, setDraft, updateDraft, table, validation } = useContext(DraftContext);
  const { user } = useApi();
  const navigate = useNavigate();
  const options = columnOptions(table);
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const updateRule = (fieldKey, property, value) => setDraft((current) => ({ ...current, [property === "mode" ? `${fieldKey}Mode` : property === "column" ? `${fieldKey}Column` : fieldKey]: value }));
  const ruleProps = (fieldKey, label, hint) => ({
    fieldKey,
    label,
    hint,
    value: draft[fieldKey],
    mode: draft[`${fieldKey}Mode`],
    column: draft[`${fieldKey}Column`],
    options,
    onValue: (value) => updateRule(fieldKey, "value", value),
    onMode: (value) => updateRule(fieldKey, "mode", value),
    onColumn: (value) => updateRule(fieldKey, "column", value),
  });

  return <WizardShell current={2} title="Set the sending rules." subtitle="Recipients stay scoped to this file and this flow. Your USM Outlook remains the sender." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/template")}><ArrowLeft /> Back</button><button className="button button--coral" onClick={() => navigate("/flows/new/review")} disabled={!table || !draft.toField}>Continue to review <ArrowRight /></button></>}>
    <div className="recipients-layout">
      <section className="panel recipient-card">
        <div className="locked-sender"><span><Envelope weight="fill" /></span><div><small>Sender, locked by Microsoft</small><strong>{sender}</strong><p>Every spreadsheet row produces one separate message from this mailbox.</p></div><CheckCircle weight="fill" /></div>
        <Field label="Primary recipient column"><select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}><option value="">Choose a column</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <div className="two-fields recipient-address-grid"><AddressRuleField {...ruleProps("cc", "CC")} /><AddressRuleField {...ruleProps("bcc", "BCC")} /></div>
        <div className="two-fields recipient-bottom-grid">
          <AddressRuleField {...ruleProps("replyTo", "Reply-to", "The address members will use when replying. Leave empty to use your sender mailbox.")} />
          <Field label="Importance" hint="Sets the priority flag shown by supported email clients."><select value={draft.importance} onChange={(event) => updateDraft("importance", event.target.value)}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></Field>
        </div>
        {validation && !validation.ok && <div className="notice notice--warn"><WarningCircle weight="fill" /><span>Flagged recipient rows can be skipped during Review. Template-level issues must be resolved before sending.</span></div>}
      </section>
      <aside className="panel pace-card"><Gauge weight="duotone" /><h2>Paced for safety</h2><p>Mail Flow sends one personalized message at a time and records the result for every row.</p><Field label={`${draft.pace} messages per minute`}><input type="range" min="6" max="20" value={draft.pace} onChange={(event) => updateDraft("pace", Number(event.target.value))} /></Field><div className="pace-facts"><span><strong>{validation?.totalRows ?? draft.rowCount}</strong>Total rows</span><span><strong>About {Math.ceil((validation?.validRecipientCount ?? draft.rowCount) / draft.pace)} min</strong>Estimated time</span></div><div className="notice"><Info weight="fill" /><span>Accepted rows are never sent twice. An uncertain Microsoft response is marked Unknown for manual review.</span></div></aside>
    </div>
  </WizardShell>;
}

function useEnsureCampaign() {
  const api = useApi(); const draftState = useContext(DraftContext);
  return useCallback(async () => {
    if (!api.isLive) return null;
    if (draftState.campaignResponse) return draftState.campaignResponse;
    if (!draftState.table || !draftState.campaignValidation) throw new Error("Import and validate a recipient file before creating the campaign.");
    if (!draftState.campaignValidation.ok) throw new Error("Review and fix the flagged rows before starting the campaign.");
    let currentFlowId = draftState.flowId;
    if (!currentFlowId) {
      const flowResponse = await createFlowRequest({ name: draftState.draft.name }, api.csrfToken);
      currentFlowId = flowResponse.flow.id;
      draftState.setFlowId(currentFlowId);
    }
    // Save the final mapping and body as a new immutable version at campaign
    // creation time. A draft saved before the workbook was selected may have
    // used a placeholder column, so reusing it could make the server reject a
    // valid campaign as changed.
    let currentVersionId = null;
    const recipientConfiguration = mappingToRecipientConfiguration(draftState.mapping);
    if (!currentVersionId) {
      const versionResponse = await createTemplateVersionRequest(currentFlowId, {
        subjectTemplate: draftState.draft.subject,
        bodyHtml: draftState.campaignValidation.sanitizedBodyHtml,
        placeholderManifest: draftState.campaignValidation.placeholders,
        recipientConfiguration,
      }, api.csrfToken);
      currentVersionId = versionResponse.version.id;
      draftState.setTemplateVersionId(currentVersionId);
    }
    const payload = createCampaignPayload({
      idempotencyKey: draftState.campaignRequestKey,
      flowId: currentFlowId,
      templateVersionId: currentVersionId,
      sourceFilename: draftState.draft.fileName,
      subjectTemplate: draftState.draft.subject,
      bodyHtml: draftState.bodyHtml,
      mapping: draftState.mapping,
      pacePerMinute: draftState.draft.pace,
      rows: draftState.mappedRows,
      validation: draftState.campaignValidation,
    });
    const response = await createCampaignRequest(payload, api.csrfToken);
    draftState.setCampaignResponse(response);
    void api.refreshDashboard();
    return response;
  }, [api, draftState]);
}

function validationIssueAction(issue) {
  if (["missing_mapping", "missing_column", "missing_to_mapping"].includes(issue.code)) {
    return { label: "Fix data mapping", to: "/flows/new/data" };
  }
  if (["missing_subject", "missing_body", "unsafe_html"].includes(issue.code)) {
    return { label: "Fix template", to: "/flows/new/template" };
  }
  return { label: "Fix recipients", to: "/flows/new/recipients" };
}

function uniqueValidationIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.field || ""}:${issue.row || ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ReviewPage() {
  const state = useContext(DraftContext);
  const { user, csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const [sampleIndex, setSampleIndex] = useState(0);
  const [ack, setAck] = useState(false);
  const [testState, setTestState] = useState("idle");
  const [actionError, setActionError] = useState("");
  const ensureCampaign = useEnsureCampaign();
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const displayName = user?.displayName || "USM member";
  const rows = state.validation?.validRows || [];
  const previews = useMemo(() => buildMessagePreviews({ senderAddress: sender, subjectTemplate: state.draft.subject, bodyHtml: state.bodyHtml, rows, fieldMappings: state.draft.mappings }), [sender, state.draft.subject, state.draft.mappings, state.bodyHtml, rows]);
  const safeIndex = Math.min(sampleIndex, Math.max(0, previews.length - 1));
  const message = previews[safeIndex] || null;
  const canSkip = Boolean(state.validation && !state.validation.ok && state.validation.issues.length > 0 && state.validation.issues.every((issue) => issue.row !== undefined));
  const blockingIssues = uniqueValidationIssues(state.campaignValidation?.issues || []);
  const ready = Boolean(state.table && message && ack && state.campaignValidation?.ok);
  const actionBlocker = blockingIssues.length > 0 ? `Resolve ${blockingIssues.length} validation ${blockingIssues.length === 1 ? "issue" : "issues"} first.` : !ack ? "Check the final acknowledgement first." : "";

  const sendTest = async () => {
    if (!message || !state.campaignValidation?.ok) return;
    setTestState("sending");
    setActionError("");
    try {
      const response = await ensureCampaign();
      await sendCampaignTest(response.campaign.id, {
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        importance: state.draft.importance,
      }, csrfToken);
      setTestState("accepted");
    } catch (error) {
      setTestState("error");
      setActionError(error instanceof Error ? error.message : "The test message could not be accepted by Microsoft.");
    }
  };

  const start = async () => {
    if (!ready) return;
    setActionError("");
    try {
      const response = await ensureCampaign();
      await startCampaign(response.campaign.id, csrfToken);
      void refreshDashboard();
      navigate(`/campaigns/${response.campaign.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The campaign could not be started.");
    }
  };

  if (!state.table) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>Import a recipient file first.</h1><p>Review only becomes available after Data, Template, and Recipients are complete.</p><Link className="button button--coral" to="/flows/new/data">Start with data</Link></div></AppShell>;
  }

  const previewDocument = message?.bodyHtml || "";
  return <WizardShell current={3} title="Review every detail before it leaves." subtitle="Check representative rows, send a test to yourself, then confirm the paced campaign." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/recipients")}><ArrowLeft /> Back</button><button className="button button--outline" onClick={() => void sendTest()} disabled={testState === "sending" || !message || !state.campaignValidation?.ok} title={blockingIssues.length ? actionBlocker : undefined} aria-describedby={blockingIssues.length ? "review-blockers" : undefined}>{testState === "sending" ? <SpinnerGap className="spin" /> : <Envelope />} Send test to me</button><button className="button button--coral" disabled={!ready} onClick={() => void start()} title={actionBlocker || undefined} aria-describedby={actionBlocker ? "review-blockers" : undefined}>Confirm &amp; start <PaperPlaneTilt weight="fill" /></button></>}><div className="review-layout"><aside className="panel sample-card"><span className="section-kicker">SAMPLE ROWS</span><h2>Who are you checking?</h2>{previews.slice(0, 3).map((preview, index) => <button key={`${preview.position}-${preview.sourceRow}`} className={index === safeIndex ? "selected" : ""} onClick={() => setSampleIndex(index)}><span>{["First", "Middle", "Last"][index]}</span><strong>{preview.to}</strong><small>Row {preview.sourceRow}</small></button>)}{previews.length === 0 && <p className="empty-state">No valid recipient rows are available yet.</p>}<footer><button aria-label="Previous sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + previews.length - 1) % previews.length)}><CaretLeft /></button><span>{previews.length ? `${safeIndex + 1} of ${Math.min(3, previews.length)}` : "0 of 0"}</span><button aria-label="Next sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + 1) % previews.length)}><CaretRight /></button></footer></aside><section className="panel mailbox-preview">{message ? <><div className="mail-toolbar"><span>Personalized preview</span></div><div className="mail-meta"><span className="avatar">{displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{displayName}</strong><small>{sender}</small></span><StatusChip status="ready">Preview</StatusChip></div><dl><div><dt>To</dt><dd>{message.to}</dd></div>{message.cc.length > 0 && <div><dt>CC</dt><dd>{message.cc.join(", ")}</dd></div>}{message.bcc.length > 0 && <div><dt>BCC</dt><dd>{message.bcc.join(", ")}</dd></div>}{message.replyTo.length > 0 && <div><dt>Reply-to</dt><dd>{message.replyTo.join(", ")}</dd></div>}<div><dt>Subject</dt><dd>{message.subject}</dd></div></dl><iframe title={`Email preview for ${message.to}`} sandbox="allow-same-origin" srcDoc={previewDocument} /></> : <div className="empty-state">Resolve the recipient issues to generate a preview.</div>}</section><aside className="panel review-summary"><span className="section-kicker">FINAL CHECK</span><h2>Review summary</h2>{[[Envelope, "Sender", sender], [Users, "Recipients", `${state.validation?.validRecipientCount ?? 0} valid, ${state.validation?.skippedRecipientCount ?? 0} skipped`], [Envelope, "CC", state.draft.cc || "None"], [Gauge, "Pacing", `${state.draft.pace} messages per minute`], [Clock, "Estimated duration", `About ${Math.ceil((state.validation?.validRecipientCount ?? 0) / state.draft.pace)} minutes`], [CheckCircle, "Validation", state.campaignValidation?.ok ? "Ready to queue" : `${blockingIssues.length} issues to review`]].map(([Icon, label, value]) => <div className="fact" key={label}><span><Icon weight="fill" /></span><div><small>{label}</small><strong>{value}</strong></div></div>)}{blockingIssues.length > 0 && <section className="review-blockers" id="review-blockers" role="alert"><div><WarningCircle weight="fill" /><h3>Fix these before sending</h3></div><ul>{blockingIssues.map((issue) => { const action = validationIssueAction(issue); return <li key={`${issue.code}:${issue.field || ""}:${issue.row || ""}:${issue.message}`}><span>{issue.message}</span><Link to={action.to}>{action.label}</Link></li>; })}</ul></section>}{canSkip && <label className="ack"><input type="checkbox" checked={state.skipInvalidRows} onChange={(event) => state.setSkipInvalidRows(event.target.checked)} /><span>Skip the flagged rows and continue with valid recipients only.</span></label>}<label className="ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I have checked the sender, recipients, and personalized message.</span></label><div className="accepted-note"><Info weight="fill" /> Microsoft acceptance means the request was received. It is not a delivery receipt.</div><p className="test-status" aria-live="polite">{testState === "accepted" && <><CheckCircle weight="fill" /> Test accepted by Microsoft</>}{testState === "sending" && "Sending one message to your mailbox..."}{testState === "error" && <><WarningCircle weight="fill" /> {actionError}</>}{actionError && testState !== "error" && <><WarningCircle weight="fill" /> {actionError}</>}</p></aside></div></WizardShell>;
}

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
