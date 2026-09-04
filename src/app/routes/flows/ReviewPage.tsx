import { ArrowLeft, CaretLeft, CaretRight, CheckCircle, Clock, Envelope, Gauge, Info, Paperclip, PaperPlaneTilt, SpinnerGap, Users, WarningCircle, type Icon } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { buildMessagePreviews, buildPreviewSrcDoc } from "../../../client";
import { attachmentSummaryText } from "../../lib/attachments";
import { uniqueValidationIssues, validationIssueAction } from "../../lib/review";
import { AppShell } from "../../components/shell/AppShell";
import { StatusChip } from "../../components/common/StatusChip";
import { WizardShell } from "../../components/wizard/WizardShell";
import { useEnsureCampaign } from "../../hooks/use-ensure-campaign";
import { useApi } from "../../state/api-context";
import { useDraft } from "../../state/draft-context";
import { sendCampaignTest, startCampaign } from "../../api";

type TestState = "idle" | "sending" | "accepted" | "error";

export function ReviewPage() {
  const state = useDraft();
  const { user, csrfToken, refreshDashboard } = useApi();
  const navigate = useNavigate();
  const [sampleIndex, setSampleIndex] = useState(0);
  const [ack, setAck] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [actionError, setActionError] = useState("");
  const ensureCampaign = useEnsureCampaign();
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const displayName = user?.displayName || "USM member";
  const rows = state.validation?.validRows || [];
  const attachments = state.attachments || [];
  const previews = useMemo(() => buildMessagePreviews({ senderAddress: sender, subjectTemplate: state.draft.subject, bodyHtml: state.bodyHtml, rows, fieldMappings: state.draft.mappings }), [sender, state.draft.subject, state.draft.mappings, state.bodyHtml, rows]);
  const safeIndex = Math.min(sampleIndex, Math.max(0, previews.length - 1));
  const message = previews[safeIndex] || null;
  const canSkip = Boolean(state.validation && !state.validation.ok && state.validation.issues.length > 0 && state.validation.issues.every((issue) => issue.row !== undefined));
  const blockingIssues = uniqueValidationIssues(state.campaignValidation?.issues || []);
  const attachmentBlocker = state.attachmentsUploading
    ? "Finish uploading attachments before continuing."
    : state.attachmentsHaveErrors
      ? "Remove failed attachments or retry before continuing."
      : !state.attachmentsReady
        ? "Finish preparing attachments before continuing."
        : "";
  const ready = Boolean(state.table && message && ack && state.campaignValidation?.ok && state.attachmentsReady);
  const actionBlocker = blockingIssues.length > 0
    ? `Resolve ${blockingIssues.length} validation ${blockingIssues.length === 1 ? "issue" : "issues"} first.`
    : attachmentBlocker || (!ack ? "Check the final acknowledgement first." : "");

  const sendTest = async () => {
    if (!message || !state.campaignValidation?.ok || !state.attachmentsReady) return;
    setTestState("sending");
    setActionError("");
    try {
      const response = await ensureCampaign();
      await sendCampaignTest(response!.campaign.id, {
        idempotencyKey: state.testSendRequestKey,
        sourceRow: message.sourceRow,
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
      await startCampaign(response!.campaign.id, csrfToken);
      void refreshDashboard();
      navigate(`/campaigns/${response!.campaign.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The campaign could not be started.");
    }
  };

  if (!state.table) {
    return <AppShell><div className="route-gate" role="status"><WarningCircle weight="fill" /><h1>Import a recipient file first.</h1><p>Review only becomes available after Data, Template, and Recipients are complete.</p><Link className="button button--coral" to="/flows/new/data">Start with data</Link></div></AppShell>;
  }

  const previewDocument = message ? buildPreviewSrcDoc(message.bodyHtml) : "";
  const summaryFacts: readonly (readonly [Icon, string, string])[] = [[Envelope, "Sender", sender], [Users, "Recipients", `${state.validation?.validRecipientCount ?? 0} valid, ${state.validation?.skippedRecipientCount ?? 0} skipped`], [Envelope, "CC", state.draft.cc || "None"], [Paperclip, "Attachments", attachmentSummaryText(attachments)], [Gauge, "Pacing", `${state.draft.pace} messages per minute`], [Clock, "Estimated duration", `About ${Math.ceil((state.validation?.validRecipientCount ?? 0) / state.draft.pace)} minutes`], [CheckCircle, "Validation", state.campaignValidation?.ok ? "Ready to queue" : `${blockingIssues.length} issues to review`]];
  return <WizardShell current={3} title="Review every detail before it leaves." subtitle="Check representative rows, send a test to yourself, then confirm the paced campaign." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/recipients")}><ArrowLeft /> Back</button><button className="button button--outline" onClick={() => void sendTest()} disabled={testState === "sending" || !message || !state.campaignValidation?.ok || !state.attachmentsReady} title={actionBlocker || undefined} aria-describedby={actionBlocker ? "review-blockers" : undefined}>{testState === "sending" ? <SpinnerGap className="spin" /> : <Envelope />} Send test to me</button><button className="button button--coral" disabled={!ready} onClick={() => void start()} title={actionBlocker || undefined} aria-describedby={actionBlocker ? "review-blockers" : undefined}>Confirm &amp; start <PaperPlaneTilt weight="fill" /></button></>}><div className="test-envelope-note" role="note"><Info weight="fill" /><div><strong>Test delivery stays in your mailbox.</strong><p>The preview keeps the campaign's original resolved To, CC, BCC, and Reply-to headers. For the test, To is replaced with {sender}, and CC, BCC, and Reply-to are suppressed. Subject, message, importance, and attachments stay the same.</p></div></div><div className="review-layout"><aside className="panel sample-card"><span className="section-kicker">SAMPLE ROWS</span><h2>Who are you checking?</h2>{previews.slice(0, 3).map((preview, index) => <button key={`${preview.position}-${preview.sourceRow}`} className={index === safeIndex ? "selected" : ""} onClick={() => setSampleIndex(index)}><span>{["First", "Middle", "Last"][index]}</span><strong>{preview.to}</strong><small>Row {preview.sourceRow}</small></button>)}{previews.length === 0 && <p className="empty-state">No valid recipient rows are available yet.</p>}<footer><button aria-label="Previous sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + previews.length - 1) % previews.length)}><CaretLeft /></button><span>{previews.length ? `${safeIndex + 1} of ${Math.min(3, previews.length)}` : "0 of 0"}</span><button aria-label="Next sample" disabled={previews.length < 2} onClick={() => setSampleIndex((safeIndex + 1) % previews.length)}><CaretRight /></button></footer></aside><section className="panel mailbox-preview">{message ? <><div className="mail-toolbar"><span>Original campaign preview</span></div><div className="mail-meta"><span className="avatar">{displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{displayName}</strong><small>{sender}</small></span><StatusChip status="ready">Preview</StatusChip></div><dl><div><dt>To</dt><dd>{message.to}</dd></div>{message.cc.length > 0 && <div><dt>CC</dt><dd>{message.cc.join(", ")}</dd></div>}{message.bcc.length > 0 && <div><dt>BCC</dt><dd>{message.bcc.join(", ")}</dd></div>}{message.replyTo.length > 0 && <div><dt>Reply-to</dt><dd>{message.replyTo.join(", ")}</dd></div>}<div><dt>Subject</dt><dd>{message.subject}</dd></div>{attachments.length > 0 && <div><dt>Attachments</dt><dd className="mail-attachment-summary">{attachmentSummaryText(attachments)}</dd></div>}</dl><iframe title={`Email preview for ${message.to}`} sandbox="allow-same-origin" srcDoc={previewDocument} /></> : <div className="empty-state">Resolve the recipient issues to generate a preview.</div>}</section><aside className="panel review-summary"><span className="section-kicker">FINAL CHECK</span><h2>Review summary</h2>{summaryFacts.map(([IconComponent, label, value]) => <div className="fact" key={label}><span><IconComponent weight="fill" /></span><div><small>{label}</small><strong>{value}</strong></div></div>)}{(blockingIssues.length > 0 || attachmentBlocker) && <section className="review-blockers" id="review-blockers" role="alert"><div><WarningCircle weight="fill" /><h3>Fix these before sending</h3></div>{blockingIssues.length > 0 && <ul>{blockingIssues.map((issue) => { const action = validationIssueAction(issue); return <li key={`${issue.code}:${issue.field || ""}:${issue.row || ""}:${issue.message}`}><span>{issue.message}</span><Link to={action.to}>{action.label}</Link></li>; })}</ul>}{attachmentBlocker && <p className="review-attachment-blocker">{attachmentBlocker} <Link to="/flows/new/recipients">Manage attachments</Link></p>}</section>}{canSkip && <label className="ack"><input type="checkbox" checked={state.skipInvalidRows} onChange={(event) => state.setSkipInvalidRows(event.target.checked)} /><span>Skip the flagged rows and continue with valid recipients only.</span></label>}<label className="ack"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>I have checked the sender, recipients, and personalized message.</span></label><div className="accepted-note"><Info weight="fill" /> Microsoft acceptance means the request was received. It is not a delivery receipt.</div><p className="test-status" aria-live="polite">{testState === "accepted" && <><CheckCircle weight="fill" /> Test accepted by Microsoft</>}{testState === "sending" && "Sending one message to your mailbox..."}{testState === "error" && <><WarningCircle weight="fill" /> {actionError}</>}{actionError && testState !== "error" && <><WarningCircle weight="fill" /> {actionError}</>}</p></aside></div></WizardShell>;
}
