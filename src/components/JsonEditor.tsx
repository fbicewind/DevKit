import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { jsonEditorSetup } from "./json-editor-setup";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { jsonByteSize, updatedByteLength } from "../services/json-size";
export function JsonEditor({
  value,
  onChange,
  disabled,
  errorLine,
  onLimit,
  limitBytes,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  errorLine?: number;
  onLimit: () => void;
  limitBytes: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const props = useRef({ onChange, onLimit, limitBytes });
  props.current = { onChange, onLimit, limitBytes };
  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          jsonEditorSetup,
          jsonByteSize,
          json(),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.propertyName, color: "var(--syntax-key)" },
              { tag: tags.string, color: "var(--syntax-string)" },
              { tag: tags.number, color: "var(--syntax-number)" },
              { tag: [tags.bool, tags.null], color: "var(--syntax-bool)" },
            ]),
          ),
          keymap.of([{ key: "Mod-Enter", run: () => false }]),
          EditorState.transactionFilter.of((tr) => {
            if (tr.docChanged && !syncing.current) {
              const previous = tr.startState.field(jsonByteSize);
              const next = updatedByteLength(previous, tr);
              if (next > props.current.limitBytes && next > previous) {
                queueMicrotask(() => props.current.onLimit());
                return [];
              }
            }
            return tr;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              props.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                fontSize: "12px",
                background: "var(--editor)",
                color: "var(--text)",
              },
              ".cm-scroller": { overflow: "auto", fontFamily: "var(--mono)" },
              ".cm-content": { padding: "12px 0" },
              ".cm-gutters": {
                background: "var(--editor)",
                color: "var(--muted)",
                border: "none",
                minWidth: "36px",
              },
              ".cm-activeLine, .cm-activeLineGutter": {
                background: "#6d8cff0c",
              },
              ".cm-cursor": { borderLeftColor: "#8ca9ff" },
              ".cm-selectionBackground": { background: "#6488f744 !important" },
              "&.cm-focused": { outline: "none" },
            },
            { dark: true },
          ),
          EditorView.contentAttributes.of({
            "aria-label": "JSON 输入 / 输出",
            spellcheck: "false",
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      syncing.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
      syncing.current = false;
    }
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (editor) editor.contentDOM.contentEditable = String(!disabled);
  }, [disabled]);
  useEffect(() => {
    const editor = view.current;
    if (editor && errorLine && errorLine <= editor.state.doc.lines) {
      const line = editor.state.doc.line(errorLine);
      editor.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      editor.focus();
    }
  }, [errorLine]);
  return <div className="json-editor" ref={container} />;
}
