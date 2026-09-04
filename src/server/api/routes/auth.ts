import type { Hono } from "hono";
import {
  CSRF_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  revokeSession,
} from "../../auth/session";
import { createD1AuthStores } from "../../database/d1-auth";
import { createD1PublicControlStore } from "../../database/d1-public-controls";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
} from "../../attachments";
import { resolveMailTransport } from "../../microsoft";
import type { MailFlowAppEnv } from "../context";
import {
  attachmentInfrastructureAvailable,
  configFor,
  integerEnv,
  oneDriveAuthorizedFor,
  smtpAuthorizedFor,
} from "../dependencies";
import {
  csrfTokenFor,
  publicUser,
  requireMutationSession,
  requireSession,
  responseError,
} from "../helpers";
import { consumeOAuthStartLimit } from "../public-rate-limits";

/** Register Microsoft authentication, session, and current-user routes. */
export function registerAuthRoutes(app: Hono<MailFlowAppEnv>): void {
  app.get("/auth/microsoft/start", async (context) => {
    try {
      const rateLimitSecret = context.env.SESSION_SECRET?.trim();
      if (!rateLimitSecret) throw new Error("Microsoft sign-in is not configured on this Worker");
      const decision = await consumeOAuthStartLimit(
        createD1PublicControlStore(context.env.DB),
        rateLimitSecret,
        context.req.header("CF-Connecting-IP") ?? "unknown",
      );
      if (!decision.allowed) {
        context.header("Retry-After", String(decision.retryAfterSeconds));
        return responseError(context, 429, "oauth_start_rate_limited", "Too many sign-in attempts were started. Wait a few minutes, then try again.");
      }
      const returnTo = new URL(context.req.url).searchParams.get("returnTo") ?? "/dashboard";
      const { auth } = configFor(context);
      const started = await auth.beginSignIn(returnTo);
      context.header("Set-Cookie", started.stateCookie);
      return context.redirect(started.authorizationUrl, 302);
    } catch {
      return responseError(context, 503, "auth_unavailable", "Microsoft sign-in is not configured yet.");
    }
  });

  app.get("/auth/microsoft/callback", async (context) => {
    const query = new URL(context.req.url).searchParams;
    const error = query.get("error");
    const code = query.get("code");
    const state = query.get("state");
    const isOneDriveConsent = state?.startsWith("onedrive.") ?? false;
    if (isOneDriveConsent) {
      const authenticated = await requireSession(context);
      if (authenticated instanceof Response) return context.redirect("/?auth=session_expired", 302);
      if (error) return context.redirect("/flows/new/recipients?onedrive=cancelled", 302);
      if (!code || !state) return context.redirect("/flows/new/recipients?onedrive=invalid", 302);
      try {
        const { storageAuth } = configFor(context);
        const completed = await storageAuth.completeResourceConsent({ code, state, cookieHeader: context.req.header("Cookie") }, authenticated.user);
        context.header("Set-Cookie", completed.stateCookie, { append: true });
        return context.redirect(completed.returnTo, 302);
      } catch {
        return context.redirect("/flows/new/recipients?onedrive=failed", 302);
      }
    }
    if (error) return context.redirect("/?auth=cancelled", 302);
    if (!code || !state) return context.redirect("/?auth=invalid", 302);
    try {
      const { auth } = configFor(context);
      const completed = await auth.completeSignIn({ code, state, cookieHeader: context.req.header("Cookie") });
      context.header("Set-Cookie", completed.sessionCookie, { append: true });
      context.header("Set-Cookie", completed.stateCookie, { append: true });
      await csrfTokenFor(context, completed.sessionToken);
      return context.redirect(completed.returnTo, 302);
    } catch (errorValue) {
      void errorValue;
      return context.redirect("/?auth=failed", 302);
    }
  });

  app.get("/auth/microsoft/onedrive/start", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    try {
      const returnTo = new URL(context.req.url).searchParams.get("returnTo") ?? "/flows/new/recipients";
      const { storageAuth } = configFor(context);
      const started = await storageAuth.beginSignIn(returnTo, "onedrive");
      context.header("Set-Cookie", started.stateCookie);
      return context.redirect(started.authorizationUrl, 302);
    } catch {
      return responseError(context, 503, "onedrive_auth_unavailable", "OneDrive authorization is not configured yet.");
    }
  });

  app.post("/auth/logout", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    const stores = createD1AuthStores(context.env.DB);
    await revokeSession(stores.sessionStore, authenticated.sessionToken);
    context.header("Set-Cookie", clearCookie(SESSION_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
    context.header("Set-Cookie", clearCookie(CSRF_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
    context.header("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE_NAME, { secure: new URL(context.req.url).protocol === "https:", sameSite: "Lax", path: "/" }), { append: true });
    return context.json({ ok: true });
  });

  app.get("/api/me", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    const attachmentInfrastructure = attachmentInfrastructureAvailable(context);
    const smtpAuthorized = await smtpAuthorizedFor(context, authenticated.user.id);
    const oneDriveAuthorized = await oneDriveAuthorizedFor(context, authenticated.user.id);
    return context.json({
      user: publicUser(authenticated.user),
      csrfToken: authenticated.csrfToken,
      config: {
        defaultPacePerMinute: integerEnv(context.env.DEFAULT_CAMPAIGN_PACE, 12, 1, 600),
        maxCampaignRecipients: integerEnv(context.env.MAX_CAMPAIGN_RECIPIENTS, 300, 1, 300),
        mailTransport: resolveMailTransport(context.env.MAIL_TRANSPORT),
        attachmentsEnabled: attachmentInfrastructure && smtpAuthorized && oneDriveAuthorized,
        attachmentsReauthorizationRequired: attachmentInfrastructure && (!smtpAuthorized || !oneDriveAuthorized),
        attachmentsSmtpAuthorizationRequired: attachmentInfrastructure && !smtpAuthorized,
        attachmentsOneDriveAuthorizationRequired: attachmentInfrastructure && smtpAuthorized && !oneDriveAuthorized,
        maxAttachmentFiles: ATTACHMENT_MAX_FILES,
        maxAttachmentBytes: ATTACHMENT_MAX_BYTES,
      },
    });
  });
}
