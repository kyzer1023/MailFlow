import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  appendTokenEditorContent,
  dynamicFieldLabel,
} from "../../lib/editor-dom";
import { escapeMergeValue } from "../../../client/template";
import type { DynamicFieldOption } from "../../state/types";
import type { TokenMessageEditorHandle } from "./TokenMessageEditor";

export const SubjectEditor = forwardRef<
  TokenMessageEditorHandle,
  {
    readonly value: string;
    readonly options: readonly DynamicFieldOption[];
    readonly onChange: (value: string) => void;
    readonly onFocus: () => void;
    readonly missingFields?: readonly string[];
  }
>(function SubjectEditor(
  { value, options, onChange, onFocus, missingFields },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const read = () => {
    const clone = root.current?.cloneNode(true) as HTMLElement | undefined;
    clone
      ?.querySelectorAll<HTMLElement>("[data-dynamic-field]")
      .forEach((token) =>
        token.replaceWith(
          document.createTextNode(`{{${token.dataset.dynamicField}}}`),
        ),
      );
    return (clone?.textContent || "").replace(/[\r\n]/gu, "");
  };
  const remember = () => {
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      root.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
    )
      saved.current = selection.getRangeAt(0).cloneRange();
  };
  useEffect(() => {
    if (root.current && read() !== value)
      appendTokenEditorContent(
        root.current,
        `<span>${escapeMergeValue(value)}</span>`,
        options,
      );
  }, [value, options]);
  useEffect(() => {
    root.current
      ?.querySelectorAll<HTMLElement>("[data-dynamic-field]")
      .forEach((token) => {
        token.dataset.unconnected = String(
          Boolean(missingFields?.includes(token.dataset.dynamicField || "")),
        );
      });
  }, [value, missingFields]);
  useImperativeHandle(ref, () => ({
    insertToken(key: string) {
      if (!root.current) return;
      root.current.focus();
      const range =
        saved.current &&
        root.current.contains(saved.current.commonAncestorContainer)
          ? saved.current
          : document.createRange();
      if (range !== saved.current) {
        range.selectNodeContents(root.current);
        range.collapse(false);
      }
      const token = document.createElement("span");
      token.contentEditable = "false";
      token.dataset.dynamicField = key;
      token.className = "dynamic-inline-token";
      token.textContent = dynamicFieldLabel(key, options);
      range.deleteContents();
      range.insertNode(token);
      range.setStartAfter(token);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      remember();
      onChange(read());
    },
  }));
  return (
    <div
      className="subject-editor"
      contentEditable
      suppressContentEditableWarning
      ref={root}
      role="textbox"
      aria-label="Subject"
      aria-multiline="false"
      data-placeholder="Add a clear email subject"
      onFocus={onFocus}
      onBlur={() => {
        if (
          root.current &&
          /\{\{[^}]+\}\}/u.test(root.current.textContent || "")
        ) {
          appendTokenEditorContent(
            root.current,
            `<span>${escapeMergeValue(read())}</span>`,
            options,
          );
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      onKeyUp={remember}
      onMouseUp={remember}
      onInput={() => {
        remember();
        onChange(read());
      }}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand(
          "insertText",
          false,
          event.clipboardData.getData("text/plain").replace(/[\r\n]/gu, " "),
        );
        onChange(read());
      }}
    />
  );
});
