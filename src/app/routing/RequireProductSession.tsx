import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { useApi } from "../state/api-context";

export function RequireProductSession({ children }: { readonly children: ReactNode }) {
  const { status, user, error } = useApi();
  if (status === "loading") return <div className="route-gate" role="status"><SpinnerGap className="spin" /> Loading Mail Flow...</div>;
  if (status === "error") return <div className="route-gate" role="alert"><WarningCircle weight="fill" /><h1>Mail Flow could not load this session.</h1><p>{error || "Try again in a moment."}</p><a className="button button--outline" href="/">Return to sign in</a></div>;
  if (!user) return <Navigate to="/" replace />;
  return children;
}
