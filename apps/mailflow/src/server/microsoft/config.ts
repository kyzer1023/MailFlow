export const DEFAULT_ENTRA_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
] as const;

export const SMTP_ENTRA_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://outlook.office.com/SMTP.Send",
] as const;

export type MailTransport = "graph" | "smtp";

export function resolveMailTransport(value: string | undefined): MailTransport {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "graph") return "graph";
  if (normalized === "smtp") return "smtp";
  throw new Error("MAIL_TRANSPORT must be graph or smtp");
}

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
  const hasGraphMailScopes = scopes.includes("User.Read") && scopes.includes("Mail.Send");
  const hasSmtpScope = scopes.includes("https://outlook.office.com/SMTP.Send");
  if (hasGraphMailScopes && hasSmtpScope) throw new Error("Graph and SMTP require separate resource-specific access tokens");
  if (!scopes.includes("openid") || !scopes.includes("offline_access") || (!hasGraphMailScopes && !hasSmtpScope)) {
    throw new Error("Microsoft scopes must include openid, offline_access, and one supported mail transport scope set");
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

