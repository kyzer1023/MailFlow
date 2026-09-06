import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  ApiRequestError,
  getCampaigns,
  getFlows,
  getMe,
} from "../api";
import type { ApiConfig } from "../api";
import type { ApiContextValue, DashboardState, SessionState } from "./types";

export const fallbackConfig: ApiConfig = {
  defaultPacePerMinute: 12,
  maxCampaignRecipients: 300,
  mailTransport: "graph",
  attachmentsEnabled: false,
  attachmentsReauthorizationRequired: false,
  attachmentsSmtpAuthorizationRequired: false,
  attachmentsOneDriveAuthorizationRequired: false,
};

const dashboardDataRoutes = new Set(["/dashboard", "/flows", "/campaigns"]);

export const ApiContext = createContext<ApiContextValue | null>(null);

export function AppDataProvider({ children }: { readonly children: ReactNode }) {
  const location = useLocation();
  const [session, setSession] = useState<SessionState>({
    status: "loading",
    user: null,
    csrfToken: "",
    config: fallbackConfig,
  });
  const [dashboard, setDashboard] = useState<DashboardState>({
    status: "idle",
    flows: null,
    campaigns: null,
    error: "",
  });
  const dashboardRequestRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(session.user?.id || null);
  activeUserIdRef.current = session.user?.id || null;

  const refreshDashboard = useCallback(async (): Promise<void> => {
    const userId = activeUserIdRef.current;
    if (!userId) return;
    const requestId = ++dashboardRequestRef.current;
    setDashboard({ status: "loading", flows: null, campaigns: null, error: "" });
    try {
      const [flowsResponse, campaignsResponse] = await Promise.all([getFlows(), getCampaigns()]);
      const flowNames = new Map(flowsResponse.flows.map((flow) => [flow.id, flow.name]));
      const campaigns = campaignsResponse.campaigns.map(({ counts, ...campaign }) => ({
        campaign, counts, flowName: flowNames.get(campaign.flowId) || "",
      }));
      if (requestId !== dashboardRequestRef.current || activeUserIdRef.current !== userId) return;
      setDashboard({ status: "ready", flows: flowsResponse.flows, campaigns, nextCampaignCursor: campaignsResponse.nextCursor ?? null, error: "" });
    } catch (error) {
      if (requestId !== dashboardRequestRef.current || activeUserIdRef.current !== userId) return;
      setDashboard({ status: "error", flows: null, campaigns: null, error: error instanceof Error ? error.message : "The dashboard could not be loaded." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    getMe().then((response) => {
      if (!active) return;
      setSession({ status: "authenticated", user: response.user, csrfToken: response.csrfToken, config: response.config || fallbackConfig });
    }).catch((error) => {
      if (!active) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        setSession({ status: "unauthenticated", user: null, csrfToken: "", config: fallbackConfig });
        return;
      }
      setSession({ status: "error", user: null, csrfToken: "", config: fallbackConfig, error: error instanceof Error ? error.message : "Mail Flow could not verify this session." });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    dashboardRequestRef.current += 1;
    setDashboard({ status: "idle", flows: null, campaigns: null, error: "" });
  }, [session.user?.id]);

  useEffect(() => {
    if (session.user && dashboardDataRoutes.has(location.pathname)) void refreshDashboard();
  }, [location.key, location.pathname, session.user, refreshDashboard]);

  const value = useMemo<ApiContextValue>(() => ({
    ...session,
    isLive: session.status === "authenticated" && Boolean(session.user),
    dashboard,
    refreshDashboard,
    setSession,
  }), [session, dashboard, refreshDashboard]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  return useContext(ApiContext)!;
}
