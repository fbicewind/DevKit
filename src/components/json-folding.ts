import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { codeFolding, foldGutter, foldService } from "@codemirror/language";
import { findJsonFold, JsonFoldScanner } from "../services/json-fold-index";
import type {
  FoldIndexReply,
  FoldIndexRequest,
} from "../services/json-fold-index";

export const setJsonFoldIndex = StateEffect.define<Uint32Array>();
export const jsonFoldIndex = StateField.define<Uint32Array | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged) return null;
    for (const effect of transaction.effects)
      if (effect.is(setJsonFoldIndex)) return effect.value;
    return value;
  },
});

const indexBuilder = ViewPlugin.fromClass(
  class {
    private worker: Worker | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private revision = 0;
    private destroyed = false;
    constructor(private view: EditorView) {
      this.schedule(0);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule(150);
    }
    private cancel() {
      clearTimeout(this.timer);
      this.worker?.terminate();
      this.worker = null;
    }
    private schedule(delay: number) {
      this.cancel();
      const revision = ++this.revision;
      this.timer = setTimeout(() => this.build(revision), delay);
    }
    private build(revision: number) {
      const source = this.view.state.doc.toString();
      const accept = (ranges: Uint32Array) => {
        if (!this.destroyed && revision === this.revision)
          this.view.dispatch({ effects: setJsonFoldIndex.of(ranges) });
      };
      const fallback = () => {
        this.worker?.terminate();
        this.worker = null;
        const scanner = new JsonFoldScanner(source);
        const step = () => {
          if (this.destroyed || revision !== this.revision) return;
          if (scanner.step()) accept(scanner.finish());
          else this.timer = setTimeout(step, 0);
        };
        this.timer = setTimeout(step, 0);
      };
      try {
        const worker = (this.worker = new Worker(
          new URL("../workers/json-fold.worker.ts", import.meta.url),
          { type: "module" },
        ));
        worker.onmessage = ({ data }: MessageEvent<FoldIndexReply>) => {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          if (data.revision === revision) accept(data.ranges);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          if (!this.destroyed && revision === this.revision) fallback();
        };
        worker.postMessage({ revision, source } satisfies FoldIndexRequest);
      } catch {
        fallback();
      }
    }
    destroy() {
      this.destroyed = true;
      this.revision++;
      this.cancel();
    }
  },
);

export const jsonFolding = [
  jsonFoldIndex,
  indexBuilder,
  foldService.of((state, from, to) => {
    const index = state.field(jsonFoldIndex);
    return index ? findJsonFold(index, from, to) : null;
  }),
  foldGutter({
    foldingChanged: (update) =>
      update.startState.field(jsonFoldIndex) !==
      update.state.field(jsonFoldIndex),
    markerDOM(open) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "json-fold-toggle";
      marker.textContent = open ? "⌄" : "›";
      marker.title = open ? "折叠 JSON 节点" : "展开 JSON 节点";
      marker.setAttribute("aria-label", marker.title);
      marker.setAttribute("aria-expanded", String(open));
      marker.tabIndex = -1;
      return marker;
    },
  }),
  codeFolding({
    placeholderDOM(_view, onclick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-foldPlaceholder";
      button.textContent = "…";
      button.title = "展开已折叠的 JSON 节点";
      button.setAttribute("aria-label", button.title);
      button.onclick = onclick;
      return button;
    },
  }),
];
