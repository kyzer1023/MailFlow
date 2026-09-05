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
    "font",
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
    "mark",
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
    "bgcolor",
    "cellpadding",
    "cellspacing",
    "class",
    "colspan",
    "color",
    "dir",
    "face",
    "height",
    "href",
    "rel",
    "role",
    "rowspan",
    "size",
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

function parseLegacyPixelValue(value: string | null): number | null {
  if (!value || !/^\d{1,4}$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert legacy table presentation attributes into inline CSS before
 * sanitization. Email HTML still commonly uses border/cellpadding/cellspacing,
 * but DOMPurify removes those obsolete attributes even when they are named in
 * ALLOWED_ATTR. Inline equivalents also render more consistently in the
 * contenteditable editor and in mail clients.
 */
function normalizeLegacyTablePresentation(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const border = parseLegacyPixelValue(table.getAttribute("border"));
    const cellPadding = parseLegacyPixelValue(table.getAttribute("cellpadding"));
    const cellSpacing = parseLegacyPixelValue(table.getAttribute("cellspacing"));
    const cells = [...table.querySelectorAll<HTMLTableCellElement>("td, th")]
      .filter((cell) => cell.closest("table") === table);

    if (border !== null && border > 0) {
      if (!table.style.border) table.style.border = `${border}px solid`;
      cells.forEach((cell) => {
        if (!cell.style.border && !cell.style.borderWidth) cell.style.border = `${border}px solid`;
      });
    }

    if (cellSpacing !== null && !table.style.borderSpacing) {
      table.style.borderSpacing = `${cellSpacing}px`;
    }

    if (cellPadding !== null) {
      const padding = `${cellPadding}px`;
      cells.forEach((cell) => {
        if (!cell.style.paddingTop) cell.style.paddingTop = padding;
        if (!cell.style.paddingRight) cell.style.paddingRight = padding;
        if (!cell.style.paddingBottom) cell.style.paddingBottom = padding;
        if (!cell.style.paddingLeft) cell.style.paddingLeft = padding;
      });
    }
  });

  return template.innerHTML;
}

/**
 * Sanitize user-authored template HTML. This function fails closed when it is
 * accidentally called outside a DOM-capable browser, rather than returning
 * untrusted markup as if it were safe.
 */
export function sanitizeTemplateHtml(html: string): string {
  if (!DOMPurify.isSupported) return "";
  const normalized = normalizeLegacyTablePresentation(html);
  const sanitized = DOMPurify.sanitize(normalized, TEMPLATE_SANITIZATION_POLICY);
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  // Keep the browser preview aligned with the Worker boundary. The Worker
  // rejects every CSS url(), escape, import, expression, or legacy binding,
  // so remove the entire affected declaration block before preview or save.
  const unsafeCss = /(?:expression\s*\(|url\s*\(|\\|@import|-moz-binding|behavior\s*:)/iu;
  template.content.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    if (unsafeCss.test(element.getAttribute("style") ?? "")) element.removeAttribute("style");
  });
  return template.innerHTML;
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
    const sourceField = fieldMappings && Object.hasOwn(fieldMappings, placeholder) ? fieldMappings[placeholder] : placeholder;
    const value = Object.hasOwn(values, sourceField) ? values[sourceField] : undefined;
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
