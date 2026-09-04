import { extractPlaceholders } from "./validation";

export type TemplateValues = Readonly<Record<string, unknown>>;

/** Escape spreadsheet values before placing them in an HTML message. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Render a subject as plain text, removing line breaks that could forge headers. */
export function renderSubjectTemplate(template: string, values: TemplateValues): string {
  return renderTemplate(template, values, (value) => String(value ?? "").replace(/[\r\n]+/gu, " "));
}

/** Render an HTML body with escaped values. Template HTML itself must be sanitized separately. */
export function renderHtmlTemplate(template: string, values: TemplateValues): string {
  return renderTemplate(template, values, escapeHtml);
}

export function renderTemplate(
  template: string,
  values: TemplateValues,
  escapeValue: (value: unknown) => string = escapeHtml,
): string {
  return template.replace(/\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu, (_match, key: string) => {
    return escapeValue(Object.hasOwn(values, key) ? values[key] : "");
  });
}

export function missingTemplateValues(template: string, values: TemplateValues): string[] {
  return extractPlaceholders(template, "").filter((key) => !Object.hasOwn(values, key) || values[key] === undefined || values[key] === null || String(values[key]).trim() === "");
}

