import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFlow } from "../api";
import type { FlowViewModel } from "../state/types";
import { useDraft } from "../state/draft-context";

export type FlowOpenMode = "use" | "edit";

export interface FlowActions {
  readonly openingFlowId: string | null;
  readonly openFlowError: string;
  readonly openFlow: (flow: Pick<FlowViewModel, "id">, mode?: FlowOpenMode) => Promise<void>;
  readonly startNewFlow: () => void;
}

export function useFlowActions(): FlowActions {
  const navigate = useNavigate();
  const { hydrateSavedFlow, resetWizardState } = useDraft();
  const [openingFlowId, setOpeningFlowId] = useState<string | null>(null);
  const [openFlowError, setOpenFlowError] = useState("");
  const openFlow = async (flow: Pick<FlowViewModel, "id">, mode: FlowOpenMode = "use"): Promise<void> => {
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
