import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, CaretLeft, CaretRight, Check, CheckCircle, Clock,
  DownloadSimple, Envelope, FileArrowUp, FileCsv, Files, FlowArrow, Gauge, House, Info,
  ListChecks, MicrosoftOutlookLogo, MinusCircle, PaperPlaneTilt, Pause, Play, Plus, Question,
  Rows, SignOut, SlidersHorizontal, SpinnerGap, Users, WarningCircle, X,
} from "@phosphor-icons/react";
import {
  campaignFixtures,
  columnFixtures,
  dataRows,
  flowFixtures,
  initialDraft,
  jobFixtures,
  memberFixture,
  placeholderFixtures,
} from "./app/fixtures";
import {
  ApiRequestError,
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
} from "./app/api";
import {
  buildMessagePreviews,
  createCampaignPayload,
  downloadResultsCsv,
  extractPlaceholders,
  getHeaderRowCandidates,
  mapSpreadsheetRows,
  mappingToRecipientConfiguration,
  parseSpreadsheet,
  recipientConfigurationToClientMapping,
  selectSpreadsheetTable,
  validateClientCampaign,
} from "./client";
import { escapeMergeValue, sanitizeTemplateHtml } from "./client/template";

const DraftContext = createContext(null);
const ApiContext = createContext(null);

const fallbackConfig = { defaultPacePerMinute: 12, maxCampaignRecipients: 300 };
const localVisualMode = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname);

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

function fallbackMappedRows(draft) {
  return dataRows.map((row) => ({
    sourceRow: row.row,
    to: row.email,
    cc: draft.cc,
    bcc: draft.bcc,
    replyTo: draft.replyTo,
    mergeData: {
      judge_name: row.name,
      judge_email: row.email,
      project_title: row.project,
      event_date: row.eventDate,
      reply_deadline: row.deadline,
      "Judge Name": row.name,
      Email: row.email,
      "Project Title": row.project,
      "Event Date": row.eventDate,
      "Reply Deadline": row.deadline,
    },
  }));
}

function bodyHtmlFromDraft(body) {
  const source = String(body || "");
  if (/<[a-z][^>]*>/iu.test(source)) return source;
  return source
    .split(/\r?\n/u)
    .map((line) => line ? `<p>${escapeMergeValue(line)}</p>` : "<br />")
    .join("");
}

function columnOptions(table) {
  if (table) return table.columns.map((column) => ({ value: column.key, label: column.label || column.key }));
  return columnFixtures.map((column) => ({ value: column, label: column }));
}

function findColumn(table, words, fallback = "") {
  if (!table) return fallback;
  const match = table.columns.find((column) => {
    const haystack = `${column.key} ${column.label}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
  return match?.key || table.columns[0]?.key || fallback;
}

function mappingsForTable(table, current) {
  const result = { ...current };
  for (const placeholder of placeholderFixtures) {
    const words = placeholder.split("_").filter((word) => word.length > 2);
    result[placeholder] = findColumn(table, words, result[placeholder] || "");
  }
  return result;
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

function displayCampaign(campaign, counts) {
  const status = campaign.state === "completed" ? "completed" : campaign.state === "paused" ? "paused" : campaign.state === "failed" ? "failed" : campaign.state;
  return {
    id: campaign.id,
    name: `Campaign ${campaign.id.slice(0, 12)}`,
    date: formatDate(campaign.createdAt),
    updated: formatDate(campaign.updatedAt),
    status: ["completed", "paused", "running", "queued", "failed"].includes(status) ? status : "queued",
    accepted: counts?.accepted ?? 0,
    failed: (counts?.failed ?? 0) + (counts?.unknown ?? 0),
    sent: (counts?.accepted ?? 0) + (counts?.failed ?? 0) + (counts?.unknown ?? 0),
    total: campaign.totalRecipients,
  };
}

function AppDataProvider({ children }) {
  const [session, setSession] = useState({ status: "loading", user: null, csrfToken: "", config: fallbackConfig });
  const [dashboard, setDashboard] = useState({ status: "idle", flows: null, campaigns: null, error: "" });

  const refreshDashboard = useCallback(async () => {
    if (!session.user) return;
    setDashboard((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const [flowsResponse, campaignsResponse] = await Promise.all([getFlows(), getCampaigns()]);
      // The list endpoint intentionally returns only campaign records. Fetch
      // each owner-scoped detail to obtain authoritative result counts for the
      // dashboard rather than displaying guessed or fixture totals.
      const campaigns = await Promise.all(campaignsResponse.campaigns.map(async (campaign) => {
        const detail = await getCampaign(campaign.id);
        return { campaign, counts: detail.counts };
      }));
      setDashboard({ status: "ready", flows: flowsResponse.flows, campaigns, error: "" });
    } catch (error) {
      setDashboard((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : "The dashboard could not be loaded." }));
    }
  }, [session.user]);

  useEffect(() => {
    let active = true;
    getMe().then((response) => {
      if (!active) return;
      setSession({ status: "authenticated", user: response.user, csrfToken: response.csrfToken, config: response.config || fallbackConfig });
    }).catch((error) => {
      if (!active) return;
      if (localVisualMode || (error instanceof ApiRequestError && error.status === 401)) {
        setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
        return;
      }
      setSession({ status: "error", user: null, csrfToken: "", config: fallbackConfig, error: error instanceof Error ? error.message : "Mail Flow could not verify this session." });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session.user) void refreshDashboard();
  }, [session.user, refreshDashboard]);

  const value = useMemo(() => ({
    ...session,
    isLive: session.status === "authenticated" && Boolean(session.user),
    isFixtureMode: localVisualMode && session.status !== "authenticated",
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
  const { status, user, isFixtureMode, error } = useApi();
  if (status === "loading") return <div className="route-gate" role="status"><SpinnerGap className="spin" /> Loading Mail Flow...</div>;
  if (status === "error") return <div className="route-gate" role="alert"><WarningCircle weight="fill" /><h1>Mail Flow could not load this session.</h1><p>{error || "Try again in a moment."}</p><a className="button button--outline" href="/">Return to sign in</a></div>;
  if (!user && !isFixtureMode) return <Navigate to="/" replace />;
  return children;
}

function Brand({ compact = false }) {
  return <Link className={`brand ${compact ? "brand--compact" : ""}`} to="/" aria-label="MailFlow home"><img src="/assets/mailflow-logo-horizontal.png" alt="MailFlow" /></Link>;
}

function MicrosoftButton({ compact = false }) {
  const [leaving, setLeaving] = useState(false);
  const onClick = () => { setLeaving(true); window.location.assign(`/auth/microsoft/start?returnTo=${encodeURIComponent("/dashboard")}`); };
  return <button className={compact ? "button button--outline button--small" : "button button--coral button--hero"} onClick={onClick} disabled={leaving}>{leaving ? <SpinnerGap className="spin" weight="bold" /> : <MicrosoftOutlookLogo weight="fill" />}{compact ? (leaving ? "Opening" : "Sign in") : (leaving ? "Opening Microsoft" : "Continue with Microsoft")}</button>;
}

function LandingPage() {
  return <div className="landing">
    <header className="marketing-header"><Brand /><nav aria-label="Marketing navigation"><a href="#how">How it works</a><a href="#safety">Safety</a><a href="#societies">For societies</a></nav><MicrosoftButton compact /></header>
    <main className="landing-hero" id="how">
      <section className="hero-copy"><div className="section-kicker">SECTION 1 OF 6</div><div className="segment-rule" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><h1>Every send,<br />accounted for.</h1><p>Personalized email through your USM Outlook, checked, paced, and easy to resume.</p><MicrosoftButton /><div className="trust-note" id="safety"><CheckCircle weight="fill" /> Uses delegated Mail.Send <span>•</span> Your mailbox stays yours</div></section>
      <section className="hero-art" aria-label="MailFlow sends email in three checked steps" id="societies"><img src="/assets/landing-route-stationery.png" alt="Import, review, send, and Microsoft acceptance workflow" /></section>
    </main>
  </div>;
}

function Sidebar() {
  const { user, isLive, csrfToken, setSession, dashboard } = useApi();
  const [loggingOut, setLoggingOut] = useState(false);
  const displayUser = user || memberFixture;
  const firstCampaignId = isLive ? dashboard.campaigns?.[0]?.campaign?.id : "CMP-2026-08-31-DEMO";
  const navItems = [["/dashboard", "Overview", House], ["/flows/new/template", "Flows", FlowArrow], ...(firstCampaignId ? [[`/campaigns/${firstCampaignId}`, "Campaigns", PaperPlaneTilt]] : []), ["/flows/new/data", "Recipients", Users]];
  const handleLogout = async () => {
    if (!isLive || loggingOut) return;
    setLoggingOut(true);
    try { await logout(csrfToken); } catch { /* the session is still cleared locally */ }
    setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
    window.location.assign("/");
  };
  return <aside className="sidebar"><Brand /><p className="society-name">{memberFixture.society}</p><nav aria-label="Product navigation">{navItems.map(([to, label, Icon]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}><Icon weight="bold" /><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom"><a href="mailto:support@example.org"><Question weight="bold" /><span>Help</span></a><div className="member-card"><span className="avatar">{displayUser.displayName?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AT"}</span><span><strong>{displayUser.displayName || memberFixture.name}</strong><small>{displayUser.mailboxAddress || displayUser.email || memberFixture.email}</small></span><button title="Sign out" aria-label="Sign out" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? <SpinnerGap className="spin" /> : <SignOut />}</button></div></div></aside>;
}

function AppShell({ children, review = false }) {
  if (review) return <div className="app-frame app-frame--review"><a className="skip-link" href="#main">Skip to content</a><main className="workspace" id="main">{children}</main></div>;
  return <div className="app-frame"><a className="skip-link" href="#main">Skip to content</a><Sidebar /><main className="workspace" id="main">{children}</main></div>;
}

function StatusChip({ status, children }) { return <span className={`status status--${status}`}><span aria-hidden="true" />{children || status}</span>; }

function FlowCard({ flow, loading = false, onOpen }) {
  return <button type="button" className="flow-card flow-card-button" onClick={onOpen} disabled={loading} aria-busy={loading}><div className="flow-title"><span className="mini-mark"><Envelope weight="fill" /></span><h3>{flow.name}</h3><span className="flow-card-menu" aria-hidden="true">{loading ? <SpinnerGap className="spin" /> : <ArrowRight />}</span></div><div className="card-divider" /><small>Template fields</small><div className="field-list">{flow.fields.map((field) => <code key={field}>{field}</code>)}</div><footer><span><Clock /> {flow.metaLabel}</span><StatusChip status={flow.status}>{flow.status === "ready" ? "Ready" : "Draft"}</StatusChip></footer></button>;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { user, isLive, dashboard } = useApi();
  const { hydrateSavedFlow, resetWizardState } = useContext(DraftContext);
  const [openingFlowId, setOpeningFlowId] = useState(null);
  const [openFlowError, setOpenFlowError] = useState("");
  const displayUser = user || memberFixture;
  const flows = isLive ? (dashboard.flows ? dashboard.flows.map(displayFlow) : []) : flowFixtures;
  const campaigns = isLive ? (dashboard.campaigns ? dashboard.campaigns.map((entry) => displayCampaign(entry.campaign, entry.counts)) : []) : campaignFixtures;
  const hasRemoteError = isLive && dashboard.status === "error";
  const campaignTarget = campaigns[0]?.id;
  const openFlow = async (flow) => {
    if (openingFlowId) return;
    setOpenFlowError("");
    setOpeningFlowId(flow.id);
    try {
      if (isLive) {
        const response = await getFlow(flow.id);
        hydrateSavedFlow(response.flow, response.templateVersion);
      } else {
        resetWizardState();
      }
      navigate("/flows/new/template");
    } catch (error) {
      setOpenFlowError(error instanceof Error ? error.message : "The saved flow could not be opened.");
    } finally {
      setOpeningFlowId(null);
    }
  };
  return <AppShell><div className="page dashboard-page"><header className="page-header"><div><h1>Good afternoon, {displayUser.displayName?.split(" ")[0] || memberFixture.firstName}.</h1><p>Your society mail, in one clear view.</p></div><button className="button button--coral" onClick={() => { resetWizardState(); navigate("/flows/new/template"); }}><Plus weight="bold" /> New flow</button></header>{dashboard.error && isLive && <div className="notice notice--warn" role="status"><WarningCircle weight="fill" /> {dashboard.error}</div>}{openFlowError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {openFlowError}</div>}<section className="section-heading"><h2>Reusable flows</h2><span className="empty-link">Choose a flow to reuse it</span></section>{isLive && dashboard.status === "loading" && !dashboard.flows ? <div className="panel empty-state">Loading your flows...</div> : hasRemoteError ? <div className="panel empty-state">Your flows could not be loaded. Try again shortly.</div> : flows.length > 0 ? <div className="flow-grid">{flows.map((flow) => <FlowCard flow={flow} key={flow.id} loading={openingFlowId === flow.id} onOpen={() => void openFlow(flow)} />)}</div> : <div className="panel empty-state">No flows yet. Start with a reusable message.</div>}<div className="dashboard-lower"><section className="panel campaign-list"><div className="section-heading"><h2>Recent campaigns</h2>{campaignTarget ? <Link to={`/campaigns/${campaignTarget}`}>View latest campaign <ArrowRight /></Link> : <span className="empty-link">No campaigns yet</span>}</div>{isLive && dashboard.status === "loading" && !dashboard.campaigns ? <p className="empty-state">Loading campaign results...</p> : hasRemoteError ? <p className="empty-state">Campaign results could not be loaded. Try again shortly.</p> : campaigns.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Last updated</th><th>Status</th><th>Results</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id} onClick={() => navigate(`/campaigns/${campaign.id}`)}><td><strong>{campaign.name}</strong><small>{campaign.date}</small></td><td>{campaign.updated}</td><td><StatusChip status={campaign.status}>{campaign.status[0].toUpperCase() + campaign.status.slice(1)}</StatusChip></td><td><strong>{campaign.accepted}</strong> accepted<br /><small>{campaign.failed} failed</small></td><td><CaretRight /></td></tr>)}</tbody></table></div> : <p className="empty-state">No campaigns yet. Your first review will appear here.</p>}</section><aside className="panel route-card"><h2>Today&apos;s route</h2>{[["Draft", `${flows.length} flows ready`, Check], ["Validated", `${campaigns.filter((campaign) => campaign.failed > 0).length} need attention`, WarningCircle], ["Accepted", `${campaigns.reduce((sum, campaign) => sum + campaign.accepted, 0)} by Microsoft`, PaperPlaneTilt]].map(([label, value, Icon], index) => <div className="route-row" key={label}><span className={`route-dot route-dot--${index}`}><Icon weight="bold" /></span><span><strong>{label}</strong><small>{value}</small></span></div>)}{campaignTarget ? <Link to={`/campaigns/${campaignTarget}`}>View route details <ArrowRight /></Link> : <span className="empty-link">No campaign route yet</span>}</aside></div><p className="help-line">Need help? Contact us at <a href="mailto:support@example.org">support@example.org</a></p></div></AppShell>;
}

const steps = [["Details", "/flows/new/template"], ["Template", "/flows/new/template"], ["Data", "/flows/new/data"], ["Recipients", "/flows/new/recipients"], ["Review", "/flows/new/review"]];
function WizardStepper({ current }) { const section = current === 2 ? 4 : current + 1; return <div className="stepper-wrap"><ol className="stepper" aria-label={`Step ${current + 1} of 5`}>{steps.map(([label, to], index) => <li className={index < current ? "complete" : index === current ? "current" : ""} key={`${label}-${index}`}><Link to={to}><span>{index < current ? <Check weight="bold" /> : index + 1}</span>{label}</Link></li>)}</ol><span className="wizard-count">{section} of 6</span></div>; }
function WizardShell({ current, title, subtitle, actions, children, review = false }) { return <AppShell review={review}>{review && <div className="review-brand"><Brand /></div>}<WizardStepper current={current} /><div className="page wizard-page"><header className="page-header wizard-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{actions}</div></header>{children}</div></AppShell>; }
function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }

function DraftProvider({ children }) {
  const { user, config } = useApi();
  const [draft, setDraft] = useState(() => ({ ...initialDraft, toField: "Email", separator: "auto", ccMode: "fixed", bccMode: "fixed", replyToMode: "fixed", ccColumn: "", bccColumn: "", replyToColumn: "", mappings: { ...initialDraft.mappings } }));
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
      separator: draft.separator || "auto",
      placeholders: draft.mappings,
    };
  }, [draft]);
  const mappedRows = useMemo(() => table ? mapSpreadsheetRows(table, mapping).rows : fallbackMappedRows(draft), [table, mapping, draft]);
  const mappingIssues = useMemo(() => table ? mapSpreadsheetRows(table, mapping).issues : [], [table, mapping]);
  const validation = useMemo(() => table ? validateClientCampaign({
    senderAddress: user?.mailboxAddress || memberFixture.email,
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
    setDraft({ ...initialDraft, toField: "Email", separator: "auto", ccMode: "fixed", bccMode: "fixed", replyToMode: "fixed", ccColumn: "", bccColumn: "", replyToColumn: "", mappings: { ...initialDraft.mappings } });
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
      ...initialDraft,
      name: flow.name,
      subject: templateVersion?.subjectTemplate || initialDraft.subject,
      body: templateVersion?.bodyHtml || initialDraft.body,
      cc: cc.fixed,
      bcc: bcc.fixed,
      replyTo: replyTo.fixed,
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
  const { draft, updateDraft, flowId, mapping, setFlowId, setTemplateVersionId } = useContext(DraftContext); const { isLive, csrfToken } = useApi(); const navigate = useNavigate(); const [saveState, setSaveState] = useState("idle"); const [saveError, setSaveError] = useState("");
  const saveFlowDraft = async (goNext) => {
    if (!isLive) { if (goNext) navigate("/flows/new/data"); return; }
    setSaveState("saving"); setSaveError("");
    try {
      const bodyHtml = bodyHtmlFromDraft(draft.body);
      const recipientConfiguration = mappingToRecipientConfiguration({ ...mapping, toField: mapping.toField || "email" });
      const templatePayload = { subjectTemplate: draft.subject, bodyHtml, placeholderManifest: extractPlaceholders(draft.subject, bodyHtml), recipientConfiguration };
      if (!flowId) {
        const response = await createFlowRequest({ name: draft.name, societyName: "USM Debate Society", ...templatePayload }, csrfToken);
        setFlowId(response.flow.id);
        setTemplateVersionId(response.templateVersion?.id || null);
      } else {
        const response = await createTemplateVersionRequest(flowId, templatePayload, csrfToken);
        setTemplateVersionId(response.version.id);
      }
      setSaveState("saved"); if (goNext) navigate("/flows/new/data");
    } catch (error) { setSaveState("error"); setSaveError(error instanceof Error ? error.message : "The flow could not be saved."); }
  };
  return <WizardShell current={1} title="Compose the reusable message." subtitle="Write it once. Each spreadsheet row makes it personal." actions={<><button className="button button--text" onClick={() => void saveFlowDraft(false)} disabled={saveState === "saving"}><Files /> {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : "Save draft"}</button><button className="button button--coral" onClick={() => void saveFlowDraft(true)} disabled={saveState === "saving"}>Continue to data <ArrowRight /></button></>}><div className="template-layout">{saveError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {saveError}</div>}<section className="panel editor-card"><Field label="Flow name"><input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></Field><div className="two-fields subject-metadata-row"><Field label="Subject"><input value={draft.subject} onChange={(event) => updateDraft("subject", event.target.value)} /></Field><Field label="CC"><input value={draft.cc} onChange={(event) => updateDraft("cc", event.target.value)} placeholder="Optional fixed address" /></Field></div><div className="editor-toolbar"><span className="mode active">Visual</span><span className="mode">HTML</span><select aria-label="Font family" defaultValue="system"><option value="system">System Sans</option></select><select aria-label="Font size" defaultValue="14"><option>14</option><option>16</option><option>18</option></select><button aria-label="Bold"><strong>B</strong></button><button aria-label="Italic"><em>I</em></button></div><Field label="Message body"><textarea className="message-editor" value={draft.body} onChange={(event) => updateDraft("body", event.target.value)} /></Field><details><summary>BCC (optional)</summary><input value={draft.bcc} onChange={(event) => updateDraft("bcc", event.target.value)} placeholder="audit@example.org" /></details><details><summary>Reply-to (optional)</summary><input value={draft.replyTo} onChange={(event) => updateDraft("replyTo", event.target.value)} placeholder="events@example.org" /></details></section><aside className="panel dynamic-panel"><h2>Dynamic fields</h2><p>From this flow</p><div className="token-stack">{placeholderFixtures.map((key) => <button key={key} onClick={() => updateDraft("body", `${draft.body} {{${key}}}`)}>{`{{${key}}}`}</button>)}</div><div className="notice"><Info weight="fill" /><span>More fields appear after you import a spreadsheet.</span></div><div className="envelope-preview"><img src="/assets/mailflow-logo-horizontal.png" alt="" /><strong>Envelope preview</strong><small>HTML is cleaned before preview. Unsafe elements are removed to keep recipients safe.</small></div></aside></div></WizardShell>;
}

function DataPage() {
  const { draft, setDraft, workbook, setWorkbook, table, setTable, mapping, validation, mappedRows } = useContext(DraftContext); const navigate = useNavigate(); const [uploadState, setUploadState] = useState("ready"); const [uploadError, setUploadError] = useState("");
  const options = columnOptions(table);
  const worksheet = workbook?.worksheets.find((item) => item.name === draft.worksheet) || workbook?.worksheets[0];
  const headerCandidates = worksheet ? getHeaderRowCandidates(worksheet) : [1, 2];
  const rebuildTable = (sourceWorkbook, worksheetName, headerRow) => {
    try {
      const nextTable = selectSpreadsheetTable(sourceWorkbook, { worksheet: worksheetName, headerRow });
      const nextMappings = mappingsForTable(nextTable, draft.mappings);
      const nextTo = draft.toField && nextTable.columns.some((column) => column.key === draft.toField) ? draft.toField : findColumn(nextTable, ["email", "mail"]);
      setTable(nextTable);
      setDraft((current) => ({ ...current, worksheet: nextTable.worksheetName, headerRow: `Row ${nextTable.headerRow}`, rowCount: nextTable.rows.length, toField: nextTo, mappings: nextMappings }));
    } catch (error) { setUploadError(error instanceof Error ? error.message : "We could not select that worksheet."); }
  };
  const onFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; setUploadState("loading"); setUploadError(""); try { const parsed = await parseSpreadsheet(await file.arrayBuffer(), { fileName: file.name }); setWorkbook(parsed); const first = parsed.worksheets.find((item) => item.visibility === "visible") || parsed.worksheets[0]; rebuildTable(parsed, first.name, "auto"); setDraft((value) => ({ ...value, fileName: file.name, fileSize: `${Math.max(1, Math.round(file.size / 1024))} KB` })); setUploadState("ready"); } catch (error) { setUploadState("error"); setUploadError(error instanceof Error ? error.message : "We could not read that file."); } };
  const previewColumns = table ? table.columns.slice(0, 6) : null;
  const previewRows = table ? table.rows.slice(0, 8) : null;
  const readyCount = validation?.validRecipientCount ?? 145;
  const attentionCount = validation ? validation.invalidRows.length : 3;
  const firstIssue = validation?.issues.find((issue) => issue.row !== undefined) || null;
  const issueRow = firstIssue?.row || 87;
  const issueMessage = firstIssue?.message || "The address invalid@ is missing a domain.";
  return <WizardShell current={2} title="Connect the rows to the message." subtitle={`We found ${draft.rowCount} rows in ${draft.fileName}.`} actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/template")}><ArrowLeft /> Back</button><button className="button button--coral" onClick={() => navigate("/flows/new/recipients")}>Continue to recipients <ArrowRight /></button></>}><div className="data-layout"><section className="panel upload-panel"><div className="upload-card"><span className="upload-icon"><FileArrowUp weight="duotone" /></span><div><h2>{draft.fileName || "Upload CSV or Excel"}</h2><p>{draft.fileName ? `${draft.fileSize} · ${draft.rowCount} rows` : "Choose a .csv or .xlsx file. The file stays in this browser until review."}</p>{uploadError && <p className="error-text"><WarningCircle /> {uploadError}</p>}</div><label className="button button--outline file-button">{uploadState === "loading" ? <SpinnerGap className="spin" /> : <FileCsv />} {draft.fileName ? "Replace file" : "Choose file"}<input type="file" accept=".csv,.xlsx" onChange={onFile} /></label></div>{workbook && <div className="sheet-controls"><Field label="Worksheet"><select value={draft.worksheet} onChange={(event) => rebuildTable(workbook, event.target.value, Number.parseInt(draft.headerRow.replace(/\D/gu, ""), 10) || "auto")}>{workbook.worksheets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></Field><Field label="Header row"><select value={draft.headerRow} onChange={(event) => rebuildTable(workbook, draft.worksheet, Number.parseInt(event.target.value.replace(/\D/gu, ""), 10) || "auto")}>{headerCandidates.map((row) => <option key={row}>Row {row}</option>)}</select></Field><div className="validation-badge"><CheckCircle weight="fill" /><span><strong>{readyCount} ready</strong><small>{attentionCount} rows need attention</small></span></div></div>}{!workbook && <div className="sheet-controls"><Field label="Worksheet"><select value={draft.worksheet} onChange={(event) => setDraft((value) => ({ ...value, worksheet: event.target.value }))}><option>Judges</option><option>Sheet 1</option></select></Field><Field label="Header row"><select value={draft.headerRow} onChange={(event) => setDraft((value) => ({ ...value, headerRow: event.target.value }))}><option>Row 1</option><option>Row 2</option></select></Field><div className="validation-badge"><CheckCircle weight="fill" /><span><strong>{readyCount} ready</strong><small>{attentionCount} rows need attention</small></span></div></div>}<div className="preview-table table-wrap"><table><thead><tr><th>Row</th>{previewColumns ? previewColumns.map((column) => <th key={column.key}>{column.label || column.key}</th>) : <><th>Judge Name</th><th>Email</th><th>Project Title</th><th>Event Date</th><th>Reply Deadline</th></>}</tr></thead><tbody>{previewRows ? previewRows.map((row) => { const mapped = mappedRows.find((item) => item.sourceRow === row.sourceRow); const invalid = validation?.invalidRows.includes(row.sourceRow); return <tr key={row.sourceRow} className={invalid ? "row-error" : ""}><td>{row.sourceRow}</td>{previewColumns.map((column) => <td key={column.key}>{row.values[column.key]}{invalid && column.key === draft.toField && <WarningCircle />}</td>)}</tr>; }) : dataRows.map((row) => <tr key={row.row} className={row.email === "invalid@" ? "row-error" : ""}><td>{row.row}</td><td>{row.name}</td><td>{row.email}{row.email === "invalid@" && <WarningCircle />}</td><td>{row.project}</td><td>{row.eventDate}</td><td>{row.deadline}</td></tr>)}</tbody></table></div><div className="issue-strip"><WarningCircle weight="fill" /><span><strong>Row {issueRow}. {firstIssue?.code === "duplicate_recipient" ? "Duplicate recipient" : "Invalid email address"}</strong><small>{issueMessage}</small></span><button onClick={() => navigate("/flows/new/recipients")}>Review {attentionCount} flagged rows <ArrowRight /></button></div></section><aside className="panel mapping-panel"><div className="section-heading"><div><h2>Column mapping</h2><p>Choose the spreadsheet column for each field.</p></div><SlidersHorizontal /></div><Field label="Primary recipient"><select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>{(validation?.placeholders || placeholderFixtures).map((key) => <Field key={key} label={`{{${key}}}`}><select value={draft.mappings[key] || ""} onChange={(event) => setDraft((value) => ({ ...value, mappings: { ...value.mappings, [key]: event.target.value } }))}><option value="">Choose a column</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>)}<div className="validation-metrics"><span><CheckCircle weight="fill" /><strong>{readyCount}</strong><small>ready</small></span><span><WarningCircle weight="fill" /><strong>{attentionCount}</strong><small>attention</small></span><span><Users weight="fill" /><strong>{validation?.duplicateRecipients.length ?? 1}</strong><small>duplicate</small></span></div><button className="button button--text mapping-review" onClick={() => navigate("/flows/new/recipients")}>Review {attentionCount} flagged rows <ArrowRight /></button><div className="notice notice--warn"><WarningCircle weight="fill" /><span><strong>{attentionCount} rows need attention</strong>Invalid or missing recipient details will be skipped.</span></div><div className="locked-note"><CheckCircle weight="fill" /> Nothing will be sent until Review.</div></aside></div></WizardShell>;
}

function RecipientsPage() {
  const { draft, setDraft, updateDraft, table, validation } = useContext(DraftContext); const { user } = useApi(); const navigate = useNavigate(); const options = columnOptions(table); const sender = user?.mailboxAddress || memberFixture.email;
  const sourceOptions = (mode, columnKey, fieldKey) => <select aria-label={`${fieldKey} source`} value={mode === "column" ? draft[columnKey] : "fixed"} onChange={(event) => setDraft((value) => ({ ...value, [`${fieldKey}Mode`]: event.target.value === "fixed" ? "fixed" : "column", ...(event.target.value === "fixed" ? {} : { [columnKey]: event.target.value }) }))}><option value="fixed">Fixed address</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  return <WizardShell current={3} title="Set the sending rules." subtitle="Your USM Outlook stays the sender. MailFlow checks every recipient before it leaves." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/data")}><ArrowLeft /> Back</button><button className="button button--coral" onClick={() => navigate("/flows/new/review")}>Continue to review <ArrowRight /></button></>}><div className="recipients-layout"><section className="panel recipient-card"><div className="locked-sender"><span><Envelope weight="fill" /></span><div><small>Sender, locked by Microsoft</small><strong>{sender}</strong><p>Every message is sent with delegated Mail.Send from the signed-in mailbox.</p></div><CheckCircle weight="fill" /></div><Field label="Primary recipient column"><select value={draft.toField} onChange={(event) => setDraft((value) => ({ ...value, toField: event.target.value }))}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><div className="two-fields"><Field label="CC"><input value={draft.cc} disabled={draft.ccMode === "column"} onChange={(event) => updateDraft("cc", event.target.value)} placeholder="Optional fixed address" />{sourceOptions(draft.ccMode, "ccColumn", "cc")}</Field><Field label="BCC"><input value={draft.bcc} disabled={draft.bccMode === "column"} onChange={(event) => updateDraft("bcc", event.target.value)} placeholder="Optional" />{sourceOptions(draft.bccMode, "bccColumn", "bcc")}</Field></div><Field label="Reply-to"><input value={draft.replyTo} disabled={draft.replyToMode === "column"} onChange={(event) => updateDraft("replyTo", event.target.value)} placeholder="Use sender mailbox" />{sourceOptions(draft.replyToMode, "replyToColumn", "replyTo")}</Field>{validation && !validation.ok && <div className="notice notice--warn"><WarningCircle weight="fill" /><span>Resolve the highlighted row issues or choose which invalid rows to skip during review.</span></div>}</section><aside className="panel pace-card"><Gauge weight="duotone" /><h2>Paced for safety</h2><p>MailFlow sends one personalized message at a time and records the result for every row.</p><Field label={`${draft.pace} messages per minute`}><input type="range" min="6" max="20" value={draft.pace} onChange={(event) => updateDraft("pace", Number(event.target.value))} /></Field><div className="pace-facts"><span><strong>{validation?.totalRows ?? draft.rowCount}</strong>Total rows</span><span><strong>About {Math.ceil((validation?.validRecipientCount ?? draft.rowCount) / draft.pace)} min</strong>Estimated time</span></div><div className="notice"><Info weight="fill" /><span>Accepted rows are never sent twice. An uncertain Microsoft response is marked Unknown for manual review.</span></div></aside></div></WizardShell>;
}

function localNormalizedRows(draft) {
  return fallbackMappedRows(draft).filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(row.to)).map((row) => ({ sourceRow: row.sourceRow, to: row.to, cc: row.cc ? [row.cc] : [], bcc: row.bcc ? [row.bcc] : [], replyTo: row.replyTo ? [row.replyTo] : [], mergeData: row.mergeData }));
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
      const flowResponse = await createFlowRequest({ name: draftState.draft.name, societyName: "USM Debate Society" }, api.csrfToken);
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
    return response;
  }, [api, draftState]);
}

function ReviewPage() {
  const state = useContext(DraftContext); const { isLive, user, csrfToken } = useApi(); const navigate = useNavigate(); const [sampleIndex, setSampleIndex] = useState(0); const [ack, setAck] = useState(false); const [testState, setTestState] = useState("idle"); const [actionError, setActionError] = useState(""); const ensureCampaign = useEnsureCampaign();
  const rows = state.table ? (state.validation?.validRows || []) : localNormalizedRows(state.draft); const previews = useMemo(() => buildMessagePreviews({ senderAddress: user?.mailboxAddress || memberFixture.email, subjectTemplate: state.draft.subject, bodyHtml: state.bodyHtml, rows, fieldMappings: state.draft.mappings }), [state.draft, state.bodyHtml, rows, user]); const samples = previews.length ? previews : [{ position: "first", sourceRow: 1, senderAddress: memberFixture.email, to: "alex@example.com", cc: [], bcc: [], replyTo: [], subject: state.draft.subject, bodyHtml: sanitizeTemplateHtml("<p>Preview is waiting for a valid recipient row.</p>"), missingPlaceholders: [] }]; const safeIndex = Math.min(sampleIndex, samples.length - 1); const message = samples[safeIndex]; const displayName = user?.displayName || memberFixture.name; const sender = user?.mailboxAddress || memberFixture.email; const canSkip = Boolean(state.validation && !state.validation.ok && state.validation.issues.length > 0 && state.validation.issues.every((issue) => issue.row !== undefined)); const ready = ack && (!state.validation || state.validation.ok || state.campaignValidation?.ok);
  const sendTest = async () => { setTestState("sending"); setActionError(""); try { const response = isLive ? await ensureCampaign() : null; if (isLive && response) await sendCampaignTest(response.campaign.id, { subject: message.subject, bodyHtml: message.bodyHtml }, csrfToken); await new Promise((resolve) => setTimeout(resolve, isLive ? 0 : 700)); setTestState("accepted"); } catch (error) { setTestState("error"); setActionError(error instanceof Error ? error.message : "The test message could not be accepted by Microsoft."); } };
  const start = async () => { if (!ready) return; setActionError(""); try { const response = isLive ? await ensureCampaign() : null; if (isLive && response) { await startCampaign(response.campaign.id, csrfToken); navigate(`/campaigns/${response.campaign.id}`); } else navigate("/campaigns/CMP-2026-08-31-DEMO"); } catch (error) { setActionError(error instanceof Error ? error.message : "The campaign could not be started."); } };
  const previewDocument = `<!doctype html><html><body style="font:15px/1.5 Arial,sans-serif;color:#17211f;padding:24px;background:#fffdf8"><header style="text-align:center;border-bottom:1px solid #dce5de;padding-bottom:18px;margin-bottom:20px"><img src="/assets/mailflow-logo-horizontal.png" alt="MailFlow" style="width:124px;margin:auto"><p style="margin:10px 0 4px;color:#516a59;font-size:12px">USM Debate Society</p><h1 style="font-size:28px;line-height:1.05;margin:0">${escapeMergeValue(message.subject)}</h1></header>${message.bodyHtml}<section style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#f4f0e8;border-radius:10px;padding:14px;margin-top:22px"><div><small style="color:#6c766f">Date</small><strong style="display:block">15 September 2026</strong></div><div><small style="color:#6c766f">Venue</small><strong style="display:block">Dewan Budaya, USM</strong></div></section></body></html>`;
  return <WizardShell current={4} review title="Review every detail before it leaves." subtitle="Check representative rows, send a test to yourself, then confirm the paced campaign." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/recipients")}><ArrowLeft /> Back</button><button className="button button--outline" onClick={() => void sendTest()} disabled={testState === "sending" || (isLive && !state.table)}>{testState === "sending" ? <SpinnerGap className="spin" /> : <Envelope />} Send test to me</button><button className="button button--coral" disabled={!ready || (isLive && !state.table)} onClick={() => void start()}>Confirm &amp; start <PaperPlaneTilt weight="fill" /></button></>}><div className="review-layout"><aside className="panel sample-card"><span className="section-kicker">SAMPLE ROWS</span><h2>Who are you checking?</h2>{samples.slice(0, 3).map((preview, index) => <button key={`${preview.position}-${preview.sourceRow}`} className={index === safeIndex ? "selected" : ""} onClick={() => setSampleIndex(index)}><span>{["First", "Middle", "Last"][index]}</span><strong>{preview.to}</strong><small>Row {preview.sourceRow}</small></button>)}<footer><button aria-label="Previous sample" onClick={() => setSampleIndex((safeIndex + samples.length - 1) % samples.length)}><CaretLeft /></button><span>{safeIndex + 1} of {Math.min(3, samples.length)}</span><button aria-label="Next sample" onClick={() => setSampleIndex((safeIndex + 1) % samples.length)}><CaretRight /></button></footer></aside><section className="panel mailbox-preview"><div className="mail-toolbar"><button aria-label="Back"><ArrowLeft /></button><span>Preview controls</span><button aria-label="More actions">•••</button></div><div className="mail-meta"><span className="avatar">{displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{displayName}</strong><small>{sender}</small></span><StatusChip status="ready">Preview</StatusChip></div><dl><div><dt>To</dt><dd>{message.to}</dd></div>{message.cc.length > 0 && <div><dt>CC</dt><dd>{message.cc.join(", ")}</dd></div>}{message.bcc.length > 0 && <div><dt>BCC</dt><dd>{message.bcc.join(", ")}</dd></div>}{message.replyTo.length > 0 && <div><dt>Reply-to</dt><dd>{message.replyTo.join(", ")}</dd></div>}<div><dt>Subject</dt><dd>{message.subject}</dd></div></dl><iframe title={`Email preview for ${message.to}`} sandbox="allow-same-origin" srcDoc={previewDocument} /></section><aside className="panel review-summary"><span className="section-kicker">FINAL CHECK</span><h2>Review summary</h2>{[[Envelope, "Sender", sender], [Users, "Recipients", `${state.validation?.validRecipientCount ?? state.draft.rowCount - 3} valid, ${state.validation?.skippedRecipientCount ?? 3} skipped`], [Envelope, "CC", state.draft.cc || "None"], [Gauge, "Pacing", `${state.draft.pace} messages per minute`], [Clock, "Estimated duration", `About ${Math.ceil((state.validation?.validRecipientCount ?? state.draft.rowCount) / state.draft.pace)} minutes`], [CheckCircle, "Validation", state.validation ? (state.validation.ok ? "Ready to queue" : `${state.validation.issues.length} issues to review`) : "Ready to queue"]].map(([Icon, label, value]) => <div className="fact" key={label}><span><Icon weight="fill" /></span><div><small>{label}</small><strong>{value}</strong></div></div>)}{canSkip && <label className="ack"><input type="checkbox" checked={state.skipInvalidRows} onChange={(event) => state.setSkipInvalidRows(event.target.checked)} /><span>Skip the flagged rows and continue with valid recipients only.</span></label>}<label className="ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I have checked the sender, recipients, and personalized message.</span></label><div className="accepted-note"><Info weight="fill" /> Microsoft acceptance means the request was received. It is not a delivery receipt.</div><p className="test-status" aria-live="polite">{testState === "accepted" && <><CheckCircle weight="fill" /> Test accepted by Microsoft</>}{testState === "sending" && "Sending one message to your mailbox..."}{testState === "error" && <><WarningCircle weight="fill" /> {actionError}</>}{actionError && testState !== "error" && <><WarningCircle weight="fill" /> {actionError}</>}</p></aside></div></WizardShell>;
}

const defaultRouteCounts = [["Total", 148, Rows], ["Pending", 26, Clock], ["Sending", 4, PaperPlaneTilt], ["Accepted", 115, Check], ["Skipped", 3, MinusCircle], ["Failed", 0, WarningCircle]];

function CampaignPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { isLive, csrfToken, user } = useApi();
  const [campaignState, setCampaignState] = useState(null);
  const [counts, setCounts] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionState, setActionState] = useState("idle");
  const isDemo = campaignId === "CMP-2026-08-31-DEMO";
  const fixtureMode = !isLive && isDemo;

  const load = useCallback(async () => {
    if (!isLive || isDemo || !campaignId) return;
    try {
      const [campaignResponse, jobsResponse] = await Promise.all([getCampaign(campaignId), getCampaignJobs(campaignId, 100, 0)]);
      setCampaignState(campaignResponse.campaign);
      setCounts(campaignResponse.counts);
      setJobs(jobsResponse.jobs);
      setLoadError("");
    } catch (error) {
      // Do not replace an authenticated campaign with demo rows when a fetch
      // fails. Clearing the remote snapshot keeps the UI honest about data.
      setCampaignState(null);
      setCounts(null);
      setJobs(null);
      setLoadError(error instanceof Error ? error.message : "The campaign could not be loaded.");
    }
  }, [isLive, isDemo, campaignId]);

  useEffect(() => {
    void load();
    if (!isLive || isDemo || !campaignId) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, isLive, isDemo, campaignId]);

  if (isLive && isDemo) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>No live campaign selected.</h1><p>Choose a campaign from your authenticated dashboard.</p><Link className="button button--outline" to="/dashboard">Return to dashboard</Link></div></AppShell>;
  }

  const paused = fixtureMode ? campaignState?.state === "paused" : campaignState?.state === "paused";
  const fixtureCounts = { pending: 26, claimed: 0, sending: 4, accepted: 115, skipped: 3, failed: 0, unknown: 0 };
  const activeCounts = fixtureMode ? fixtureCounts : (counts || { pending: 0, claimed: 0, sending: 0, accepted: 0, skipped: 0, failed: 0, unknown: 0 });
  const total = fixtureMode ? 148 : (campaignState?.totalRecipients || 0);
  const processed = activeCounts.accepted + activeCounts.failed + activeCounts.skipped + activeCounts.unknown;
  const progress = fixtureMode ? 80 : (campaignState ? Math.min(100, Math.round((processed / Math.max(1, total)) * 100)) : 0);
  const routeCounts = fixtureMode ? defaultRouteCounts : [["Total", total, Rows], ["Pending", activeCounts.pending, Clock], ["Sending", activeCounts.sending + activeCounts.claimed, PaperPlaneTilt], ["Accepted", activeCounts.accepted, Check], ["Skipped", activeCounts.skipped, MinusCircle], ["Failed", activeCounts.failed + activeCounts.unknown, WarningCircle]];
  const displayJobs = fixtureMode ? jobFixtures.map((job) => ({ sourceRow: job.row, recipient: job.recipient, status: job.status, attemptCount: job.attempts, updatedAt: job.update, lastErrorMessage: job.note })) : (jobs || []);
  const sender = fixtureMode ? memberFixture.email : campaignState?.senderAddress || user?.mailboxAddress || "Sender not available";
  const statusKind = fixtureMode ? (paused ? "paused" : "running") : campaignState?.state || "unknown";
  const statusLabel = statusKind === "paused" ? "Paused safely" : statusKind === "completed" ? "Completed" : statusKind === "failed" ? "Failed" : statusKind === "queued" ? "Queued" : statusKind === "validated" ? "Validated" : statusKind === "draft" ? "Draft" : loadError ? "Unavailable" : "Loading";
  const updateAction = async (action) => {
    if (actionState !== "idle") return;
    if (fixtureMode) { setCampaignState((current) => ({ ...(current || {}), state: action === "pause" ? "paused" : "running" })); return; }
    if (!isLive || !campaignId || !["queued", "running", "paused"].includes(campaignState?.state)) return;
    setActionState(action); setLoadError("");
    try { if (action === "pause") await pauseCampaign(campaignId, csrfToken); else await resumeCampaign(campaignId, csrfToken); await load(); } catch (error) { setLoadError(error instanceof Error ? error.message : "The campaign could not be updated."); } finally { setActionState("idle"); }
  };
  const exportRows = async () => {
    try {
      if (isLive && campaignId) {
        const blob = await downloadCampaignExport(campaignId); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${campaignId}-results.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } else downloadResultsCsv(displayJobs.map((job) => ({ sourceRow: job.sourceRow, recipient: job.recipient, status: job.status, attemptCount: job.attemptCount, acceptedAt: job.acceptedAt, lastErrorMessage: job.lastErrorMessage })), `${campaignId || "campaign"}-results.csv`);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "The result export could not be prepared."); }
  };
  return <AppShell><div className="page campaign-page"><header className="page-header campaign-header"><div><span className="section-kicker">SECTION 6 OF 6</span><h1>The campaign can leave without you.</h1><p>MailFlow will keep pacing, recording each row, and retrying only proven safe failures.</p></div><div className="header-actions"><button className="button button--outline" onClick={() => void updateAction(paused ? "resume" : "pause")} disabled={actionState !== "idle" || (!fixtureMode && !["queued", "running", "paused"].includes(campaignState?.state))}>{actionState !== "idle" ? <SpinnerGap className="spin" /> : paused ? <Play weight="fill" /> : <Pause weight="fill" />}{paused ? "Resume campaign" : "Pause campaign"}</button><button className="button button--outline" onClick={() => navigate("/dashboard")}>Close dashboard <X /></button></div></header>{loadError && <div className="notice notice--warn" role="alert"><WarningCircle weight="fill" /> {loadError}</div>}<div className="campaign-identity"><span className="mini-mark"><Envelope weight="fill" /></span><div><h2>{fixtureMode ? "PIXEL Judges · 31 Aug 2026" : `Campaign ${campaignId}`}</h2><code>{sender}</code></div><StatusChip status={statusKind}>{statusLabel}</StatusChip></div><section className="panel route-summary" aria-live="polite"><div className="route-counts">{routeCounts.map(([label, count, Icon]) => <div className={`count count--${label.toLowerCase()}`} key={label}><span><Icon weight="bold" /></span><strong>{count}</strong><small>{label}</small></div>)}</div><div className="progress-meta"><span>{paused ? "Paused, accepted rows remain protected" : `${campaignState?.pacePerMinute || 12} messages/min · About ${Math.max(0, Math.ceil((total - processed) / Math.max(1, campaignState?.pacePerMinute || 12)))} minutes remaining`}</span><strong>{progress}%</strong></div><div className="progress-track" aria-label={`${progress}% processed`}><i style={{ width: `${progress}%` }} /></div></section><div className="campaign-lower"><section className="panel jobs-panel"><div className="section-heading"><div><h2>Recipient jobs</h2><p>Each spreadsheet row has one auditable outcome.</p></div><button className="button button--outline button--small" onClick={() => void exportRows()}><DownloadSimple /> Export issues</button></div><div className="table-wrap"><table><thead><tr><th>Recipient</th><th>Row</th><th>Status</th><th>Attempts</th><th>Last update</th><th>Note</th></tr></thead><tbody>{displayJobs.slice(0, 5).map((job) => { const status = job.status; const note = job.lastErrorMessage || (status === "accepted" ? "Request accepted" : status === "pending" ? "Queued" : "Waiting for Microsoft"); return <tr key={`${job.recipient}-${job.sourceRow}`}><td><strong>{job.recipient}</strong></td><td>{job.sourceRow}</td><td><StatusChip status={status}>{status === "accepted" ? "Accepted by Microsoft" : status[0].toUpperCase() + status.slice(1)}</StatusChip></td><td>{job.attemptCount}</td><td>{job.updatedAt || "Not available"}</td><td>{note}{status === "skipped" && <button className="text-link">Fix row <ArrowSquareOut /></button>}</td></tr>; })}</tbody></table></div><footer className="table-footer"><span>Showing 1-{Math.min(5, displayJobs.length)} of {total} rows</span><div><button aria-label="Previous page"><CaretLeft /></button><button aria-label="Next page"><CaretRight /></button></div></footer></section><aside className="campaign-aside"><section className="panel recovery-card"><span className="route-dot"><FlowArrow /></span><h2>If something interrupts</h2><p>Resume from the first unsent row.</p><strong>Accepted recipients are never sent twice.</strong><button className="button button--outline" onClick={() => void load()}><ListChecks /> Review recovery rules</button></section><section className="audit-card"><img src="/assets/campaign-audit-receipt.png" alt="MailFlow campaign audit receipt" /><div className="audit-copy"><span className="section-kicker">AUDIT RECEIPT</span><dl><div><dt>Campaign ID</dt><dd>{campaignId || "Not available"}</dd></div><div><dt>Template</dt><dd>Event Invitation v2.1</dd></div><div><dt>Started</dt><dd>{fixtureMode ? "31 Aug 2026 10:40:10 MYT" : formatDate(campaignState?.startedAt)}</dd></div><div><dt>Started by</dt><dd>{user?.displayName || memberFixture.name}</dd></div></dl></div></section></aside></div></div></AppShell>;
}

export function App() {
  const protectedRoute = (element) => <RequireProductSession>{element}</RequireProductSession>;
  return <BrowserRouter><AppDataProvider><DraftProvider><Routes><Route path="/" element={<LandingPage />} /><Route path="/dashboard" element={protectedRoute(<DashboardPage />)} /><Route path="/flows/new/template" element={protectedRoute(<TemplatePage />)} /><Route path="/flows/new/data" element={protectedRoute(<DataPage />)} /><Route path="/flows/new/recipients" element={protectedRoute(<RecipientsPage />)} /><Route path="/flows/new/review" element={protectedRoute(<ReviewPage />)} /><Route path="/campaigns/:campaignId" element={protectedRoute(<CampaignPage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></DraftProvider></AppDataProvider></BrowserRouter>;
}
