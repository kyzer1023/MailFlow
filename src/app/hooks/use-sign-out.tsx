import { useState } from "react";
import { logout } from "../api";
import { fallbackConfig, useApi } from "../state/api-context";

interface SignOutState {
  readonly status: "idle" | "working" | "error";
  readonly error: string;
}

export interface SignOutActions {
  readonly signOut: () => Promise<void>;
  readonly signingOut: boolean;
  readonly signOutError: string;
}

export function useSignOut(): SignOutActions {
  const { csrfToken, setSession } = useApi();
  const [state, setState] = useState<SignOutState>({ status: "idle", error: "" });
  const signOut = async (): Promise<void> => {
    if (state.status === "working") return;
    setState({ status: "working", error: "" });
    try {
      await logout(csrfToken);
      setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
      window.location.assign("/");
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Mail Flow could not sign you out." });
    }
  };
  return { signOut, signingOut: state.status === "working", signOutError: state.error };
}
