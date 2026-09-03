import { CheckCircle, House, MicrosoftOutlookLogo, SignOut, SpinnerGap } from "@phosphor-icons/react";
import { useState } from "react";
import { Brand } from "../../components/shell/Brand";
import { useSignOut } from "../../hooks/use-sign-out";
import { useApi } from "../../state/api-context";

export interface LandingActionProps {
  readonly compact?: boolean;
  readonly allowSignOut?: boolean;
}

export function LandingAction({ compact = false, allowSignOut = false }: LandingActionProps) {
  const { status, user } = useApi();
  const [leaving, setLeaving] = useState(false);
  const { signOut, signingOut, signOutError } = useSignOut();
  const authenticated = status === "authenticated" && Boolean(user);
  const checking = status === "loading";

  if (authenticated) {
    return <div className="landing-auth-actions"><a className={compact ? "button button--outline button--small landing-action" : "button button--coral button--hero landing-action"} href="/dashboard"><House weight="bold" />{compact ? "Dashboard" : "Go to dashboard"}</a>{allowSignOut && <button className="button button--text button--small" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <SpinnerGap className="spin" /> : <SignOut />} Sign out</button>}{signOutError && <span className="error-text" role="alert">{signOutError}</span>}</div>;
  }

  const onClick = () => { setLeaving(true); window.location.assign(`/auth/microsoft/start?returnTo=${encodeURIComponent("/dashboard")}`); };
  const label = checking ? "Checking session" : leaving ? (compact ? "Opening" : "Opening Microsoft") : compact ? "Sign in" : "Continue with Microsoft";
  return <button className={compact ? "button button--outline button--small landing-action" : "button button--coral button--hero landing-action"} type="button" onClick={onClick} disabled={checking || leaving} aria-busy={checking || leaving}>{checking || leaving ? <SpinnerGap className="spin" weight="bold" /> : <MicrosoftOutlookLogo weight="fill" />}{label}</button>;
}

export function LandingPage() {
  return <div className="landing">
    <header className="marketing-header"><Brand /><LandingAction compact allowSignOut /></header>
    <main className="landing-hero">
      <section className="hero-copy"><h1>Every send,<br />accounted for.</h1><p>Personalized campaign email for student societies, sent safely through your own USM Outlook.</p><LandingAction /><div className="trust-note"><span className="trust-note__item"><CheckCircle weight="fill" /> Uses delegated Microsoft OAuth</span><span className="trust-note__item"><span className="trust-note__separator" aria-hidden="true">•</span> Your mailbox stays yours</span></div></section>
    </main>
  </div>;
}
