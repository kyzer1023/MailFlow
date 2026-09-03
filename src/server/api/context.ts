import type { Context } from "hono";
import type { MailFlowBindings, MailFlowVariables } from "./contracts";

/**
 * Hono's typed environment for the Mail Flow API.  Keeping this alias in a
 * small module gives route code one stable import without coupling the
 * application context to a particular route group.
 */
export type MailFlowAppEnv = {
  Bindings: MailFlowBindings;
  Variables: MailFlowVariables;
};

export type MailFlowContext = Context<MailFlowAppEnv>;

export type AuthenticatedSession = {
  user: MailFlowVariables["user"];
  sessionToken: string;
  csrfToken: string;
};
