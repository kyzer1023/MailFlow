import { FlowArrow, Plus, WarningCircle } from "@phosphor-icons/react";
import { archiveFlow } from "../../api";
import { FlowCard } from "../../components/overview/FlowCard";
import { AppShell } from "../../components/shell/AppShell";
import { useFlowActions } from "../../hooks/use-flow-actions";
import { displayFlow } from "../../lib/view-models";
import { useApi } from "../../state/api-context";
import { useState } from "react";

interface RemoveState {
  readonly confirmingId: string | null;
  readonly workingId: string | null;
  readonly error: string;
}

export function FlowsPage() {
  const { dashboard, csrfToken, refreshDashboard } = useApi();
  const { openingFlowId, openFlowError, openFlow, startNewFlow } = useFlowActions();
  const [removeState, setRemoveState] = useState<RemoveState>({ confirmingId: null, workingId: null, error: "" });
  const flows = dashboard.flows ? dashboard.flows.map(displayFlow) : [];
  const confirmRemove = (flowId: string) => setRemoveState({ confirmingId: flowId, workingId: null, error: "" });
  const cancelRemove = () => setRemoveState({ confirmingId: null, workingId: null, error: "" });
  const removeFlow = async (flowId: string) => {
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
