import { describe, expect, it, vi } from "vitest";
import worker from "../../../worker/index.ts";
import type { MailFlowBindings } from "./contracts";

function bindings(calls: string[]): MailFlowBindings {
  return {
    DB: {} as MailFlowBindings["DB"],
    CAMPAIGN_QUEUE: {} as MailFlowBindings["CAMPAIGN_QUEUE"],
    ASSETS: {
      async fetch(input: RequestInfo | URL): Promise<Response> {
        const url = input instanceof Request ? new URL(input.url) : new URL(input.toString());
        calls.push(url.pathname + url.search);
        return new Response(url.pathname === "/index.html" ? "app" : "missing", { status: url.pathname === "/index.html" ? 200 : 404 });
      },
    },
  };
}

describe("Cloudflare Worker static routing", () => {
  it("records private-safe API diagnostics with a response correlation ID", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = bindings([]);
      env.DB = { batch: async () => [], prepare() { throw Object.assign(new TypeError("private-token recipient@example.test body OneDrive-locator"), { name: "private-name", code: "private-code", stack: "private-stack" }); } };
      const response = await worker.fetch(new Request("https://mailflow.example/api/campaigns/private-campaign?secret=private-query", { headers: { Cookie: `mailflow_session=${"s".repeat(43)}` } }), env, { waitUntil() {} });
      expect(response.status).toBe(500);
      const requestId = response.headers.get("X-MailFlow-Request-Id");
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(logged).toHaveBeenCalledWith("mailflow.api.failure", { requestId, route: "campaigns", stage: "request_handler", classification: "type_error", elapsedMs: expect.any(Number) });
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(/private-|recipient@|OneDrive|stack|secret=/u);
      expect(await response.json()).toEqual({ error: { code: "internal_error", message: "Mail Flow could not complete that request. Try again." } });
    } finally { logged.mockRestore(); }
  });
  it("serves the SPA shell for an unknown document route", async () => {
    const calls: string[] = [];
    const response = await worker.fetch(new Request("https://mailflow.example/flows/new/data?source=upload", { headers: { accept: "text/html" } }), bindings(calls), { waitUntil() {} });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["/flows/new/data?source=upload", "/index.html"]);
  });

  it("does not turn unknown API or write requests into the app shell", async () => {
    const apiCalls: string[] = [];
    const apiResponse = await worker.fetch(new Request("https://mailflow.example/api/missing", { headers: { accept: "text/html" } }), bindings(apiCalls), { waitUntil() {} });
    expect(apiResponse.status).toBe(404);
    expect(apiResponse.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(apiCalls).toEqual([]);

    const writeCalls: string[] = [];
    const writeResponse = await worker.fetch(new Request("https://mailflow.example/flows/new/data", { method: "POST", headers: { accept: "text/html" } }), bindings(writeCalls), { waitUntil() {} });
    expect(writeResponse.status).toBe(404);
    expect(writeCalls).toEqual(["/flows/new/data"]);
  });
});
