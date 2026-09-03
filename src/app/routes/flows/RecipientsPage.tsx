import { ArrowLeft, ArrowRight, CheckCircle, Envelope, Gauge, Info, WarningCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { AttachmentPicker } from "../../components/attachments/AttachmentPicker";
import { AddressRuleField, type AddressRuleFieldProps } from "../../components/recipients/AddressRuleField";
import { Field } from "../../components/common/Field";
import { WizardShell } from "../../components/wizard/WizardShell";
import { columnOptions } from "../../lib/view-models";
import { useApi } from "../../state/api-context";
import { useDraft } from "../../state/draft-context";
import type { AddressRuleMode, DraftState } from "../../state/types";

type RecipientField = "cc" | "bcc" | "replyTo";
type RuleProperty = "value" | "mode" | "column";

export function RecipientsPage() {
  const { draft, setDraft, updateDraft, table, validation, attachmentsReady } = useDraft();
  const { user, config } = useApi();
  const navigate = useNavigate();
  const options = columnOptions(table);
  const sender = user?.mailboxAddress || user?.principalName || "Sender not available";
  const updateRule = (fieldKey: RecipientField, property: RuleProperty, value: string | AddressRuleMode) => setDraft((current) => ({ ...current, [property === "mode" ? `${fieldKey}Mode` : property === "column" ? `${fieldKey}Column` : fieldKey]: value } as DraftState));
  const ruleProps = (fieldKey: RecipientField, label: string, hint?: string): AddressRuleFieldProps => ({
    fieldKey,
    label,
    hint,
    value: draft[fieldKey],
    mode: draft[`${fieldKey}Mode` as keyof DraftState] as AddressRuleMode,
    column: draft[`${fieldKey}Column` as keyof DraftState] as string,
    options,
    onValue: (value) => updateRule(fieldKey, "value", value),
    onMode: (value) => updateRule(fieldKey, "mode", value),
    onColumn: (value) => updateRule(fieldKey, "column", value),
  });

  return <WizardShell current={2} title="Set the sending rules." subtitle="Recipients stay scoped to this file and this flow. Your USM Outlook remains the sender." actions={<><button className="button button--outline" onClick={() => navigate("/flows/new/template")}><ArrowLeft /> Back</button><button className="button button--coral" onClick={() => navigate("/flows/new/review")} disabled={!table || !draft.toField || !attachmentsReady} title={!attachmentsReady ? "Finish attachment uploads before continuing." : undefined}>Continue to review <ArrowRight /></button></>}>
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
        {config.attachmentsEnabled
          ? <AttachmentPicker />
          : config.attachmentsSmtpAuthorizationRequired
            ? <div className="notice notice--warn"><Info weight="fill" /><span>Reconnect Microsoft to authorize SMTP attachments.</span><a className="button button--text" href="/auth/microsoft/start?returnTo=%2Fflows%2Fnew%2Frecipients">Reconnect Microsoft</a></div>
            : config.attachmentsOneDriveAuthorizationRequired
              ? <div className="notice notice--warn"><Info weight="fill" /><span>Connect your OneDrive to store attachment files in your MailFlow app folder.</span><a className="button button--text" href="/auth/microsoft/onedrive/start?returnTo=%2Fflows%2Fnew%2Frecipients">Connect OneDrive</a></div>
              : <div className="notice"><Info weight="fill" /><span>Attachments become available when this deployment uses SMTP delivery.</span></div>}
      </section>
      <aside className="panel pace-card"><Gauge weight="duotone" /><h2>Paced for safety</h2><p>Mail Flow sends one personalized message at a time and records the result for every row.</p><Field label={`${draft.pace} messages per minute`}><input type="range" min="6" max="20" value={draft.pace} onChange={(event) => updateDraft("pace", Number(event.target.value))} /></Field><div className="pace-facts"><span><strong>{validation?.totalRows ?? draft.rowCount}</strong>Total rows</span><span><strong>About {Math.ceil((validation?.validRecipientCount ?? draft.rowCount) / draft.pace)} min</strong>Estimated time</span></div><div className="notice"><Info weight="fill" /><span>Accepted rows are never sent twice. An uncertain Microsoft response is marked Unknown for manual review.</span></div></aside>
    </div>
  </WizardShell>;
}
