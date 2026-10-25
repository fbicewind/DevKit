import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { foldable, syntaxTreeAvailable } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import {
  indexJsonFolds,
  findJsonFold,
  JsonFoldScanner,
} from "./json-fold-index";
import { jsonFoldIndex, setJsonFoldIndex } from "../components/json-folding";
import { foldService } from "@codemirror/language";
import { readFileSync } from "node:fs";

function rangeAt(source: string, needle: string) {
  const at = source.indexOf(needle);
  const from = source.lastIndexOf("\n", at) + 1;
  const next = source.indexOf("\n", at);
  return findJsonFold(
    indexJsonFolds(source),
    from,
    next < 0 ? source.length : next,
  );
}

describe("JSON structural folding", () => {
  it("indexes nested arrays and objects, including multiple opens on one line", () => {
    const source =
      '{\n  "data": [{\n    "children": [\n      {\n        "value": 1\n      }\n    ]\n  }]\n}';
    const array = rangeAt(source, '"data"')!;
    expect(source[array.from - 1]).toBe("[");
    expect(source[array.to]).toBe("]");
    const nested = rangeAt(source, '"children"')!;
    expect(source[nested.from - 1]).toBe("[");
    expect(source[nested.to]).toBe("]");
    expect(rangeAt(source, '"value"')).toBeNull();
    expect(indexJsonFolds(source).length).toBe(10);
  });
  it("ignores escaped quotes and structural characters inside strings", () => {
    const source =
      '{\n  "text": "brackets [ { } ] and \\\"quote\\\" and \\\\ end 😀",\n  "列表": [\n    "}",\n    "["\n  ]\n}';
    expect(JSON.parse(source)).toBeTruthy();
    const ranges = indexJsonFolds(source);
    expect(ranges.length).toBe(4);
    const array = rangeAt(source, '"列表"')!;
    expect(source[array.from - 1]).toBe("[");
    expect(source[array.to]).toBe("]");
    expect(source.slice(array.from, array.to)).toContain('"}"');
  });
  it("does not invent folds for incomplete, mismatched, empty or single-line nodes", () => {
    expect(indexJsonFolds("[\n {}").length).toBe(0);
    expect(indexJsonFolds("{\n ]").length).toBe(0);
    expect(indexJsonFolds('{"a": [], "b": {}}').length).toBe(0);
    expect(indexJsonFolds('[\n "[\\\"}"').length).toBe(0);
    expect(
      indexJsonFolds("[".repeat(130) + "\n" + "]".repeat(130)).length,
    ).toBe(0);
  });
  it("supports the backend depth budget with a root at depth zero", () => {
    const source = "[\n".repeat(129) + "0" + "\n]".repeat(129);
    expect(indexJsonFolds(source).length).toBe(258);
  });
  it("keeps escape state across chunk boundaries and matches a complete scan", () => {
    const source =
      '{\r\n"emoji😀": [\r\n"\\\\\\\"[]{}",\r\n{\r\n"n": 1\r\n}\r\n]\r\n}';
    expect(JSON.parse(source)).toBeTruthy();
    const scanner = new JsonFoldScanner(source);
    while (!scanner.step(1)) {
      /* force every token across chunks */
    }
    expect(scanner.finish()).toEqual(indexJsonFolds(source));
    expect(scanner.finish().length).toBe(6);
  });
  it("folds huge outer arrays and distant objects before syntax parsing completes", () => {
    const item =
      '    {\n      "padding": "' +
      "x".repeat(2048) +
      '",\n      "items": [\n        1,\n        2\n      ]\n    }';
    const source =
      '{\n  "data": [\n' +
      Array.from({ length: 2500 }, () => item).join(",\n") +
      "\n  ]\n}";
    let state = EditorState.create({
      doc: source,
      extensions: [
        json(),
        jsonFoldIndex,
        foldService.of((s, a, b) => {
          const index = s.field(jsonFoldIndex);
          return index ? findJsonFold(index, a, b) : null;
        }),
      ],
    });
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
    expect(
      foldable(state, state.doc.line(2).from, state.doc.line(2).to),
    ).toBeNull();
    state = state.update({
      effects: setJsonFoldIndex.of(indexJsonFolds(source)),
    }).state;
    for (const number of [1, 2, 3, 5, 10_006]) {
      const line = state.doc.line(number);
      const range = foldable(state, line.from, line.to);
      expect(range, `line ${number}`).not.toBeNull();
      expect(range!.to).toBeGreaterThan(line.to);
    }
    // A changed document must not reuse stale offsets from the previous text.
    state = state.update({ changes: { from: 0, insert: "\n" } }).state;
    expect(state.field(jsonFoldIndex)).toBeNull();
  });
  it.skipIf(!process.env.DEVKIT_JSON_FIXTURE)(
    "indexes the supplied JSON without storing a private fixture in the repository",
    () => {
      const original = readFileSync(process.env.DEVKIT_JSON_FIXTURE!, "utf8");
      // This test-only normalization is used to inspect structure, never to export
      // user data. The application continues to format through its Rust engine.
      const value: unknown = JSON.parse(original);
      const source = JSON.stringify(value, null, 2);
      const ranges = indexJsonFolds(source);
      const root = rangeAt(source, "{")!;
      const data = rangeAt(source, '"data": [')!;
      expect(root).toEqual({ from: 1, to: source.length - 1 });
      expect(source[data.from - 1]).toBe("[");
      expect(source[data.to]).toBe("]");
      let expected = 0;
      const pending: unknown[] = [value];
      while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === "object") {
          const children = Array.isArray(value) ? value : Object.values(value);
          if (children.length) expected++;
          pending.push(...children);
        }
      }
      expect(ranges.length / 2).toBe(expected);
      expect(ranges.length).toBeGreaterThan(2000);
      console.info(
        `Supplied fixture: ${source.length} UTF-16 units, ${ranges.length / 2} foldable containers`,
      );
    },
  );
});
