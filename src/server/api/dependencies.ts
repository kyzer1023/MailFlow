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
  createAttachmentService,
  OneDriveAppFolderAttachmentStore,
  type AttachmentService,
} from "../attachments";
import type { MailFlowContext } from "./context";
import type { MailFlowBindings } from "./contracts";
import { safeErrorKind } from "../diagnostics";

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
  return createD1Repositories(context.env.DB);
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
  return resolveMailTransport(context.env.MAIL_TRANSPORT) === "smtp";
}

export function hasSmtpSendScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.trim().toLowerCase();
    return normalized === "smtp.send" || normalized.endsWith("/smtp.send");
  });
}

export async function smtpAuthorizedFor(context: MailFlowContext, userId: string): Promise<boolean> {
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
  const token = await createD1AuthStores(context.env.DB).tokenStore.findByUserId(userId, "onedrive");
  return Boolean(token && hasOneDriveAppFolderScope(token.grantedScopes));
}
