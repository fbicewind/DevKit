import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { jsonByteSize } from "./json-size";
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("JSON editor UTF-8 byte count", () => {
  it("counts text above the previous 2 MiB limit without treating characters as bytes", () => {
    const text = "中😀abc".repeat(300_000);
    const state = EditorState.create({ doc: text, extensions: [jsonByteSize] });
    expect(state.field(jsonByteSize)).toBe(bytes(text));
    expect(state.field(jsonByteSize)).toBeGreaterThan(2 * 1024 * 1024);
    expect(state.field(jsonByteSize)).toBeLessThan(10 * 1024 * 1024);
  });
  it("updates correctly for overlapping change contexts and surrogate joins/splits", () => {
    let state = EditorState.create({
      doc: "a😀b中\n\uD83Dc\uDE00d",
      extensions: [jsonByteSize],
    });
    for (const changes of [
      [{ from: 2, to: 3, insert: "文" }],
      [
        { from: 1, to: 2, insert: "" },
        { from: 3, to: 4, insert: "😀" },
      ],
      [
        { from: 0, to: 1, insert: "你好" },
        { from: 1, to: 2, insert: "b" },
      ],
      [{ from: 0, to: 4, insert: "😀\n中" }],
    ]) {
      state = state.update({ changes }).state;
      expect(state.field(jsonByteSize)).toBe(bytes(state.doc.toString()));
    }
  });
  it("matches full encoding across deterministic edits, including lone surrogates", () => {
    let state = EditorState.create({
      doc: "abc中😀\nx",
      extensions: [jsonByteSize],
    });
    const inserts = ["中", "\uD83D", "\uDE00", "😀", "\n", "", "a"];
    for (let i = 0; i < 200; i++) {
      const from = (i * 17) % (state.doc.length + 1);
      const to = Math.min(state.doc.length, from + (i % 4));
      state = state.update({
        changes: { from, to, insert: inserts[i % inserts.length] },
      }).state;
      expect(state.field(jsonByteSize)).toBe(bytes(state.doc.toString()));
    }
  });
});
