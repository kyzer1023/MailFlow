import { escapeMergeValue, sanitizeTemplateHtml } from "../../client/template";
import type { DynamicFieldOption } from "../state/types";

export function bodyHtmlFromDraft(body: unknown): string {
  const source = String(body || "");
  if (/<[a-z][^>]*>/iu.test(source)) return source;
  return source
    .split(/\r?\n/u)
    // DOMPurify serializes void elements as `<br>`. Keep generated drafts in
    // that same canonical form so a harmless blank line is not reported as
    // an unsafe-template change during Review validation.
    .map((line) => line ? `<p>${escapeMergeValue(line)}</p>` : "<br>")
    .join("");
}

export function normalizeHtmlForComparison(html: unknown): string {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  return template.innerHTML.trim();
}

export function dynamicFieldLabel(key: string | null | undefined, options: readonly DynamicFieldOption[] = []): string {
  const match = options.find((option) => option.value === key);
  return match?.label || String(key || "").replace(/_/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function serializeTokenEditor(root: HTMLElement | null): string {
  if (!root) return "";
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-dynamic-field]").forEach((element) => {
    const field = (element as HTMLElement).dataset.dynamicField;
    element.replaceWith(document.createTextNode(`{{${field}}}`));
  });
  return clone.innerHTML;
}

export function appendTokenEditorContent(
  root: HTMLElement,
  value: unknown,
  options: readonly DynamicFieldOption[] = [],
): void {
  const safeHtml = sanitizeTemplateHtml(bodyHtmlFromDraft(value));
  root.innerHTML = safeHtml;
  const pattern = /\{\{\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*\}\}/gu;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach((node) => {
    const source = node.nodeValue || "";
    pattern.lastIndex = 0;
    if (!pattern.test(source)) return;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
      const matchIndex = match.index ?? cursor;
      if (matchIndex > cursor) fragment.append(document.createTextNode(source.slice(cursor, matchIndex)));
      const token = document.createElement("span");
      token.className = "dynamic-inline-token";
      token.contentEditable = "false";
      token.dataset.dynamicField = match[1];
      token.setAttribute("aria-label", `Dynamic value: ${dynamicFieldLabel(match[1], options)}`);
      token.textContent = dynamicFieldLabel(match[1], options);
      fragment.append(token);
      cursor = matchIndex + match[0].length;
    }
    if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
  });
}
