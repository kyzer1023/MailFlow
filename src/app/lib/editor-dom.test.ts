import { describe, expect, it } from "vitest";
import { looksLikeHtmlMarkup } from "./editor-dom";

describe("looksLikeHtmlMarkup", () => {
  it("recognizes authored email HTML and ignores ordinary prose", () => {
    expect(looksLikeHtmlMarkup('<table><tr><td>Hello</td></tr></table>')).toBe(true);
    expect(looksLikeHtmlMarkup('<div style="margin:0">Disclaimer</div>')).toBe(true);
    expect(looksLikeHtmlMarkup("<p>Hello</p>")).toBe(true);
    expect(looksLikeHtmlMarkup("Please use <name> on the form.")).toBe(false);
    expect(looksLikeHtmlMarkup("Meet at Room 101.")).toBe(false);
  });
});
