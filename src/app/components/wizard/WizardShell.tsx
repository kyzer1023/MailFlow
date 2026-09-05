import type { ReactNode } from "react";
import { AppShell } from "../shell/AppShell";
import { WizardStepper } from "./WizardStepper";
import { ArrowLeft, Lock } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { useDraft } from "../../state/draft-context";

export interface WizardShellProps {
  readonly current: number;
  readonly title: string;
  readonly subtitle: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
  readonly busy?: boolean;
}

export function WizardShell({
  current,
  title,
  subtitle,
  actions,
  children,
  busy = false,
}: WizardShellProps) {
  const state = useDraft();
  const navigate = useNavigate();
  return (
    <AppShell>
      <div className="send-workspace">
        <div className="send-context">
          <Link to="/dashboard">
            <ArrowLeft /> Back to home
          </Link>
          <strong>{state.draft.name || "New send"}</strong>
          <span>{state.snapshotLocked ? "Prepared" : "Draft"}</span>
        </div>
        <WizardStepper current={current} />
        <div className="page wizard-page">
          <header className="page-header wizard-header">
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </header>
          {state.snapshotLocked && (
            <div className="notice snapshot-notice">
              <Lock />
              <div>
                <strong>This reviewed send is locked.</strong>
                <p>
                  Tests and sending use the same message and files. To make
                  changes, start a new send from this message.
                  {state.attachments.length > 0 &&
                    " You will need to choose the attachment files again."}
                </p>
                <button
                  className="button button--outline"
                  disabled={busy}
                  onClick={() => {
                    state.restartFromMessage();
                    navigate("/flows/new/template");
                  }}
                >
                  New send from this message
                </button>
              </div>
            </div>
          )}
          <div inert={Boolean(state.snapshotLocked && current < 2)}>
            {children}
          </div>
        </div>
        <footer className="wizard-actions">
          <span className="send-assurance">
            <Lock /> Nothing is sent until you confirm.
          </span>
          <div className="header-actions">{actions}</div>
        </footer>
      </div>
    </AppShell>
  );
}
