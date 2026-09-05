import {
  Code,
  Eraser,
  HighlighterCircle,
  LinkSimple,
  ListBullets,
  ListNumbers,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  CheckCircle,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { escapeMergeValue, sanitizeTemplateHtml } from "../../../client/template";
import {
  appendTokenEditorContent,
  bodyHtmlFromDraft,
  dynamicFieldLabel,
  normalizeHtmlForComparison,
  serializeTokenEditor,
} from "../../lib/editor-dom";
import type { DynamicFieldOption } from "../../state/types";

export interface TokenMessageEditorHandle {
  readonly insertToken: (key: string) => void;
}

export interface TokenMessageEditorProps {
  readonly value: string | null | undefined;
  readonly onChange: (value: string) => void;
  readonly options?: readonly DynamicFieldOption[];
  readonly placeholder?: string;
  readonly onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  readonly missingFields?: readonly string[];
}

type EditorMode = "visual" | "html";

export const TokenMessageEditor = forwardRef<TokenMessageEditorHandle, TokenMessageEditorProps>(function TokenMessageEditor({ value, onChange, options, placeholder, onFocus, missingFields }, forwardedRef) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("visual");
  const sourceHtml = bodyHtmlFromDraft(value);
  const sanitizedSourceHtml = sanitizeTemplateHtml(sourceHtml);
  const sourceWasCleaned = normalizeHtmlForComparison(sourceHtml) !== normalizeHtmlForComparison(sanitizedSourceHtml);

  const saveRange = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || mode !== "visual") return;
    if (lastEmittedRef.current === String(value || "")) {
      lastEmittedRef.current = null;
      return;
    }
    if (serializeTokenEditor(root) !== sanitizedSourceHtml) appendTokenEditorContent(root, sanitizedSourceHtml, options);
  }, [value, options, mode, sanitizedSourceHtml]);

  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>("[data-dynamic-field]").forEach((token) => {
      const missing = Boolean(missingFields?.includes(token.dataset.dynamicField || ""));
      token.dataset.unconnected = String(missing);
      token.title = missing ? "Connect this value in the panel beside the message" : "";
    });
  }, [value, missingFields, mode]);

  const emitVisualChange = useCallback(() => {
    const html = serializeTokenEditor(rootRef.current);
    lastEmittedRef.current = html;
    onChange(html);
  }, [onChange]);

  const restoreRange = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection) return;
    const range = savedRangeRef.current?.cloneRange();
    if (range && root.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    const fallback = document.createRange();
    fallback.selectNodeContents(root);
    fallback.collapse(false);
    selection.removeAllRanges();
    selection.addRange(fallback);
  }, []);

  const runCommand = useCallback((command: string, commandValue: string | null = null) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    restoreRange();
    document.execCommand?.(command, false, commandValue as string);
    saveRange();
    emitVisualChange();
  }, [emitVisualChange, restoreRange, saveRange]);

  const insertHtml = useCallback((html: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    restoreRange();
    const insertedWithHistory = document.execCommand?.("insertHTML", false, html) ?? false;
    if (!insertedWithHistory) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        const fragment = range.createContextualFragment(html);
        const lastNode = fragment.lastChild;
        range.insertNode(fragment);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.collapse(true);
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    }
    saveRange();
    emitVisualChange();
  }, [emitVisualChange, restoreRange, saveRange]);

  const switchMode = useCallback((nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === "html") emitVisualChange();
    else {
      lastEmittedRef.current = null;
      onChange(sanitizedSourceHtml);
    }
    setMode(nextMode);
  }, [emitVisualChange, mode, onChange, sanitizedSourceHtml]);

  useImperativeHandle(forwardedRef, () => ({
    insertToken(key: string) {
      if (mode === "html") {
        const source = sourceRef.current;
        if (!source) return;
        const start = source.selectionStart ?? source.value.length;
        const end = source.selectionEnd ?? start;
        const token = `{{${key}}}`;
        const nextValue = `${source.value.slice(0, start)}${token}${source.value.slice(end)}`;
        onChange(nextValue);
        requestAnimationFrame(() => {
          source.focus();
          source.setSelectionRange(start + token.length, start + token.length);
        });
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const selection = window.getSelection();
      const range = savedRangeRef.current?.cloneRange() || document.createRange();
      if (!savedRangeRef.current || !root.contains(range.commonAncestorContainer)) range.selectNodeContents(root), range.collapse(false);
      const token = document.createElement("span");
      token.className = "dynamic-inline-token";
      token.contentEditable = "false";
      token.dataset.dynamicField = key;
      token.setAttribute("aria-label", `Dynamic value: ${dynamicFieldLabel(key, options)}`);
      token.textContent = dynamicFieldLabel(key, options);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // insertHTML participates in the browser's editing transaction history,
      // unlike Range.insertNode. This makes dynamic token insertion and text
      // replacement reversible with the same Ctrl+Z flow as ordinary typing.
      const insertedWithHistory = document.execCommand?.("insertHTML", false, token.outerHTML) ?? false;
      if (!insertedWithHistory) {
        range.deleteContents();
        range.insertNode(token);
        range.setStartAfter(token);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      saveRange();
      emitVisualChange();
    },
  }), [emitVisualChange, mode, onChange, options, saveRange]);

  const insertPlainText = (text: string) => {
    const html = escapeMergeValue(text).replace(/\r?\n/gu, "<br>");
    insertHtml(html);
  };

  const toolbarButton = (label: string, IconComponent: Icon, command: string, commandValue: string | null = null): ReactNode => <button type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand(command, commandValue)}><IconComponent weight="bold" /></button>;

  const addLink = () => {
    const href = window.prompt("Paste an HTTPS or mailto link");
    if (!href) return;
    const normalized = href.trim();
    if (!/^(?:https?:|mailto:)/iu.test(normalized)) return;
    runCommand("createLink", normalized);
  };

  return <div className={`html-message-composer html-message-composer--${mode}`}>
    <div className="editor-toolbar" role="toolbar" aria-label="Message formatting">
      {mode === "visual" ? <>
        <select aria-label="Font" defaultValue="" onChange={(event) => { if (event.target.value) runCommand("fontName", event.target.value); event.target.value = ""; }}>
          <option value="">Font</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
        </select>
        <select aria-label="Font size" defaultValue="3" onChange={(event) => runCommand("fontSize", event.target.value)}>
          <option value="2">10</option>
          <option value="3">12</option>
          <option value="4">14</option>
          <option value="5">18</option>
        </select>
        <span className="editor-toolbar__divider" aria-hidden="true" />
        {toolbarButton("Bold", TextB, "bold")}
        {toolbarButton("Italic", TextItalic, "italic")}
        {toolbarButton("Underline", TextUnderline, "underline")}
        {toolbarButton("Highlight", HighlighterCircle, "hiliteColor", "#f1df9d")}
        {toolbarButton("Bulleted list", ListBullets, "insertUnorderedList")}
        {toolbarButton("Numbered list", ListNumbers, "insertOrderedList")}
        {toolbarButton("Align left", TextAlignLeft, "justifyLeft")}
        {toolbarButton("Align center", TextAlignCenter, "justifyCenter")}
        {toolbarButton("Align right", TextAlignRight, "justifyRight")}
        <button type="button" aria-label="Add link" title="Add link" onMouseDown={(event) => event.preventDefault()} onClick={addLink}><LinkSimple weight="bold" /></button>
        {toolbarButton("Clear formatting", Eraser, "removeFormat")}
      </> : <span className="editor-toolbar__source-label"><Code weight="bold" /> HTML source</span>}
      <button type="button" className={`editor-source-toggle${mode === "html" ? " active" : ""}`} aria-label={mode === "html" ? "Return to visual editor" : "Edit HTML source"} aria-pressed={mode === "html"} title={mode === "html" ? "Return to visual editor" : "Edit HTML source"} onClick={() => switchMode(mode === "html" ? "visual" : "html")}><Code weight="bold" /></button>
    </div>
    {mode === "visual" ? <div
      ref={rootRef}
      className="message-editor token-message-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Message body"
      data-placeholder={placeholder}
      onFocus={(event) => { saveRange(); onFocus?.(event); }}
      onKeyUp={saveRange}
      onMouseUp={saveRange}
      onInput={() => { saveRange(); emitVisualChange(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); insertPlainText("\n"); }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const pastedHtml = event.clipboardData.getData("text/html");
        if (pastedHtml) {
          const safeHtml = sanitizeTemplateHtml(pastedHtml);
          insertHtml(safeHtml);
          return;
        }
        insertPlainText(event.clipboardData.getData("text/plain"));
      }}
    /> : <>
      <textarea ref={sourceRef} className="message-editor html-source-editor" aria-label="Message body HTML" spellCheck="false" value={sourceHtml} onChange={(event) => onChange(event.target.value)} />
      <div className={`html-source-status${sourceWasCleaned ? " html-source-status--cleaned" : ""}`} role="status">{sourceWasCleaned ? <><WarningCircle weight="fill" /> Preview and sending use cleaned HTML. Unsupported or unsafe markup is removed.</> : <><CheckCircle weight="fill" /> Preview and sending use this sanitized HTML.</>}</div>
    </>}
  </div>;
});
