import { MicrosoftAuthService } from "../auth/service";
import { DEFAULT_SESSION_TTL_SECONDS } from "../auth/session";
import { createD1AuthStores } from "../database/d1-auth";
import { createD1Repositories } from "../database/d1";
import type { Repositories } from "../database/contracts";
import {
  ExchangeOnlineSmtpClient,
  GraphMailProvider,
  ONEDRIVE_ENTRA_SCOPES,
  resolveMailTransport,
  SMTP_ENTRA_SCOPES,
} from "../microsoft";
import type { MailTransport } from "../microsoft";
import {
  AttachmentError,
  createAttachmentService,
  OneDriveAppFolderAttachmentStore,
  type AttachmentService,
} from "../attachments";
import type { MailFlowContext } from "./context";
import type { MailFlowBindings } from "./contracts";
import { safeErrorKind } from "../diagnostics";
import { GoogleAuthService, DRIVE_SCOPE, GMAIL_SCOPE } from "../google/auth";
import { gmailMailProvider } from "../google/gmail";
import { GoogleAppDataAttachmentStore } from "../google/drive";
import { delegatedGraphMailProvider, delegatedSmtpMailProvider } from "../microsoft";
import type { CampaignRecord } from "../../domain/types";
import type { AttachmentObjectStore } from "../attachments/contracts";

export function googleAuthFor(bindings: MailFlowBindings, origin = textEnv(bindings.PUBLIC_ORIGIN)) {
  const clientId = textEnv(bindings.GOOGLE_CLIENT_ID);
  const clientSecret = textEnv(bindings.GOOGLE_CLIENT_SECRET);
  const stateSecret = textEnv(bindings.SESSION_SECRET);
  const tokenEncryptionSecret = textEnv(bindings.TOKEN_ENCRYPTION_KEY_B64);
  if (!clientId || !clientSecret || !stateSecret || !tokenEncryptionSecret) throw new Error("Google sign-in is not configured");
  const secure = new URL(origin).protocol === "https:";
  return new GoogleAuthService({ clientId, clientSecret, redirectUri: new URL("/auth/google/callback", origin).toString() }, {
    ...createD1AuthStores(bindings.DB), stateSecret, tokenEncryptionSecret, secureCookies: secure,
    sessionCookie: { secure, sameSite: "Lax", path: "/" }, sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
  });
}

export function accountPace(bindings: MailFlowBindings, provider?: string, requested?: number) {
  return provider === "google" ? integerEnv(String(requested ?? bindings.GMAIL_PACE_PER_MINUTE ?? 3), 3, 1, 6)
    : requested ?? integerEnv(bindings.DEFAULT_CAMPAIGN_PACE, 12, 1, 600);
}

export function accountMailAuthorization(bindings: MailFlowBindings, provider?: string, origin?: string) {
  return provider === "google" ? googleAuthFor(bindings, origin) : createMailFlowServices(bindings, origin).auth;
}

export async function accountMailProvider(bindings: MailFlowBindings, campaign: Pick<CampaignRecord, "ownerUserId" | "senderAddress" | "provider">, origin?: string) {
  const owner = await createD1Repositories(bindings.DB).users.getById(campaign.ownerUserId);
  if (!owner || (owner.provider ?? "microsoft") !== (campaign.provider ?? "microsoft") || owner.mailboxAddress !== campaign.senderAddress) throw new Error("Sending account does not match campaign snapshot");
  if (campaign.provider === "google") {
    const auth = googleAuthFor(bindings, origin);
    return gmailMailProvider(async () => (await auth.refreshUserAccessToken(owner.id)).accessToken, campaign.senderAddress);
  }
  const services = createMailFlowServices(bindings, origin);
  const token = async () => (await services.auth.refreshUserAccessToken(owner.id)).accessToken;
  return services.mailTransport === "smtp" ? delegatedSmtpMailProvider(services.smtp, token, campaign.senderAddress)
    : delegatedGraphMailProvider(services.graph, token);
}

export function accountAttachmentService(bindings: MailFlowBindings, repo = createD1Repositories(bindings.DB), origin?: string) {
  const storeFor = async (ownerId: string): Promise<AttachmentObjectStore> => {
    const owner = await repo.users.getById(ownerId);
    if (!owner) throw new Error("Attachment owner is unavailable");
    if (owner.provider === "google") {
      const auth = googleAuthFor(bindings, origin);
      return new GoogleAppDataAttachmentStore(async id => (await auth.refreshUserAccessToken(id, DRIVE_SCOPE)).accessToken);
    }
    if (resolveMailTransport(bindings.MAIL_TRANSPORT) !== "smtp") {
      throw new AttachmentError("service_unavailable", "Microsoft attachment campaigns require SMTP delivery", { transient: true });
    }
    const services = createMailFlowServices(bindings, origin);
    return new OneDriveAppFolderAttachmentStore(async id => (await services.storageAuth.refreshUserAccessToken(id)).accessToken);
  };
  return createAttachmentService(repo.attachments, {
    put: async (owner, key, value, options) => (await storeFor(owner)).put(owner, key, value, options),
    get: async (owner, key) => (await storeFor(owner)).get(owner, key),
    delete: async (owner, key) => (await storeFor(owner)).delete(owner, key),
    list: async (owner, options) => (await storeFor(owner)).list(owner, options),
  }, { objectKey: (setId, fileId) => attachmentObjectKey(attachmentObjectNamespace(bindings.ATTACHMENT_OBJECT_NAMESPACE), setId, fileId) });
}

export function textEnv(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

export function integerEnv(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function attachmentObjectNamespace(value: string | undefined): string {
  const namespace = textEnv(value);
  if (!namespace) return "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u.test(namespace)) {
    throw new Error("ATTACHMENT_OBJECT_NAMESPACE must be a lowercase alphanumeric label");
  }
  return namespace;
}

export function attachmentObjectKey(namespace: string, attachmentSetId: string, fileId: string): string {
  const segment = namespace ? `-${namespace}` : "";
  return `mailflow-${attachmentSetId}${segment}-${fileId}.bin`;
}

export function repositories(context: MailFlowContext): Repositories {
  return createD1Repositories(context.env.DB, integerEnv(context.env.GMAIL_RECIPIENT_BUDGET, 100, 1, 200));
}

export function applicationOrigin(context: MailFlowContext): string {
  const requestUrl = new URL(context.req.url);
  if (["localhost", "127.0.0.1", "::1"].includes(requestUrl.hostname)) return requestUrl.origin;
  const configured = textEnv(context.env.PUBLIC_ORIGIN);
  if (!configured) return requestUrl.origin;
  try {
    return new URL(configured).origin;
  } catch {
    return requestUrl.origin;
  }
}

export interface MailFlowServices {
  graph: GraphMailProvider;
  smtp: ExchangeOnlineSmtpClient;
  auth: MicrosoftAuthService;
  storageAuth: MicrosoftAuthService;
  mailTransport: MailTransport;
}

/**
 * Build the request-scoped Microsoft clients and auth services.  The
 * service construction remains here so every route and background handler
 * uses the same transport and resource-specific OAuth configuration.
 */
export function configFor(context: MailFlowContext, redirectOrigin?: string): MailFlowServices {
  return createMailFlowServices(context.env, redirectOrigin ?? applicationOrigin(context), new URL(context.req.url).protocol === "https:");
}

export function createMailFlowServices(bindings: MailFlowBindings, origin = textEnv(bindings.PUBLIC_ORIGIN), secureCookies = true): MailFlowServices {
  const tenantId = textEnv(bindings.ENTRA_TENANT_ID);
  const clientId = textEnv(bindings.ENTRA_CLIENT_ID);
  const clientSecret = textEnv(bindings.ENTRA_CLIENT_SECRET);
  const tokenSecret = textEnv(bindings.TOKEN_ENCRYPTION_KEY_B64);
  const sessionSecret = textEnv(bindings.SESSION_SECRET);
  if (!tenantId || !clientId || !clientSecret || !tokenSecret || !sessionSecret) throw new Error("Microsoft sign-in is not configured on this Worker");

  const redirectUri = new URL("/auth/microsoft/callback", origin).toString();
  const mailTransport = resolveMailTransport(bindings.MAIL_TRANSPORT);
  const config = {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    ...(mailTransport === "smtp" ? { scopes: SMTP_ENTRA_SCOPES } : {}),
  };
  const graph = new GraphMailProvider({ requestTimeoutMs: 30_000 });
  const smtp = new ExchangeOnlineSmtpClient({ timeoutMs: 30_000 });
  const stores = createD1AuthStores(bindings.DB);
  const auth = new MicrosoftAuthService(config, mailTransport === "graph" ? graph : null, {
    userStore: stores.userStore,
    sessionStore: stores.sessionStore,
    tokenStore: stores.tokenStore,
    stateStore: stores.stateStore,
    stateSecret: sessionSecret,
    tokenEncryptionSecret: tokenSecret,
    secureCookies,
    sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    sessionCookie: { secure: secureCookies, sameSite: "Lax", path: "/" },
  });
  const storageAuth = new MicrosoftAuthService({
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    scopes: ONEDRIVE_ENTRA_SCOPES,
  }, null, {
    userStore: stores.userStore,
    sessionStore: stores.sessionStore,
    tokenStore: stores.tokenStore,
    stateStore: stores.stateStore,
    stateSecret: sessionSecret,
    tokenEncryptionSecret: tokenSecret,
    secureCookies,
    sessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
    sessionCookie: { secure: secureCookies, sameSite: "Lax", path: "/" },
  });
  return { graph, smtp, auth, storageAuth, mailTransport };
}

export function attachmentServiceFor(context: MailFlowContext, repo = repositories(context)): AttachmentService | null {
  if (context.get("user")?.provider === "google") return accountAttachmentService(context.env, repo, applicationOrigin(context));
  if (resolveMailTransport(context.env.MAIL_TRANSPORT) !== "smtp") return null;
  const { storageAuth } = configFor(context);
  const objectNamespace = attachmentObjectNamespace(context.env.ATTACHMENT_OBJECT_NAMESPACE);
  return createAttachmentService(
    repo.attachments,
    new OneDriveAppFolderAttachmentStore(async (ownerUserId) => {
      try {
        return (await storageAuth.refreshUserAccessToken(ownerUserId)).accessToken;
      } catch (error) {
        console.warn("OneDrive token refresh failed", {
          classification: safeErrorKind(error),
        });
        throw error;
      }
    }),
    {
      objectKey: (attachmentSetId, fileId) => attachmentObjectKey(objectNamespace, attachmentSetId, fileId),
    },
  );
}

export function attachmentInfrastructureAvailable(context: MailFlowContext): boolean {
  if (context.get("user")?.provider === "google") return Boolean(context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET);
  return resolveMailTransport(context.env.MAIL_TRANSPORT) === "smtp";
}

async function googleScopeFor(context: MailFlowContext, userId: string, scope: string) {
  const token = await createD1AuthStores(context.env.DB).tokenStore.findByUserId(userId, "google");
  return Boolean(token?.grantedScopes.includes(scope));
}

export function hasSmtpSendScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.trim().toLowerCase();
    return normalized === "smtp.send" || normalized.endsWith("/smtp.send");
  });
}

export async function smtpAuthorizedFor(context: MailFlowContext, userId: string): Promise<boolean> {
  if (context.get("user")?.provider === "google") return googleScopeFor(context, userId, GMAIL_SCOPE);
  if (resolveMailTransport(context.env.MAIL_TRANSPORT) !== "smtp") return false;
  const token = await createD1AuthStores(context.env.DB).tokenStore.findByUserId(userId, "smtp");
  return Boolean(token && hasSmtpSendScope(token.grantedScopes));
}

export function hasOneDriveAppFolderScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.trim().toLowerCase();
    return normalized === "files.readwrite.appfolder" || normalized.endsWith("/files.readwrite.appfolder");
  });
}

export async function oneDriveAuthorizedFor(context: MailFlowContext, userId: string): Promise<boolean> {
  if (context.get("user")?.provider === "google") return googleScopeFor(context, userId, DRIVE_SCOPE);
  const token = await createD1AuthStores(context.env.DB).tokenStore.findByUserId(userId, "onedrive");
  return Boolean(token && hasOneDriveAppFolderScope(token.grantedScopes));
}
