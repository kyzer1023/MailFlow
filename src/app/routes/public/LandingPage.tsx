import { CheckCircle, House, GoogleLogo, MicrosoftOutlookLogo, SignOut, SpinnerGap } from "@phosphor-icons/react";
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
  const [leaving, setLeaving] = useState<string | null>(null);
  const { signOut, signingOut, signOutError } = useSignOut();
  const authenticated = status === "authenticated" && Boolean(user);
  const checking = status === "loading";

  if (authenticated) {
    return <div className="landing-auth-actions"><a className={compact ? "button button--outline button--small landing-action" : "button button--coral button--hero landing-action"} href="/dashboard"><House weight="bold" />{compact ? "Dashboard" : "Go to dashboard"}</a>{allowSignOut && <button className="button button--text button--small" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? <SpinnerGap className="spin" /> : <SignOut />} Sign out</button>}{signOutError && <span className="error-text" role="alert">{signOutError}</span>}</div>;
  }

  if (compact) return <a className="button button--outline button--small landing-action" href="/#sign-in">Sign in</a>;
  const signIn = (provider: "microsoft" | "google") => { setLeaving(provider); window.location.assign(`/auth/${provider}/start?returnTo=%2Fdashboard`); };
  return <div id="sign-in" className="landing-auth-actions">
    <button className="button button--coral button--hero landing-action" type="button" onClick={() => signIn("microsoft")} disabled={checking || Boolean(leaving)} aria-busy={checking || leaving === "microsoft"}><MicrosoftOutlookLogo weight="fill" />{checking ? "Checking session" : leaving === "microsoft" ? "Opening Microsoft" : "Continue with Microsoft"}</button>
    <button className="button button--outline button--hero landing-action" type="button" onClick={() => signIn("google")} disabled={checking || Boolean(leaving)} aria-busy={leaving === "google"}><GoogleLogo weight="bold" />{leaving === "google" ? "Opening Google" : "Continue with Google"}</button>
  </div>;
}

export function LandingPage() {
  return <div className="landing">
    <header className="marketing-header"><Brand /><LandingAction compact allowSignOut /></header>
    <main className="landing-hero">
      <section className="hero-copy"><h1>Every send,<br />accounted for.</h1><p>Personalized campaign email for student societies, sent safely through your own USM Outlook or personal Gmail.</p><LandingAction /><div className="trust-note"><span className="trust-note__item"><CheckCircle weight="fill" /> Uses secure provider sign-in</span><span className="trust-note__item"><span className="trust-note__separator" aria-hidden="true">•</span> Your mailbox stays yours</span></div><a className="committee-presentation-link" href="/presentation/">For committees: view the presentation</a><p className="trust-note">Google and Microsoft accounts stay separate. Gmail access is subject to Google consent and quota limits.</p><a className="committee-presentation-link" href="/privacy/">Privacy</a></section>
    </main>
  </div>;
}
