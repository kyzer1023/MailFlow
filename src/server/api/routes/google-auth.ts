import type { Hono } from "hono";
import type { MailFlowAppEnv } from "../context";
import { googleAuthFor, applicationOrigin } from "../dependencies";
import { csrfTokenFor, requireSession, responseError } from "../helpers";
import { consumeOAuthStartLimit } from "../public-rate-limits";
import { createD1PublicControlStore } from "../../database/d1-public-controls";
import { clearOAuthStateCookie } from "../../auth/oauth-state";
import { parseCookie, SESSION_COOKIE_NAME, revokeSession } from "../../auth/session";
import { createD1AuthStores } from "../../database/d1-auth";

export function registerGoogleAuthRoutes(app: Hono<MailFlowAppEnv>) {
  app.get("/auth/google/start", async context => {
    try {
      const secret = context.env.SESSION_SECRET;
      if (!secret) throw new Error("Missing sign-in configuration");
      const decision = await consumeOAuthStartLimit(createD1PublicControlStore(context.env.DB), secret, context.req.header("CF-Connecting-IP") ?? "unknown");
      if (!decision.allowed) { context.header("Retry-After", String(decision.retryAfterSeconds)); return responseError(context, 429, "oauth_start_rate_limited", "Wait a few minutes before signing in again."); }
      const current = parseCookie(context.req.header("Cookie"), SESSION_COOKIE_NAME) ? await requireSession(context) : null;
      const user = current && !(current instanceof Response) ? current.user : undefined;
      if (user && user.provider !== "google") return responseError(context, 409, "separate_accounts", "Sign out before signing in with Google. Provider accounts remain separate.");
      const started = await googleAuthFor(context.env, applicationOrigin(context)).beginSignIn(new URL(context.req.url).searchParams.get("returnTo") ?? "/dashboard", user);
      context.header("Set-Cookie", started.stateCookie, { append: true });
      return context.redirect(started.authorizationUrl, 302);
    } catch { return responseError(context, 503, "google_auth_unavailable", "Google sign-in is not configured or is temporarily unavailable."); }
  });
  app.get("/auth/google/callback", async context => {
    const parameters = new URL(context.req.url).searchParams;
    const state = parameters.get("state") ?? "";
    const cookieHeader = context.req.header("Cookie");
    try {
      const auth = googleAuthFor(context.env, applicationOrigin(context));
      if (parameters.has("error")) {
        const consumed = await auth.consume({ state, cookieHeader });
        context.header("Set-Cookie", clearOAuthStateCookie(new URL(context.req.url).protocol === "https:"), { append: true });
        return context.redirect(state.startsWith("google-reconnect:") ? `${consumed.returnTo}${consumed.returnTo.includes("?") ? "&" : "?"}google=cancelled` : "/?auth=cancelled", 302);
      }
      if (!parameters.get("code")) throw new Error("Missing authorization code");
      const current = parseCookie(cookieHeader, SESSION_COOKIE_NAME) ? await requireSession(context) : null;
      const user = current && !(current instanceof Response) ? current.user : undefined;
      const completed = await auth.completeSignIn({ state, code: parameters.get("code")!, cookieHeader }, user);
      if (current && !(current instanceof Response)) await revokeSession(createD1AuthStores(context.env.DB).sessionStore, current.sessionToken);
      context.header("Set-Cookie", completed.sessionCookie, { append: true });
      context.header("Set-Cookie", completed.stateCookie, { append: true });
      await csrfTokenFor(context, completed.sessionToken);
      return context.redirect(completed.returnTo, 302);
    } catch {
      context.header("Set-Cookie", clearOAuthStateCookie(new URL(context.req.url).protocol === "https:"), { append: true });
      return context.redirect(state.startsWith("google-reconnect:") ? "/dashboard?google=failed" : "/?auth=failed", 302);
    }
  });
}
