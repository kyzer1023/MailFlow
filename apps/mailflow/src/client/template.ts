import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";

export const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu;

/**
 * Deliberately narrow email HTML policy. Inline styles are retained for
 * practical email templates, while scripting, embeds, forms, SVG/MathML,
 * frames, and protocol-relative or data URLs are excluded.
 */
export const TEMPLATE_SANITIZATION_POLICY: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "col",
    "colgroup",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
  ],
  ALLOWED_ATTR: [
    "align",
    "alt",
    "border",
    "cellpadding",
    "cellspacing",
    "class",
    "colspan",
    "color",
    "height",
    "href",
    "rel",
    "role",
    "rowspan",
    "src",
    "style",
    "target",
    "title",
    "valign",
    "width",
  ],
  FORBID_TAGS: ["base", "embed", "form", "iframe", "input", "link", "meta", "object", "script", "select", "style", "svg", "template", "textarea", "video"],
  FORBID_ATTR: ["formaction", "srcdoc", "xlink:href"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  SAFE_FOR_XML: true,
  SAFE_FOR_TEMPLATES: false,
  RETURN_TRUSTED_TYPE: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/iu,
} as const;

export interface TemplateRenderResult {
  readonly subject: string;
  readonly bodyHtml: string;
  readonly missingPlaceholders: readonly string[];
}

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Escape a spreadsheet value before it enters HTML. */
export const escapeMergeValue = escapeHtmlValue;

/**
 * Sanitize user-authored template HTML. This function fails closed when it is
 * accidentally called outside a DOM-capable browser, rather than returning
 * untrusted markup as if it were safe.
 */
export function sanitizeTemplateHtml(html: string): string {
  if (!DOMPurify.isSupported) return "";
  return DOMPurify.sanitize(html, TEMPLATE_SANITIZATION_POLICY);
}

function renderString(
  template: string,
  values: Readonly<Record<string, string>>,
  fieldMappings: Readonly<Record<string, string>> | undefined,
  escapeValues: boolean,
  missing: Set<string>,
): string {
  TEMPLATE_PLACEHOLDER_PATTERN.lastIndex = 0;
  return template.replace(TEMPLATE_PLACEHOLDER_PATTERN, (_token, placeholder: string) => {
    const sourceField = fieldMappings?.[placeholder] ?? placeholder;
    const value = values[sourceField];
    if (value === undefined || value === null) {
      missing.add(placeholder);
      return "";
    }
    return escapeValues ? escapeHtmlValue(String(value)) : String(value);
  });
}

export interface RenderTemplateOptions {
  readonly fieldMappings?: Readonly<Record<string, string>>;
  /** Defaults to true. Set false only for a trusted, non-HTML channel. */
  readonly sanitizeBody?: boolean;
}

/** Resolve placeholders once, escaping values before inserting into HTML. */
export function renderTemplate(
  subjectTemplate: string,
  bodyHtmlTemplate: string,
  values: Readonly<Record<string, string>>,
  options: RenderTemplateOptions = {},
): TemplateRenderResult {
  const missing = new Set<string>();
  const subject = renderString(subjectTemplate, values, options.fieldMappings, false, missing);
  const sanitizedBody = options.sanitizeBody === false ? bodyHtmlTemplate : sanitizeTemplateHtml(bodyHtmlTemplate);
  const mergedBody = renderString(sanitizedBody, values, options.fieldMappings, true, missing);
  // Sanitizing after merge prevents a malformed template/value interaction from
  // reintroducing markup and keeps the function safe if its policy evolves.
  const bodyHtml = options.sanitizeBody === false ? mergedBody : sanitizeTemplateHtml(mergedBody);
  return {
    subject,
    bodyHtml,
    missingPlaceholders: [...missing].sort((left, right) => left.localeCompare(right)),
  };
}

/** Build a restrictive srcDoc for the isolated preview iframe. */
export function buildPreviewSrcDoc(bodyHtml: string): string {
  const safeBody = sanitizeTemplateHtml(bodyHtml);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline';"><style>body{margin:24px;font-family:Arial,sans-serif;color:#17211f;background:#fff}img{max-width:100%;height:auto}</style></head><body>${safeBody}</body></html>`;
}
