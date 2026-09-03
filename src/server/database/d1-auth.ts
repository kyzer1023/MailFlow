import type { D1Database } from "./contracts";
import { D1AuthSessionStore } from "./d1-auth-sessions";
import { D1OAuthStateStore } from "./d1-auth-state";
import { D1AuthTokenStore } from "./d1-auth-tokens";
import { D1AuthUserStore } from "./d1-auth-users";

export { D1AuthSessionStore } from "./d1-auth-sessions";
export { D1OAuthStateStore } from "./d1-auth-state";
export { D1AuthTokenStore } from "./d1-auth-tokens";
export { D1AuthUserStore } from "./d1-auth-users";

export interface D1AuthStores {
  userStore: D1AuthUserStore;
  tokenStore: D1AuthTokenStore;
  sessionStore: D1AuthSessionStore;
  stateStore: D1OAuthStateStore;
}

export function createD1AuthStores(db: D1Database, now: () => number = Date.now): D1AuthStores {
  return {
    userStore: new D1AuthUserStore(db),
    tokenStore: new D1AuthTokenStore(db),
    sessionStore: new D1AuthSessionStore(db),
    stateStore: new D1OAuthStateStore(db, now),
  };
}
