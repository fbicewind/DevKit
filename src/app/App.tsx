import { useCallback, useEffect, useRef, useState } from "react";
import {
  Braces,
  Clock3,
  Shuffle,
  Fingerprint,
  Settings2,
  Pin,
  PanelLeftClose,
  PanelLeftOpen,
  LockKeyhole,
  Circle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { JsonTool } from "../features/JsonTool";
import { TimeTool } from "../features/TimeTool";
import { RandomTool } from "../features/RandomTool";
import { SignatureTool } from "../features/SignatureTool";
import { SettingsTool } from "../features/SettingsTool";
import { NoticeContext } from "../components/common";
import {
  accelerator,
  call,
  defaultSettings,
  errorMessage,
  native,
} from "../services/api";
import type { Settings } from "../services/api";
type View = "json" | "time" | "random" | "signature" | "settings";
const nav = [
  { id: "json", label: "JSON 工具", sub: "格式化与结构", icon: Braces },
  { id: "time", label: "时间戳转换", sub: "时间与时区", icon: Clock3 },
  { id: "random", label: "随机字符串", sub: "安全随机生成", icon: Shuffle },
  { id: "signature", label: "签名计算", sub: "模板与摘要", icon: Fingerprint },
  { id: "settings", label: "设置与快捷键", sub: "你的偏好", icon: Settings2 },
] as const;
export default function App() {
  const [view, setView] = useState<View>("json");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [shortcutErrors, setShortcutErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [ready, setReady] = useState(!native);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updating = useRef(false);
  const [narrowWindow, setNarrowWindow] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  const [compactOverride, setCompactOverride] = useState<boolean>();
  const sidebarCompact = compactOverride ?? (settings.compact || narrowWindow);
  useEffect(() => {
    const media = matchMedia("(max-width: 800px)");
    const handler = () => setNarrowWindow(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);
  const notice = useCallback((message: string, error?: boolean) => {
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(undefined), error ? 6500 : 3000);
  }, []);
  useEffect(() => {
    if (!native) return;
    void call<{
      settings: Settings;
      shortcutErrors: string[];
      settingsError?: string;
    }>("settings_get")
      .then((r) => {
        setSettings({ ...defaultSettings, ...r.settings });
        setShortcutErrors(r.shortcutErrors);
        if (r.settingsError)
          notice(`已备份损坏配置并恢复默认：${r.settingsError}`, true);
      })
      .catch((e) => notice(errorMessage(e), true))
      .finally(() => setReady(true));
    return () => clearTimeout(timer.current);
  }, [notice]);
  const update = async (patch: Partial<Settings>) => {
    if (updating.current) return false;
    updating.current = true;
    try {
      setSettings(await call<Settings>("settings_update", { patch }));
      if (patch.compact !== undefined) setCompactOverride(patch.compact);
      return true;
    } catch (e) {
      notice(errorMessage(e), true);
      return false;
    } finally {
      updating.current = false;
    }
  };
  const dispatch = (action: string) => {
    if (action === "window.toggle") {
      void call("window_toggle").catch((e) => notice(errorMessage(e), true));
      return;
    }
    if (action === "tool.json.open") {
      setView("json");
      return;
    }
    if (action === "window.pin.toggle") {
      void update({ alwaysOnTop: !settings.alwaysOnTop });
      return;
    }
    if (action === "json.format") setView("json");
    if (action === "signature.compute") setView("signature");
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent("devkit:action", { detail: action }),
        ),
      0,
    );
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      const target = e.target as HTMLElement;
      const combo = accelerator(e);
      const match = settings.shortcuts.find(
        (b) => b.enabled && b.scope === "local" && b.accelerator === combo,
      );
      if (!match) return;
      const typing = !!target.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (
        typing &&
        !(match.actionId === "json.format" && target.closest(".json-editor"))
      )
        return;
      e.preventDefault();
      dispatch(match.actionId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    if (!native) return;
    const subscription = listen<string>("shortcut-action", (e) =>
      dispatchRef.current(e.payload),
    );
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemDark(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);
  const theme =
    settings.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : settings.theme;
  return (
    <NoticeContext.Provider value={notice}>
      <div
        className={`app ${sidebarCompact ? "compact" : ""}`}
        data-theme={theme}
      >
        <header className="titlebar" data-tauri-drag-region>
          <div className="traffic-placeholder">
            {!native && (
              <>
                <i />
                <i />
                <i />
              </>
            )}
          </div>
          <span className="titlebar-caption" data-tauri-drag-region>
            DevKit <ChevronRight size={11} />
            <span>{nav.find((n) => n.id === view)?.label}</span>
          </span>
          <div className="flex-spacer" data-tauri-drag-region />
          <span className="window-state">
            <Circle size={6} fill="currentColor" />
            {settings.alwaysOnTop ? "窗口已置顶" : "普通窗口"}
          </span>
          <button
            className={`icon-button ${settings.alwaysOnTop ? "active" : ""}`}
            title="切换窗口置顶"
            aria-label="切换窗口置顶"
            onClick={() => void update({ alwaysOnTop: !settings.alwaysOnTop })}
          >
            <Pin size={14} />
          </button>
          <button
            className="icon-button"
            title="设置"
            aria-label="设置"
            onClick={() => setView("settings")}
          >
            <Settings2 size={15} />
          </button>
        </header>
        <div className="app-body">
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-mark">
                <Braces size={22} />
              </div>
              <div className="brand-text">
                DevKit<span>DEVELOPER TOOLBOX</span>
              </div>
            </div>
            <div className="sidebar-section">工作空间</div>
            <nav id="devkit-sidebar-nav" aria-label="工具导航">
              {nav.map(({ id, label, sub, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-item ${view === id ? "active" : ""} ${id === "settings" ? "settings-nav" : ""}`}
                  title={label}
                  onClick={() => setView(id)}
                >
                  <Icon size={18} />
                  <div className="nav-label">
                    <span>{label}</span>
                    <small>{sub}</small>
                  </div>
                  {view === id && <span className="nav-indicator" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="local-badge">
                <LockKeyhole size={13} />
                <span>
                  本地优先，安心使用<small>你的数据，只在你的设备</small>
                </span>
              </div>
              <div className="sidebar-meta">
                <span>v1.0.0</span>
                <button
                  className="icon-button"
                  title={sidebarCompact ? "展开侧边栏" : "收起侧边栏"}
                  aria-label={sidebarCompact ? "展开侧边栏" : "收起侧边栏"}
                  aria-controls="devkit-sidebar-nav"
                  aria-expanded={!sidebarCompact}
                  onClick={() => void update({ compact: !sidebarCompact })}
                >
                  {sidebarCompact ? (
                    <PanelLeftOpen size={15} />
                  ) : (
                    <PanelLeftClose size={15} />
                  )}
                </button>
              </div>
            </div>
          </aside>
          <main className="workspace">
            {!native && (
              <div className="preview-banner">
                <ExternalLink size={12} />
                界面预览 · 本地计算与桌面功能请使用 Tauri 客户端
              </div>
            )}
            {shortcutErrors.length > 0 && view !== "settings" && (
              <button
                className="startup-warning"
                onClick={() => setView("settings")}
              >
                有 {shortcutErrors.length} 个全局快捷键未注册，点击更换组合
              </button>
            )}
            {ready ? (
              <>
                <div hidden={view !== "json"}>
                  <JsonTool
                    active={view === "json"}
                    editLimitMib={settings.jsonEditLimitMib}
                  />
                </div>
                <div hidden={view !== "time"}>
                  <TimeTool active={view === "time"} />
                </div>
                <div hidden={view !== "random"}>
                  <RandomTool active={view === "random"} />
                </div>
                <div hidden={view !== "signature"}>
                  <SignatureTool
                    active={view === "signature"}
                    templates={settings.templates}
                    setTemplates={(templates) =>
                      setSettings((s) => ({ ...s, templates }))
                    }
                  />
                </div>
                <div hidden={view !== "settings"}>
                  <SettingsTool
                    settings={{ ...settings, compact: sidebarCompact }}
                    setSettings={setSettings}
                    update={update}
                    shortcutErrors={shortcutErrors}
                    setShortcutErrors={setShortcutErrors}
                  />
                </div>
              </>
            ) : (
              <div className="empty-state">正在加载本地偏好…</div>
            )}
          </main>
        </div>
        <footer className="statusbar">
          <span>
            <i className="status-dot" />
            准备就绪<span className="footer-divider">|</span>
            <LockKeyhole size={10} />
            完全离线
          </span>
          <span>
            DevKit <b>·</b> 为专注而造
          </span>
        </footer>
        {toast && (
          <div
            className={`toast ${toast.error ? "toast-error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.message}
            <button aria-label="关闭提示" onClick={() => setToast(undefined)}>
              ×
            </button>
          </div>
        )}
      </div>
    </NoticeContext.Provider>
  );
}
