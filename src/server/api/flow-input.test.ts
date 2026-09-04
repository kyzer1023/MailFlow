import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { MailFlowAppEnv } from "./context";
import { registerFlowRoutes } from "./routes/flows";

vi.mock("./dependencies", () => ({ repositories: () => ({ flows: { getByIdForOwner: async () => ({ id: "flow-1", ownerUserId: "user-1" }) } }) }));
vi.mock("./helpers", async (importOriginal) => ({
  ...await importOriginal<typeof import("./helpers")>(),
  requireMutationSession: async () => ({ user: { id: "user-1" } }),
  createTemplateVersion: async () => { throw new Error("D1_ERROR private database diagnostic"); },
}));

describe("template persistence errors", () => {
  it("does not return internal database diagnostics to the browser", async () => {
    const app = new Hono<MailFlowAppEnv>();
    registerFlowRoutes(app);
    const response = await app.request("https://example.test/api/flows/flow-1/versions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectTemplate: "Hello", bodyHtml: "<p>Hello</p>", recipientConfiguration: { toField: "email" } }),
    });
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain("The template could not be saved. Try again shortly.");
    expect(text).not.toContain("D1_ERROR");
    expect(text).not.toContain("private database diagnostic");
  });
});
