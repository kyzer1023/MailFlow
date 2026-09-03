import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { SupportFooter } from "./SupportFooter";

export interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return <div className="app-frame"><a className="skip-link" href="#main">Skip to content</a><Sidebar /><main className="workspace" id="main"><div className="workspace-content">{children}</div><SupportFooter /></main></div>;
}
