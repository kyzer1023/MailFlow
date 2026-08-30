export const DEFAULT_ENTRA_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
] as const;

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: readonly string[];
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  graphBaseUrl?: string;
}

export interface ResolvedEntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  graphBaseUrl: string;
}

export function assertSingleTenantId(tenantId: string): string {
  const value = tenantId.trim();
  if (!value || /[/?#\\]/.test(value) || ["common", "organizations", "consumers"].includes(value.toLowerCase())) {
    throw new Error("A single Microsoft tenant id is required");
  }
  return value;
}

export function resolveEntraConfig(config: EntraConfig): ResolvedEntraConfig {
  const tenantId = assertSingleTenantId(config.tenantId);
  if (!config.clientId?.trim()) throw new Error("Microsoft client id is required");
  if (!config.clientSecret) throw new Error("Microsoft client secret is required");
  let redirectUri: URL;
  try {
    redirectUri = new URL(config.redirectUri);
  } catch {
    throw new Error("Microsoft redirect URI is invalid");
  }
  if (!/^https?:$/.test(redirectUri.protocol)) throw new Error("Microsoft redirect URI is invalid");
  const scopes = [...(config.scopes ?? DEFAULT_ENTRA_SCOPES)]
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (!scopes.includes("openid") || !scopes.includes("offline_access") || !scopes.includes("User.Read") || !scopes.includes("Mail.Send")) {
    throw new Error("Microsoft scopes must include openid, offline_access, User.Read, and Mail.Send");
  }
  return {
    tenantId,
    clientId: config.clientId.trim(),
    clientSecret: config.clientSecret,
    redirectUri: redirectUri.toString(),
    scopes,
    authorizationEndpoint: config.authorizationEndpoint ?? `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`,
    tokenEndpoint: config.tokenEndpoint ?? `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    graphBaseUrl: (config.graphBaseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, ""),
  };
}

