import type { ReactNode } from "react";
import { AppShell } from "../shell/AppShell";
import { WizardStepper } from "./WizardStepper";

export interface WizardShellProps {
  readonly current: number;
  readonly title: string;
  readonly subtitle: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}

export function WizardShell({ current, title, subtitle, actions, children }: WizardShellProps) {
  return <AppShell><WizardStepper current={current} /><div className="page wizard-page"><header className="page-header wizard-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="header-actions">{actions}</div></header>{children}</div></AppShell>;
}
