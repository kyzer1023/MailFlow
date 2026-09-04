// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { boundedMultipartForm, RequestBodyTooLarge } from "./request-body";
import { parseOrError } from "./helpers";
import type { MailFlowContext } from "./context";

describe("request stream limits", () => {
  it("bounds non-campaign JSON before schema parsing, including missing or misleading length", async () => {
    for (const length of [undefined, "1", "3000000"]) {
      const request = new Request("https://example.test/api/flows", {
        method: "POST", headers: length ? { "Content-Length": length } : {},
        body: JSON.stringify({ value: "x".repeat(2 * 1024 * 1024) }),
      });
      const context = { req: { raw: request, header: (name: string) => request.headers.get(name) }, json: (value: unknown, status: number) => Response.json(value, { status }) } as unknown as MailFlowContext;
      const safeParse = vi.fn(() => ({ success: true as const, data: {} }));
      const result = await parseOrError(context, { safeParse });
      expect((result as Response).status).toBe(413);
      expect(safeParse).not.toHaveBeenCalled();
    }
  });
  it("accepts a bounded multipart file and rejects oversize streams without trusting Content-Length", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    const request = new Request("https://example.test/api/attachments", { method: "POST", body: form });
    expect((await boundedMultipartForm(request.clone(), 1024)).get("file")).toMatchObject({ name: "notes.txt", size: 5 });
    await expect(boundedMultipartForm(request.clone(), 4)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    const misleading = new Request(request.clone(), { headers: { ...Object.fromEntries(request.headers), "Content-Length": "1" } });
    await expect(boundedMultipartForm(misleading, 4)).rejects.toBeInstanceOf(RequestBodyTooLarge);
  });
});
