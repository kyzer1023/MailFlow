import { ArrowRight, Clock, Envelope, SpinnerGap, Trash } from "@phosphor-icons/react";
import type { FlowViewModel } from "../../state/types";
import { StatusChip } from "../common/StatusChip";

export interface FlowCardProps {
  readonly flow: FlowViewModel;
  readonly loading?: boolean;
  readonly removing?: boolean;
  readonly confirmingRemove?: boolean;
  readonly onUse?: () => void;
  readonly onEdit?: () => void;
  readonly onBeginRemove?: () => void;
  readonly onCancelRemove?: () => void;
  readonly onConfirmRemove?: () => void;
  readonly compact?: boolean;
}

export function FlowCard({
  flow,
  loading = false,
  removing = false,
  confirmingRemove = false,
  onUse,
  onEdit,
  onBeginRemove,
  onCancelRemove,
  onConfirmRemove,
  compact = false,
}: FlowCardProps) {
  const busy = loading || removing;
  return <article className={`flow-card ${compact ? "flow-card--compact" : ""}`} aria-busy={busy}>
    <div className="flow-title"><span className="mini-mark"><Envelope weight="fill" /></span><h3>{flow.name}</h3>{busy && <SpinnerGap className="spin" aria-label={removing ? "Removing flow" : "Opening flow"} />}</div>
    <div className="card-divider" />
    <small>Template</small>
    <div className="field-list">{flow.fields.map((field) => <code key={field}>{field}</code>)}</div>
    <footer><span><Clock /> {flow.metaLabel}</span><StatusChip status={flow.status}>{flow.status === "ready" ? "Ready" : "Draft"}</StatusChip></footer>
    <div className="flow-card-actions">
      <button type="button" className="button button--coral button--small" onClick={onUse} disabled={busy}>Use template <ArrowRight /></button>
      {onEdit && <button type="button" className="button button--outline button--small" onClick={onEdit} disabled={busy}>Edit</button>}
      {onBeginRemove && !confirmingRemove && <button type="button" className="button button--outline button--small" onClick={onBeginRemove} disabled={busy} aria-label={`Remove ${flow.name}`}><Trash /> Remove</button>}
      {confirmingRemove && <><span className="flow-remove-note">Campaign history stays available.</span><button type="button" className="button button--outline button--small" onClick={onCancelRemove} disabled={busy}>Keep template</button><button type="button" className="button button--danger button--small" onClick={onConfirmRemove} disabled={busy} aria-label={`Confirm remove ${flow.name}`}>{removing ? <SpinnerGap className="spin" /> : <Trash />} {removing ? "Removing" : "Confirm remove"}</button></>}
    </div>
  </article>;
}
