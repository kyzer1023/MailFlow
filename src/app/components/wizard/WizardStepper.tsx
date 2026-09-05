import { Check } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { steps } from "./steps";
import { useDraft } from "../../state/draft-context";

export interface WizardStepperProps {
  readonly current: number;
}

export function WizardStepper({ current }: WizardStepperProps) {
  const { validation } = useDraft();
  const attention = validation?.invalidRows.length || 0;
  return <div className="stepper-wrap">
    <ol className="stepper" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map(([label, to], index) => {
        const state = index < current ? "complete" : index === current ? "current" : "future";
        const content = <><span className="stepper-node" aria-hidden="true">{state === "complete" && !(index === 0 && attention) ? <Check weight="bold" /> : index + 1}</span><span className="stepper-label">{label}{index === 0 && current > 0 && attention > 0 && <small>{attention} to review</small>}</span></>;
        return <li className={state} key={label}>{state === "future" ? <span className="stepper-future">{content}</span> : <Link to={to} aria-current={state === "current" ? "step" : undefined}>{content}</Link>}</li>;
      })}
    </ol>
    <span className="wizard-count" aria-hidden="true">{current + 1} of {steps.length}</span>
  </div>;
}
