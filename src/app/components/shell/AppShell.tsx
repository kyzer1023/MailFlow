import type { ReactNode } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useApi } from "../../state/api-context";
import { SupportFooter } from "./SupportFooter";

export interface AppShellProps {
  readonly children: ReactNode;
}

function OneDriveAuthorizationNotice() {
  const location = useLocation();
  const { user, config } = useApi();
  const googleStatus = new URLSearchParams(location.search).get("google");
  if (user?.provider === "google" && (config.attachmentsReauthorizationRequired || googleStatus)) return <div className="notice notice--warn auth-journey-notice" role="status"><WarningCircle /><span>{googleStatus ? "Google connection did not complete. Your existing account is still signed in. " : "Google permissions are incomplete. "}Allow Gmail sending and temporary Drive app-data storage to enable all features. <a href={`/auth/google/start?returnTo=${encodeURIComponent(location.pathname)}`}>Reconnect Google</a></span></div>;
  const status = new URLSearchParams(location.search).get("onedrive");
  if (!status) return null;
  if (status === "connected") {
    return <div className="notice notice--success auth-journey-notice" role="status"><CheckCircle weight="fill" /> OneDrive is connected. Attachments are ready when you need them.</div>;
  }
  const message = status === "cancelled"
    ? "You are signed in. OneDrive connection was cancelled, so attachments remain unavailable."
    : status === "identity_mismatch"
      ? "You are signed in. OneDrive must be authorized with the same Microsoft account."
      : status === "unavailable"
        ? "You are signed in. OneDrive could not be started, so attachments remain unavailable."
        : "You are signed in. OneDrive was not connected, so attachments remain unavailable.";
  return <div className="notice notice--warn auth-journey-notice" role="status"><WarningCircle weight="fill" /><span>{message} <Link to="/flows/new/recipients">Connect from Recipients</Link></span></div>;
}

export function AppShell({ children }: AppShellProps) {
  return <div className="app-frame"><a className="skip-link" href="#main">Skip to content</a><Sidebar /><main className="workspace" id="main"><div className="workspace-content"><OneDriveAuthorizationNotice />{children}</div><SupportFooter /></main></div>;
}
