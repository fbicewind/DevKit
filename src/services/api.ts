import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
export const native = isTauri();
export interface Failure {
  code?: string;
  message: string;
  line?: number;
  column?: number;
}
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "操作失败，请重试";
}
export function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    return Promise.reject({
      code: "DESKTOP_REQUIRED",
      message:
        "这是界面预览。请运行 npm run tauri dev，在桌面应用中使用本地工具。",
    });
  return invoke<T>(command, args);
}
export async function copy(text: string) {
  if (!text) throw new Error("暂无可复制的结果");
  if (native) await writeText(text);
  else await navigator.clipboard.writeText(text);
}
export async function pickJson() {
  return open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON / 文本", extensions: ["json", "txt", "log"] }],
  });
}
export async function savePath(name: string, extension: string) {
  return save({
    defaultPath: name,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}
export async function exportText(text: string, name: string) {
  const path = await savePath(name, name.split(".").pop() || "txt");
  if (path) await call("text_export", { destination: path, text });
  return !!path;
}
export interface JsonNode {
  id: number;
  key?: string;
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  summary: string;
  hasChildren: boolean;
  childCount: number;
}
export interface Opened {
  sessionId: string;
  sizeBytes: number;
  root: JsonNode;
  mode: "large" | "edit";
  text?: string;
  nodeCount: number;
  duplicateKeys: boolean;
}
export interface TaskStatus {
  taskId: string;
  phase: string;
  bytesProcessed: number;
  bytesTotal: number;
  done: boolean;
  error?: Failure;
  opened?: Opened;
  text?: string;
  destination?: string;
}
export interface Transform {
  kind: string;
  indent: string;
  sortDirection: string;
}
export async function waitTask(
  id: string,
  update: (status: TaskStatus) => void,
): Promise<TaskStatus> {
  try {
    for (;;) {
      const status = await call<TaskStatus>("json_task_status", { taskId: id });
      update(status);
      if (status.done) {
        if (status.error) throw status.error;
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await call("json_task_release", { taskId: id }).catch(() => {});
  }
}
export interface Binding {
  actionId: string;
  scope: "global" | "local";
  accelerator: string;
  enabled: boolean;
}
export interface Template {
  id: string;
  name: string;
  algorithm: string;
  template: string;
  unit: string;
  variables: Record<string, string>;
  encoding: string;
  uppercase: boolean;
  secretRef?: string;
}
export interface Settings {
  version: number;
  alwaysOnTop: boolean;
  rememberWindow: boolean;
  compact: boolean;
  theme: string;
  jsonEditLimitMib: number;
  shortcuts: Binding[];
  templates: Template[];
}
export const defaultSettings: Settings = {
  version: 1,
  alwaysOnTop: false,
  rememberWindow: true,
  compact: false,
  theme: "dark",
  jsonEditLimitMib: 10,
  templates: [],
  shortcuts: [
    ["window.toggle", "global", "Alt+Space"],
    ["tool.json.open", "global", "Super+Shift+J"],
    ["json.format", "local", "Super+Enter"],
    ["result.copy", "local", "Super+Shift+C"],
    ["signature.compute", "local", "Super+Shift+S"],
    ["window.pin.toggle", "local", "Super+Shift+P"],
  ].map(([actionId, scope, accelerator]) => ({
    actionId,
    scope: scope as Binding["scope"],
    accelerator,
    enabled: true,
  })),
};
export const actionNames: Record<string, string> = {
  "window.toggle": "显示 / 隐藏 DevKit",
  "tool.json.open": "打开 JSON 工具",
  "json.format": "格式化 JSON",
  "result.copy": "复制当前结果",
  "signature.compute": "计算签名",
  "window.pin.toggle": "切换窗口置顶",
};
export function prettyKey(s: string) {
  return s
    ? s
        .replace(/Super|Meta|Command/g, "⌘")
        .replace(/Control/g, "⌃")
        .replace(/Alt/g, "⌥")
        .replace(/Shift/g, "⇧")
        .replace(/Space/g, "空格")
        .replace(/Enter/g, "↵")
        .replace(/\+/g, " ")
    : "未设置";
}
export function accelerator(
  e: KeyboardEvent | React.KeyboardEvent,
): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const key =
    e.code === "Space"
      ? "Space"
      : e.code.startsWith("Key")
        ? e.code.slice(3)
        : e.code.startsWith("Digit")
          ? e.code.slice(5)
          : e.key === " "
            ? "Space"
            : e.key.length === 1
              ? e.key.toUpperCase()
              : e.key;
  return [
    e.metaKey && "Super",
    e.ctrlKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function bytes(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1048576).toFixed(2)} MiB`;
}
