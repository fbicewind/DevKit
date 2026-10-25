import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Layers,
} from "lucide-react";
import { call, errorMessage } from "../services/api";
import type { JsonNode, Opened } from "../services/api";
import { useNotice } from "./common";
interface Row {
  node: JsonNode;
  depth: number;
  parent?: number;
  load?: boolean;
}
export function JsonTree({
  opened,
  stale,
  hidden = false,
}: {
  opened?: Opened;
  stale: boolean;
  hidden?: boolean;
}) {
  const [pages, setPages] = useState<Map<number, JsonNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(300);
  const [loading, setLoading] = useState(false);
  const [depth, setDepth] = useState("3");
  const container = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const notice = useNotice();
  useEffect(() => {
    generation.current++;
    setPages(new Map());
    setExpanded(new Set());
    setScroll(0);
    if (container.current) container.current.scrollTop = 0;
  }, [opened?.sessionId]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setHeight(entries[0].contentRect.height),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const load = async (node: JsonNode, offset = 0) => {
    if (!opened) return [];
    const version = generation.current;
    const page = await call<JsonNode[]>("json_children", {
      sessionId: opened.sessionId,
      nodeId: node.id,
      offset,
      limit: 200,
    });
    if (version === generation.current)
      setPages((p) => {
        const next = new Map(p);
        next.set(
          node.id,
          offset ? [...(next.get(node.id) || []), ...page] : page,
        );
        return next;
      });
    return page;
  };
  const toggle = async (node: JsonNode) => {
    if (loading) return;
    if (expanded.has(node.id)) {
      setExpanded((p) => {
        const s = new Set(p);
        s.delete(node.id);
        return s;
      });
      return;
    }
    setLoading(true);
    try {
      if (!pages.has(node.id)) await load(node);
      setExpanded((p) => new Set([...p, node.id]));
    } catch (e) {
      notice(errorMessage(e), true);
    } finally {
      setLoading(false);
    }
  };
  const expandDepth = async () => {
    if (!opened || loading) return;
    const version = generation.current;
    setLoading(true);
    try {
      const ids = new Set<number>();
      const nextPages = new Map(pages);
      const queue = [{ node: opened.root, level: 0 }];
      let budget = 0;
      while (queue.length && budget < 2000) {
        if (version !== generation.current) return;
        const { node, level } = queue.shift()!;
        if (!node.hasChildren || level >= Number(depth)) continue;
        const children = nextPages.get(node.id) || (await load(node));
        nextPages.set(node.id, children);
        ids.add(node.id);
        budget += children.length;
        queue.push(...children.map((n) => ({ node: n, level: level + 1 })));
      }
      if (version !== generation.current) return;
      setPages(nextPages);
      setExpanded(ids);
      if (queue.length)
        notice("已展开 2,000 个节点预算；可继续按需展开或加载下一页");
    } catch (e) {
      notice(errorMessage(e), true);
    } finally {
      setLoading(false);
    }
  };
  const rows: Row[] = [];
  const flatten = (node: JsonNode, d: number) => {
    rows.push({ node, depth: d });
    if (expanded.has(node.id)) {
      const children = pages.get(node.id) || [];
      children.forEach((n) => flatten(n, d + 1));
      if (children.length < node.childCount)
        rows.push({ node, depth: d + 1, load: true });
    }
  };
  if (opened) flatten(opened.root, 0);
  const start = Math.max(0, Math.floor(scroll / 28) - 6);
  const visible = rows.slice(start, start + Math.ceil(height / 28) + 12);
  return (
    <div id="json-node-tree" className="pane tree-pane" hidden={hidden}>
      <div className="pane-header">
        <span>
          <Layers size={14} />
          节点树 {stale && <em>待刷新</em>}
        </span>
        <div className="row tight">
          <button
            className="icon-button"
            title="全部折叠"
            onClick={() => {
              setExpanded(new Set());
              if (container.current) container.current.scrollTop = 0;
            }}
          >
            <ChevronsDownUp size={14} />
          </button>
          <select
            aria-label="展开深度"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 层
              </option>
            ))}
          </select>
          <button
            disabled={loading || !opened}
            onClick={() => void expandDepth()}
          >
            展开
          </button>
        </div>
      </div>
      <div
        className="tree-scroll"
        ref={container}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        role="tree"
        aria-label="JSON 节点树"
      >
        <div
          style={{
            height: rows.length * 28,
            minWidth: "100%",
            position: "relative",
          }}
        >
          {visible.map((r, i) => (
            <div
              key={`${r.node.id}-${r.load ? "more" : "node"}`}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={
                r.node.hasChildren ? expanded.has(r.node.id) : undefined
              }
              className={`tree-row type-${r.node.type}`}
              style={{
                position: "absolute",
                top: (start + i) * 28,
                paddingLeft: 12 + r.depth * 18,
                height: 28,
              }}
            >
              {r.load ? (
                <button
                  disabled={loading}
                  onClick={() => {
                    setLoading(true);
                    void load(r.node, pages.get(r.node.id)?.length || 0)
                      .catch((e) => notice(errorMessage(e), true))
                      .finally(() => setLoading(false));
                  }}
                >
                  加载更多 · 已显示 {pages.get(r.node.id)?.length} /{" "}
                  {r.node.childCount}
                </button>
              ) : (
                <>
                  <button
                    className="tree-toggle"
                    disabled={!r.node.hasChildren || loading}
                    aria-label={`${expanded.has(r.node.id) ? "折叠" : "展开"} ${r.node.key ?? "root"}`}
                    onClick={() => void toggle(r.node)}
                  >
                    {r.node.hasChildren ? (
                      expanded.has(r.node.id) ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )
                    ) : (
                      <span />
                    )}
                  </button>
                  <span className="tree-key">
                    {r.node.key === undefined ? "root" : r.node.key}
                  </span>
                  <span className="tree-colon">:</span>
                  <span className="tree-value">{r.node.summary}</span>
                </>
              )}
            </div>
          ))}
        </div>
        {!opened && (
          <div className="tree-empty">
            <Layers size={30} />
            <span>校验 JSON 后查看节点</span>
            <small>按需加载 · 保留原始数值精度</small>
          </div>
        )}
      </div>
      <div className="pane-footer">
        {opened
          ? `${opened.nodeCount.toLocaleString()} 个节点 · ${rows.length.toLocaleString()} 行可见路径 · 分页 / 虚拟滚动`
          : "树视图与已校验的输入快照对应"}
      </div>
    </div>
  );
}
