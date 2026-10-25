import { useEffect, useRef, useState } from "react";
import {
  Braces,
  FileUp,
  Download,
  ClipboardPaste,
  WandSparkles,
  ListFilter,
  FileJson,
  X,
  Check,
  RefreshCw,
} from "lucide-react";
import { JsonEditor } from "../components/JsonEditor";
import { JsonTree } from "../components/JsonTree";
import { CopyButton, Spinner, useNotice } from "../components/common";
import {
  bytes,
  call,
  errorMessage,
  native,
  pickJson,
  savePath,
  waitTask,
  copy,
} from "../services/api";
import type { Opened, TaskStatus, Transform, Failure } from "../services/api";
const sample =
  '{\n  "code": 200,\n  "message": "success",\n  "data": {\n    "items": [\n      { "id": 1, "name": "Alpha", "enabled": true },\n      { "id": 2, "name": "Beta", "enabled": false }\n    ],\n    "total": 2,\n    "meta": { "source": "DevKit", "tags": ["local", "json", "tools"] }\n  },\n  "largeInteger": 9007199254740993123456789,\n  "nullValue": null\n}';
export function JsonTool({ active }: { active: boolean }) {
  const [text, setText] = useState(sample);
  const [opened, setOpened] = useState<Opened>();
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<TaskStatus>();
  const [error, setError] = useState<Failure>();
  const [indent, setIndent] = useState("2");
  const [direction, setDirection] = useState("asc");
  const [message, setMessage] = useState(
    "打开文件或粘贴 JSON，点击校验查看节点",
  );
  const [lastKind, setLastKind] = useState("format");
  const [size, setSize] = useState(new TextEncoder().encode(sample).length);
  const busyRef = useRef(false);
  const taskId = useRef<string | undefined>(undefined);
  const sessionId = useRef<string | undefined>(undefined);
  const notice = useNotice();
  const large = opened?.mode === "large";
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!large) setSize(new TextEncoder().encode(text).length);
    }, 150);
    return () => clearTimeout(timer);
  }, [text, large]);
  const job = async (command: string, args: Record<string, unknown>) => {
    const id = await call<string>(command, args);
    taskId.current = id;
    return waitTask(id, setTask).finally(() => {
      taskId.current = undefined;
    });
  };
  const accept = async (next: Opened) => {
    const previous = sessionId.current;
    sessionId.current = next.sessionId;
    setOpened(next);
    setText(next.text ?? "");
    setSize(next.sizeBytes);
    setDirty(false);
    if (previous && previous !== next.sessionId)
      await call("json_close", { sessionId: previous });
    if (next.duplicateKeys)
      notice("检测到重复键：保留格式化和压缩，排序将被拒绝");
  };
  const snapshot = async () => {
    if (opened && !dirty) return opened;
    const status = await job("json_open", { text });
    if (!status.opened) throw new Error("会话建立失败");
    await accept(status.opened);
    return status.opened;
  };
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setTask(undefined);
    try {
      await work();
    } catch (e) {
      const f =
        typeof e === "object" && e && "message" in e
          ? (e as Failure)
          : { message: errorMessage(e) };
      setError(f);
      setMessage(f.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTask(undefined);
    }
  };
  const transform = (kind: string) =>
    run(async () => {
      const doc = await snapshot();
      const options: Transform = { kind, indent, sortDirection: direction };
      if (doc.mode === "large") {
        const path = await savePath(`devkit-${kind}.json`, "json");
        if (!path) return;
        await job("json_transform", {
          sessionId: doc.sessionId,
          options,
          destination: path,
        });
        setMessage(`已导出到 ${path}`);
        notice("已导出 JSON，原文件保持完整");
      } else {
        const status = await job("json_transform", {
          sessionId: doc.sessionId,
          options,
        });
        if (status.text !== undefined) {
          const fresh = await job("json_open", { text: status.text });
          if (fresh.opened) await accept(fresh.opened);
        }
        setMessage(
          { format: "格式化完成", minify: "压缩完成", sort: "递归排序完成" }[
            kind
          ] || "完成",
        );
      }
      setLastKind(kind);
    });
  const importJson = (source: "file" | "clipboard") =>
    run(async () => {
      if (!native)
        throw new Error("文件和剪贴板导入需在 DevKit 桌面应用中使用");
      const path = source === "file" ? await pickJson() : undefined;
      if (source === "file" && !path) return;
      const status = await job(
        "json_open",
        source === "file" ? { path } : { clipboard: true },
      );
      if (status.opened) {
        await accept(status.opened);
        setMessage(
          status.opened.mode === "large"
            ? "大文件模式 · 原文留在本地后端，选择操作可直接导出"
            : "JSON 已载入并校验",
        );
      }
    });
  const validate = () =>
    run(async () => {
      const doc = await snapshot();
      setMessage(`校验通过 · ${doc.nodeCount.toLocaleString()} 个节点`);
    });
  const exportJson = () =>
    run(async () => {
      const doc = await snapshot();
      const path = await savePath("devkit-export.json", "json");
      if (!path) return;
      await job("json_transform", {
        sessionId: doc.sessionId,
        options: {
          kind: large ? lastKind : "format",
          indent,
          sortDirection: direction,
        },
        destination: path,
      });
      setMessage(`已导出到 ${path}`);
      notice("JSON 已导出");
    });
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "json.format") void transform("format");
      if (action === "result.copy" && !large)
        void copy(text)
          .then(() => notice("已复制"))
          .catch((e) => notice(errorMessage(e), true));
    };
    window.addEventListener("devkit:action", handler);
    return () => window.removeEventListener("devkit:action", handler);
  });
  useEffect(
    () => () => {
      if (sessionId.current)
        void call("json_close", { sessionId: sessionId.current }).catch(
          () => {},
        );
    },
    [],
  );
  return (
    <div className="tool json-tool">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FORMAT / INSPECT / TRANSFORM</div>
          <h1>
            JSON 工具
            <span className="tag">{large ? "大文件模式" : "工作台"}</span>
          </h1>
          <p>让复杂的数据，变得清晰有序。</p>
        </div>
        <Braces className="heading-symbol" size={37} />
      </div>
      <div className="toolbar">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void transform("format")}
        >
          <WandSparkles size={14} />
          格式化
        </button>
        <button disabled={busy} onClick={() => void transform("minify")}>
          压缩
        </button>
        <button disabled={busy} onClick={() => void transform("sort")}>
          <ListFilter size={14} />
          Key 排序
        </button>
        <select
          aria-label="排序方向"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="asc">升序 ↑</option>
          <option value="desc">降序 ↓</option>
        </select>
        <span className="toolbar-separator" />
        <label className="inline-label">
          缩进
          <select
            aria-label="缩进"
            value={indent}
            onChange={(e) => setIndent(e.target.value)}
          >
            <option value="2">2 空格</option>
            <option value="4">4 空格</option>
            <option value="tab">Tab</option>
          </select>
        </label>
        <div className="flex-spacer" />
        <button
          title="导入剪贴板（支持大 JSON）"
          disabled={busy}
          onClick={() => void importJson("clipboard")}
        >
          <ClipboardPaste size={14} />
          <span className="optional-label">粘贴</span>
        </button>
        <button disabled={busy} onClick={() => void importJson("file")}>
          <FileUp size={14} />
          打开
        </button>
        <button disabled={busy} onClick={() => void exportJson()}>
          <Download size={14} />
          导出
        </button>
      </div>
      <div className={`json-panes ${large ? "large-mode" : ""}`}>
        {!large ? (
          <div className="pane editor-pane">
            <div className="pane-header">
              <span>
                <FileJson size={14} />
                JSON 输入 / 输出
              </span>
              <div className="row tight">
                <small>{bytes(size)}</small>
                <CopyButton small text={text} label="复制 JSON" />
              </div>
            </div>
            <JsonEditor
              value={text}
              onChange={(value) => {
                setText(value);
                setDirty(true);
                setError(undefined);
              }}
              disabled={busy}
              errorLine={error?.line}
              onLimit={() =>
                notice(
                  "编辑器上限为 2 MiB，请用文件或“粘贴”按钮打开大 JSON",
                  true,
                )
              }
            />
            <div className="pane-footer">
              <span>{text.split("\n").length} 行 · UTF-8</span>
              <button disabled={busy} onClick={() => void validate()}>
                <RefreshCw size={12} />
                {dirty ? "校验并刷新树" : "已校验"}
              </button>
            </div>
          </div>
        ) : (
          <div className="large-notice">
            <FileJson size={22} />
            <strong>{bytes(size)} · 大文件只读会话</strong>
            <span>
              原文和索引保留在 Rust
              后端；选择格式化、压缩或排序，将结果导出为新文件。
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (sessionId.current)
                    await call("json_close", { sessionId: sessionId.current });
                  sessionId.current = undefined;
                  setOpened(undefined);
                  setText("");
                  setDirty(true);
                  setMessage("会话已关闭");
                })
              }
            >
              <X size={13} />
              关闭文件
            </button>
          </div>
        )}
        <JsonTree opened={opened} stale={dirty} />
      </div>
      <div className={`operation-status ${error ? "error" : ""}`} role="status">
        {busy ? (
          <>
            <Spinner />
            <span>
              {task?.phase || "准备任务"}
              {task?.bytesTotal
                ? ` · ${bytes(task.bytesProcessed)} / ${bytes(task.bytesTotal)}`
                : ""}
            </span>
            <button
              onClick={() => {
                if (taskId.current)
                  void call("json_cancel", { taskId: taskId.current }).catch(
                    (e) => notice(errorMessage(e), true),
                  );
              }}
            >
              <X size={12} />
              取消
            </button>
          </>
        ) : (
          <>
            <span className={`status-dot ${error ? "red" : ""}`} />
            {error ? error.message : message}
            {!error && !dirty && <Check size={13} />}
          </>
        )}
      </div>
      <div className="json-bottom">
        <span>保留数值字面量 · UTF-8 字节序排序</span>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (sessionId.current)
                await call("json_close", { sessionId: sessionId.current });
              sessionId.current = undefined;
              setOpened(undefined);
              setText(sample);
              setDirty(true);
              setMessage("示例已载入");
            })
          }
        >
          加载示例
        </button>
      </div>
    </div>
  );
}
