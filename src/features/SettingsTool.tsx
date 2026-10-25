import { useEffect, useState } from "react";
import {
  Settings2,
  Braces,
  Keyboard,
  RotateCcw,
  Pin,
  PanelLeftClose,
  Monitor,
  AlertCircle,
} from "lucide-react";
import {
  accelerator,
  actionNames,
  call,
  errorMessage,
  prettyKey,
} from "../services/api";
import type { Binding, Settings } from "../services/api";
import { Field, useNotice } from "../components/common";
export function SettingsTool({
  settings,
  setSettings,
  update,
  shortcutErrors,
  setShortcutErrors,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  update: (patch: Partial<Settings>) => Promise<boolean>;
  shortcutErrors: string[];
  setShortcutErrors: (errors: string[]) => void;
}) {
  const [editLimitDraft, setEditLimitDraft] = useState(
    String(settings.jsonEditLimitMib),
  );
  const [limitError, setLimitError] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  useEffect(
    () => setEditLimitDraft(String(settings.jsonEditLimitMib)),
    [settings.jsonEditLimitMib],
  );
  const saveEditLimit = async () => {
    const value = Number(editLimitDraft);
    if (!Number.isInteger(value) || value < 1 || value > 64) {
      setLimitError("请输入 1–64 之间的整数 MiB");
      return;
    }
    setLimitError("");
    setSavingLimit(true);
    try {
      if (await update({ jsonEditLimitMib: value }))
        notice(`JSON 编辑上限已保存为 ${value} MiB`);
    } finally {
      setSavingLimit(false);
    }
  };
  const [recording, setRecording] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const notice = useNotice();
  const saveKeys = async (bindings: Binding[]) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<Settings>("shortcuts_update", { bindings });
      setSettings(result);
      setShortcutErrors([]);
      setRecording(undefined);
      notice("快捷键已注册并保存");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(undefined);
        setError("");
        return;
      }
      if (e.key === "Backspace") {
        void saveKeys(
          settings.shortcuts.map((b) =>
            b.actionId === recording
              ? { ...b, accelerator: "", enabled: false }
              : b,
          ),
        );
        return;
      }
      const combo = accelerator(e);
      if (!combo) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        setError("请使用 Command、Control 或 Option 加主键");
        return;
      }
      if (
        settings.shortcuts.some(
          (b) =>
            b.actionId !== recording && b.enabled && b.accelerator === combo,
        )
      ) {
        setError("此组合已分配给其他操作");
        return;
      }
      void saveKeys(
        settings.shortcuts.map((b) =>
          b.actionId === recording
            ? { ...b, accelerator: combo, enabled: true }
            : b,
        ),
      );
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  });
  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      setSettings(await call<Settings>("shortcuts_reset"));
      setShortcutErrors([]);
      setRecording(undefined);
      notice("已恢复默认快捷键");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tool settings-tool">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>设置与快捷键</h1>
          <p>让工具箱，配合你的工作方式。</p>
        </div>
        <Settings2 size={37} className="heading-symbol" />
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>
            <Monitor size={16} />
            窗口与外观
          </h2>
          <span className="tag">PREFERENCES</span>
        </div>
        {(
          [
            ["alwaysOnTop", "窗口置顶", "让 DevKit 保持在其他窗口上方", Pin],
            [
              "rememberWindow",
              "记忆窗口尺寸与位置",
              "重新打开时恢复；屏幕变化时自动回到可见区域",
              Monitor,
            ],
            [
              "compact",
              "紧凑侧边栏",
              "只显示图标，为工作区留出更多空间",
              PanelLeftClose,
            ],
          ] as const
        ).map(([key, title, desc, Icon]) => (
          <label className="setting-row" key={key}>
            <Icon size={17} />
            <div>
              <strong>{title}</strong>
              <small>{desc}</small>
            </div>
            <input
              className="switch"
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => void update({ [key]: e.target.checked })}
            />
          </label>
        ))}
        <div className="theme-field">
          <Field label="界面主题">
            <select
              value={settings.theme}
              onChange={(e) => void update({ theme: e.target.value })}
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
              <option value="system">跟随系统</option>
            </select>
          </Field>
        </div>
      </section>
      <section className="card">
        <div className="card-heading">
          <h2>
            <Braces size={16} />
            JSON 编辑
          </h2>
          <span className="tag">JSON</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveEditLimit();
          }}
        >
          <Field
            label="编辑上限（MiB）"
            help="默认 10 MiB，可设置为 1–64 MiB。按 UTF-8 字节计算；超过上限的文件使用只读树视图。"
          >
            <input
              type="number"
              min="1"
              max="64"
              step="1"
              required
              value={editLimitDraft}
              onChange={(e) => {
                setEditLimitDraft(e.target.value);
                setLimitError("");
              }}
            />
          </Field>
          <button className="primary" type="submit" disabled={savingLimit}>
            保存编辑上限
          </button>
          {limitError && (
            <p role="alert" className="error">
              {limitError}
            </p>
          )}
        </form>
        <p className="help">
          保存后，编辑输入、格式化输出和新打开的文件使用新上限。已有内容会保留；只读文件调整上限后需重新打开。
        </p>
      </section>
      <section className="card">
        <div className="card-heading">
          <h2>
            <Keyboard size={16} />
            键盘快捷键
          </h2>
          <button disabled={busy} onClick={() => void reset()}>
            <RotateCcw size={13} />
            恢复默认
          </button>
        </div>
        <p className="help">
          点击按键框开始录制。Esc 取消，Backspace
          清除。全局组合在后台仍可使用；更改注册失败时保留旧配置。
        </p>
        {shortcutErrors.length > 0 && (
          <div className="warning-box">
            <AlertCircle size={16} />
            <div>
              <strong>部分全局快捷键注册失败</strong>
              {shortcutErrors.map((s, i) => (
                <div key={i}>{s}</div>
              ))}
              <small>请点击下方按键框更换组合，或尝试重新保存当前组合。</small>
            </div>
          </div>
        )}
        <div className="shortcut-header">
          <span>操作</span>
          <span>作用域</span>
          <span>快捷键</span>
          <span />
        </div>
        {settings.shortcuts.map((b) => (
          <div className="shortcut-row" key={b.actionId}>
            <span>{actionNames[b.actionId]}</span>
            <select
              aria-label={`${actionNames[b.actionId]}作用域`}
              disabled={busy || !!recording}
              value={b.scope}
              onChange={(e) =>
                void saveKeys(
                  settings.shortcuts.map((item) =>
                    item.actionId === b.actionId
                      ? { ...item, scope: e.target.value as Binding["scope"] }
                      : item,
                  ),
                )
              }
            >
              <option value="global">全局</option>
              <option value="local">应用内</option>
            </select>
            <button
              disabled={busy}
              className={`key-binding ${recording === b.actionId ? "recording" : ""}`}
              onClick={() => {
                setRecording(b.actionId);
                setError("");
              }}
            >
              {recording === b.actionId
                ? "请按组合键…"
                : prettyKey(b.accelerator)}
            </button>
            <button
              className="text-button"
              disabled={busy || !b.accelerator}
              onClick={() =>
                void saveKeys(
                  settings.shortcuts.map((item) =>
                    item.actionId === b.actionId
                      ? { ...item, accelerator: "", enabled: false }
                      : item,
                  ),
                )
              }
            >
              清除
            </button>
          </div>
        ))}
        <div
          className={`keys-status ${error ? "error" : "muted"}`}
          role="status"
        >
          {error ||
            (recording
              ? "正在录制快捷键，按 Esc 可取消。"
              : busy
                ? "正在注册并保存…"
                : "应用内快捷键会尊重输入焦点；编辑器中可用 ⌘ ↵ 格式化。")}
        </div>
      </section>
      <div className="privacy-note">
        <span className="status-dot" />
        DevKit 1.0.0 · 完全离线 · 输入与文件不会上传
      </div>
    </div>
  );
}
