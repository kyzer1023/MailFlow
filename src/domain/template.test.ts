import { describe, expect, it } from "vitest";
import { escapeHtml, missingTemplateValues, renderHtmlTemplate, renderSubjectTemplate } from "./template";

describe("template contracts", () => {
  it("escapes spreadsheet values in HTML while preserving template markup", () => {
    expect(renderHtmlTemplate("<p>Hello {{name}}</p>", { name: "<script>alert(1)</script>" })).toBe(
      "<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(escapeHtml("&\"'")) .toBe("&amp;&quot;&#39;");
  });

  it("removes subject line breaks and reports missing values", () => {
    expect(renderSubjectTemplate("Hello {{name}}", { name: "A\nB" })).toBe("Hello A B");
    expect(missingTemplateValues("{{name}} {{missing}}", { name: "A" })).toEqual(["missing"]);
  });
});

