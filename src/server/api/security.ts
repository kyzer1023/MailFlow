import { decodeHTML } from "entities";
import { extractPlaceholders } from "../../domain/validation";

/** Maximum template size accepted by API requests. */
export const MAX_TEMPLATE_HTML_LENGTH = 200_000;
export const MAX_TEMPLATE_SUBJECT_LENGTH = 998;

/**
 * Decode the character references that browsers resolve inside attribute
 * values before checking URL schemes. Multiple passes catch harmless-looking
 * double encoding such as `&amp;#x73;` without trying to rewrite the HTML.
 */
function canonicalizeHtmlForValidation(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeHTML(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  // URL parsers ignore ASCII controls and whitespace around schemes. Remove
  // them here so an encoded or split protocol cannot evade the deny-list.
  return decoded.replace(/[\u0000-\u0020\u007f-\u009f\s]+/gu, "");
}

/**
 * Worker-side template guard.  Browser-side DOMPurify remains the primary
 * editor sanitizer, but the Worker must not trust a browser request.  Workers
 * do not provide a DOM, so this boundary rejects dangerous markup and URL
 * protocols rather than attempting to rewrite arbitrary HTML with regexes.
 */
export function validateTemplateHtml(value: string): { ok: true; html: string } | { ok: false; message: string } {
  const html = value.trim();
  if (!html) return { ok: false, message: "A message body is required." };
  if (html.length > MAX_TEMPLATE_HTML_LENGTH) return { ok: false, message: "The message body is too large." };

  // Reject scripting, active document elements, event handlers, and unsafe
  // URL schemes.  This is intentionally fail-closed for the server boundary.
  const forbiddenTag = /<\/?(?:script|iframe|object|embed|form|svg|math|style|meta|link|base|input|textarea|select|video|audio|template)\b/iu;
  const eventHandler = /(?:\s|\/)on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu;
  const canonicalHtml = canonicalizeHtmlForValidation(html);
  const unsafeUrl = /(?:href|src|action|formaction|xlink:href)=["']?(?:javascript:|data:|vbscript:|\/\/)/iu;
  // Email templates do not need CSS URL fetches. Reject every inline url(),
  // CSS escape, legacy expression/binding, or import rather than attempting
  // to distinguish all browser and mail-client CSS parser edge cases.
  const unsafeCss = /style=["']?[^"'>]*(?:expression\(|url\(|\\|@import|-moz-binding|behavior:)/iu;
  if (forbiddenTag.test(html) || eventHandler.test(html) || unsafeUrl.test(canonicalHtml) || unsafeCss.test(canonicalHtml)) {
    return { ok: false, message: "The message contains HTML that is not allowed." };
  }
  return { ok: true, html };
}

export function validateTemplateSubject(value: string): { ok: true; subject: string } | { ok: false; message: string } {
  const subject = value.trim();
  if (!subject) return { ok: false, message: "A subject is required." };
  if (subject.length > MAX_TEMPLATE_SUBJECT_LENGTH) return { ok: false, message: "The subject is too long." };
  if (/[\u0000-\u001f\u007f]/u.test(subject)) return { ok: false, message: "The subject cannot contain line breaks." };
  return { ok: true, subject };
}

export function templatePlaceholders(subject: string, bodyHtml: string): readonly string[] {
  return extractPlaceholders(subject, bodyHtml);
}

/** Strip path components from uploaded names before persistence or display. */
export function safeSourceFilename(value: string | null | undefined): string | null {
  if (!value) return null;
  const name = value.trim().replace(/\\/gu, "/").split("/").pop()?.trim() ?? "";
  if (!name) return null;
  return name.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 255);
}
