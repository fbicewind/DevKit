use crate::{
    error::{AppError, Result},
    json::{Control, Document, Transform, EDIT_BYTES},
    settings::{self, Bounds, Settings, ShortcutBinding},
    tools::{
        self, RandomRequest, SignatureRequest, SignatureResult, SignatureTemplate, TimeResult,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex},
};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenResult {
    session_id: String,
    size_bytes: usize,
    root: crate::json::JsonNode,
    mode: String,
    text: Option<String>,
    node_count: usize,
    duplicate_keys: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatus {
    task_id: String,
    phase: String,
    bytes_processed: usize,
    bytes_total: usize,
    done: bool,
    error: Option<AppError>,
    opened: Option<OpenResult>,
    text: Option<String>,
    destination: Option<String>,
}
struct Task {
    control: Control,
    status: Mutex<TaskStatus>,
}
struct Runtime {
    sessions: Mutex<HashMap<String, Arc<Document>>>,
    tasks: Mutex<HashMap<String, Arc<Task>>>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    shortcut_errors: Mutex<Vec<String>>,
    settings_error: Option<String>,
}
fn internal() -> AppError {
    AppError::new("INTERNAL", "内部状态不可用")
}
fn desktop(e: impl std::fmt::Display) -> AppError {
    AppError::new("WINDOW_ERROR", e.to_string())
}
fn session(state: &Runtime, id: &str) -> Result<Arc<Document>> {
    state
        .sessions
        .lock()
        .map_err(|_| internal())?
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::new("SESSION_NOT_FOUND", "JSON 会话已关闭，请重新打开"))
}
fn task(state: &Runtime, id: &str) -> Result<Arc<Task>> {
    state
        .tasks
        .lock()
        .map_err(|_| internal())?
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::new("TASK_NOT_FOUND", "任务不存在"))
}
fn start_task(state: &Runtime, phase: &str, total: usize) -> Result<(String, Arc<Task>)> {
    let mut tasks = state.tasks.lock().map_err(|_| internal())?;
    if tasks
        .values()
        .any(|t| !t.status.lock().map(|s| s.done).unwrap_or(true))
    {
        return Err(AppError::new("TASK_BUSY", "请等待当前任务完成，或先取消"));
    }
    tasks.retain(|_, t| !t.status.lock().map(|s| s.done).unwrap_or(true));
    let id = uuid::Uuid::new_v4().to_string();
    let task = Arc::new(Task {
        control: Control::default(),
        status: Mutex::new(TaskStatus {
            task_id: id.clone(),
            phase: phase.into(),
            bytes_processed: 0,
            bytes_total: total,
            done: false,
            error: None,
            opened: None,
            text: None,
            destination: None,
        }),
    });
    tasks.insert(id.clone(), task.clone());
    Ok((id, task))
}
fn finish(task: &Task, result: Result<()>) {
    if let Ok(mut s) = task.status.lock() {
        s.done = true;
        s.phase = if result.is_ok() {
            "已完成"
        } else {
            "未完成"
        }
        .into();
        s.error = result.err();
    }
}
#[tauri::command]
fn json_open(
    app: tauri::AppHandle,
    path: Option<String>,
    text: Option<String>,
    clipboard: Option<bool>,
) -> Result<String> {
    let state = app.state::<Arc<Runtime>>();
    if usize::from(path.is_some())
        + usize::from(text.is_some())
        + usize::from(clipboard.unwrap_or(false))
        != 1
    {
        return Err(AppError::new("INVALID_ARGUMENT", "请选择一个 JSON 来源"));
    }
    if text.as_ref().is_some_and(|s| s.len() > EDIT_BYTES) {
        return Err(AppError::new(
            "LIMIT_EXCEEDED",
            "编辑器上限为 2 MiB；请使用文件或导入剪贴板打开大 JSON",
        ));
    }
    let total = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() as usize)
        .or_else(|| text.as_ref().map(String::len))
        .unwrap_or(0);
    let (id, task) = start_task(&state, "读取 / 校验 / 建立索引", total)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let doc = if let Some(path) = path {
                Document::open(&PathBuf::from(path), &task.control)?
            } else {
                let source = if clipboard.unwrap_or(false) {
                    app.clipboard()
                        .read_text()
                        .map_err(|e| AppError::new("CLIPBOARD_ERROR", e.to_string()))?
                } else {
                    text.unwrap_or_default()
                };
                Document::parse(source, &task.control)?
            };
            task.control.check()?;
            let sid = uuid::Uuid::new_v4().to_string();
            let opened = OpenResult {
                session_id: sid.clone(),
                size_bytes: doc.size(),
                root: doc.node(0, None)?,
                mode: if doc.size() > EDIT_BYTES {
                    "large"
                } else {
                    "edit"
                }
                .into(),
                text: doc.text().ok().map(str::to_string),
                node_count: doc.node_count(),
                duplicate_keys: doc.duplicate_keys,
            };
            let mut sessions = state.sessions.lock().map_err(|_| internal())?;
            if sessions.len() >= 2 {
                return Err(AppError::new(
                    "LIMIT_EXCEEDED",
                    "最多保留两个 JSON 会话，请关闭旧文件",
                ));
            }
            sessions.insert(sid, Arc::new(doc));
            let mut s = task.status.lock().map_err(|_| internal())?;
            s.bytes_total = opened.size_bytes;
            s.opened = Some(opened);
            Ok(())
        })();
        finish(&task, result);
    });
    Ok(id)
}
#[tauri::command]
fn json_task_status(state: tauri::State<'_, Arc<Runtime>>, task_id: String) -> Result<TaskStatus> {
    let t = task(&state, &task_id)?;
    let mut s = t.status.lock().map_err(|_| internal())?.clone();
    s.bytes_processed = t
        .control
        .processed
        .load(Ordering::Relaxed)
        .min(s.bytes_total);
    Ok(s)
}
#[tauri::command]
fn json_task_release(state: tauri::State<'_, Arc<Runtime>>, task_id: String) -> Result<()> {
    let t = task(&state, &task_id)?;
    if !t.status.lock().map_err(|_| internal())?.done {
        return Err(AppError::new("TASK_BUSY", "任务尚未完成"));
    }
    state.tasks.lock().map_err(|_| internal())?.remove(&task_id);
    Ok(())
}
#[tauri::command]
fn json_children(
    state: tauri::State<'_, Arc<Runtime>>,
    session_id: String,
    node_id: u32,
    offset: usize,
    limit: usize,
) -> Result<Vec<crate::json::JsonNode>> {
    session(&state, &session_id)?.children(node_id, offset, limit)
}
#[tauri::command]
fn json_transform(
    app: tauri::AppHandle,
    session_id: String,
    options: Transform,
    destination: Option<String>,
) -> Result<String> {
    let state = app.state::<Arc<Runtime>>();
    let doc = session(&state, &session_id)?;
    options.validate()?;
    let (id, task) = start_task(&state, "变换 / 写入临时文件", doc.size())?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            if let Some(path) = destination {
                doc.export(&PathBuf::from(&path), &options, &task.control)?;
                task.status.lock().map_err(|_| internal())?.destination = Some(path);
            } else {
                let text = doc.output_text(&options, &task.control)?;
                task.status.lock().map_err(|_| internal())?.text = Some(text);
            }
            Ok(())
        })();
        finish(&task, result);
    });
    Ok(id)
}
#[tauri::command]
fn json_cancel(state: tauri::State<'_, Arc<Runtime>>, task_id: String) -> Result<()> {
    task(&state, &task_id)?
        .control
        .cancelled
        .store(true, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
fn json_close(state: tauri::State<'_, Arc<Runtime>>, session_id: String) -> Result<()> {
    state
        .sessions
        .lock()
        .map_err(|_| internal())?
        .remove(&session_id);
    Ok(())
}
#[tauri::command]
fn unix_to_time(value: String, unit: String, zone: String) -> Result<TimeResult> {
    tools::unix_to_time(&value, &unit, &zone)
}
#[tauri::command]
fn time_to_unix(value: String, zone: String, ambiguity: String) -> Result<TimeResult> {
    tools::time_to_unix(&value, &zone, &ambiguity)
}
#[tauri::command]
fn random_generate(request: RandomRequest) -> Result<Vec<String>> {
    tools::random_generate(&request)
}
#[tauri::command]
fn signature_compute(
    state: tauri::State<'_, Arc<Runtime>>,
    request: SignatureRequest,
) -> Result<SignatureResult> {
    let now = chrono::Utc::now().timestamp_millis();
    let secret = if let Some(s) = &request.secret {
        s.clone()
    } else if let Some(id) = &request.template_id {
        let settings = state.settings.lock().map_err(|_| internal())?;
        let t = settings
            .templates
            .iter()
            .find(|t| &t.id == id)
            .ok_or_else(|| AppError::new("TEMPLATE_NOT_FOUND", "模板不存在"))?;
        if t.secret_ref.is_some() {
            keychain_get(id)?
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    tools::signature_compute(&request, &secret, now)
}
#[cfg(target_os = "macos")]
fn keychain_get(id: &str) -> Result<String> {
    let bytes = security_framework::passwords::get_generic_password("com.devkit.local", id)
        .map_err(|_| {
            AppError::new(
                "KEYCHAIN_ERROR",
                "无法读取钥匙串 Secret，请检查钥匙串权限或重新输入",
            )
        })?;
    String::from_utf8(bytes).map_err(|_| AppError::new("KEYCHAIN_ERROR", "Secret 编码无效"))
}
#[cfg(target_os = "macos")]
fn keychain_set(id: &str, secret: &str) -> Result<()> {
    security_framework::passwords::set_generic_password("com.devkit.local", id, secret.as_bytes())
        .map_err(|_| AppError::new("KEYCHAIN_ERROR", "无法保存 Secret 到 macOS 钥匙串"))
}
#[cfg(target_os = "macos")]
fn keychain_delete(id: &str) -> Result<()> {
    match security_framework::passwords::delete_generic_password("com.devkit.local", id) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == -25300 => Ok(()),
        Err(_) => Err(AppError::new("KEYCHAIN_ERROR", "无法移除钥匙串 Secret")),
    }
}
#[cfg(not(target_os = "macos"))]
fn keychain_get(_: &str) -> Result<String> {
    Err(AppError::new(
        "KEYCHAIN_UNAVAILABLE",
        "此版本的凭据存储需要 macOS",
    ))
}
#[cfg(not(target_os = "macos"))]
fn keychain_set(_: &str, _: &str) -> Result<()> {
    Err(AppError::new(
        "KEYCHAIN_UNAVAILABLE",
        "此版本的凭据存储需要 macOS",
    ))
}
#[cfg(not(target_os = "macos"))]
fn keychain_delete(_: &str) -> Result<()> {
    Ok(())
}
#[tauri::command]
fn templates_list(state: tauri::State<'_, Arc<Runtime>>) -> Result<Vec<SignatureTemplate>> {
    Ok(state
        .settings
        .lock()
        .map_err(|_| internal())?
        .templates
        .clone())
}
#[tauri::command]
fn templates_save(
    state: tauri::State<'_, Arc<Runtime>>,
    mut template: SignatureTemplate,
    secret: Option<String>,
    remove_secret: bool,
) -> Result<Vec<SignatureTemplate>> {
    template.validate()?;
    let mut settings = state.settings.lock().map_err(|_| internal())?;
    let mut next = settings.clone();
    let old = next.templates.iter().find(|t| t.id == template.id);
    template.secret_ref = old.and_then(|t| t.secret_ref.clone());
    let previous = if template.secret_ref.is_some() && (remove_secret || secret.is_some()) {
        Some(keychain_get(&template.id)?)
    } else {
        None
    };
    if remove_secret {
        keychain_delete(&template.id)?;
        template.secret_ref = None;
    } else if let Some(secret) = secret.as_ref() {
        if secret.is_empty() || secret.len() > 65536 {
            return Err(AppError::new(
                "SIGNATURE_SECRET_EMPTY",
                "保存到钥匙串的 Secret 须为 1–65536 字节",
            ));
        }
        keychain_set(&template.id, secret)?;
        template.secret_ref = Some(format!("keychain:{}", template.id));
    }
    next.templates.retain(|t| t.id != template.id);
    next.templates.push(template.clone());
    if let Err(err) = next.save(&state.settings_path) {
        if let Some(previous) = previous {
            let _ = keychain_set(&template.id, &previous);
        } else if secret.is_some() {
            let _ = keychain_delete(&template.id);
        }
        return Err(err);
    }
    *settings = next;
    Ok(settings.templates.clone())
}
#[tauri::command]
fn templates_delete(
    state: tauri::State<'_, Arc<Runtime>>,
    id: String,
) -> Result<Vec<SignatureTemplate>> {
    let mut settings = state.settings.lock().map_err(|_| internal())?;
    let t = settings
        .templates
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::new("TEMPLATE_NOT_FOUND", "模板不存在"))?;
    let old = if t.secret_ref.is_some() {
        Some(keychain_get(&id)?)
    } else {
        None
    };
    if old.is_some() {
        keychain_delete(&id)?;
    }
    let mut next = settings.clone();
    next.templates.retain(|t| t.id != id);
    if let Err(e) = next.save(&state.settings_path) {
        if let Some(s) = old {
            let _ = keychain_set(&id, &s);
        }
        return Err(e);
    }
    *settings = next;
    Ok(settings.templates.clone())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResult {
    settings: Settings,
    shortcut_errors: Vec<String>,
    settings_error: Option<String>,
}
#[tauri::command]
fn settings_get(state: tauri::State<'_, Arc<Runtime>>) -> Result<SettingsResult> {
    Ok(SettingsResult {
        settings: state.settings.lock().map_err(|_| internal())?.clone(),
        shortcut_errors: state
            .shortcut_errors
            .lock()
            .map_err(|_| internal())?
            .clone(),
        settings_error: state.settings_error.clone(),
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPatch {
    always_on_top: Option<bool>,
    remember_window: Option<bool>,
    compact: Option<bool>,
    theme: Option<String>,
}
#[tauri::command]
fn settings_update(app: tauri::AppHandle, patch: SettingsPatch) -> Result<Settings> {
    let state = app.state::<Arc<Runtime>>();
    let mut s = state.settings.lock().map_err(|_| internal())?;
    let mut next = s.clone();
    if let Some(v) = patch.always_on_top {
        next.always_on_top = v;
    }
    if let Some(v) = patch.remember_window {
        next.remember_window = v;
        if !v {
            next.bounds = None;
        }
    }
    if let Some(v) = patch.compact {
        next.compact = v;
    }
    if let Some(v) = patch.theme {
        next.theme = v;
    }
    next.validate()?;
    if let Some(w) = app.get_webview_window("main") {
        w.set_always_on_top(next.always_on_top).map_err(desktop)?;
    }
    if let Err(e) = next.save(&state.settings_path) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_always_on_top(s.always_on_top);
        }
        return Err(e);
    }
    *s = next;
    Ok(s.clone())
}
fn global_keys(bindings: &[ShortcutBinding]) -> Result<HashMap<u32, Shortcut>> {
    let mut keys = HashMap::new();
    for b in bindings
        .iter()
        .filter(|b| b.enabled && b.scope == "global" && !b.accelerator.is_empty())
    {
        let key: Shortcut = b
            .accelerator
            .parse()
            .map_err(|e| AppError::new("SHORTCUT_INVALID", format!("{}: {e}", b.accelerator)))?;
        keys.insert(key.id(), key);
    }
    Ok(keys)
}
#[tauri::command]
fn shortcuts_update(app: tauri::AppHandle, bindings: Vec<ShortcutBinding>) -> Result<Settings> {
    settings::validate_shortcuts(&bindings)?;
    for b in bindings
        .iter()
        .filter(|b| b.enabled && !b.accelerator.is_empty())
    {
        b.accelerator
            .parse::<Shortcut>()
            .map_err(|e| AppError::new("SHORTCUT_INVALID", e.to_string()))?;
    }
    let state = app.state::<Arc<Runtime>>();
    let mut s = state.settings.lock().map_err(|_| internal())?;
    let old = global_keys(&s.shortcuts)?;
    let new = global_keys(&bindings)?;
    let mut added = Vec::new();
    for (id, key) in &new {
        if !old.contains_key(id) || !app.global_shortcut().is_registered(*key) {
            if let Err(e) = app.global_shortcut().register(*key) {
                for k in added {
                    let _ = app.global_shortcut().unregister(k);
                }
                return Err(AppError::new(
                    "SHORTCUT_CONFLICT",
                    format!("无法注册 {key}，可能已被其他应用占用：{e}"),
                ));
            }
            added.push(*key);
        }
    }
    let mut next = s.clone();
    next.shortcuts = bindings;
    if let Err(e) = next.save(&state.settings_path) {
        for key in added {
            let _ = app.global_shortcut().unregister(key);
        }
        return Err(e);
    }
    let mut removed = Vec::new();
    for (id, key) in old {
        if !new.contains_key(&id) {
            if let Err(e) = app.global_shortcut().unregister(key) {
                for k in removed {
                    let _ = app.global_shortcut().register(k);
                }
                for k in added {
                    let _ = app.global_shortcut().unregister(k);
                }
                let _ = s.save(&state.settings_path);
                return Err(AppError::new("SHORTCUT_ERROR", e.to_string()));
            }
            removed.push(key);
        }
    }
    *s = next;
    state
        .shortcut_errors
        .lock()
        .map_err(|_| internal())?
        .clear();
    Ok(s.clone())
}
#[tauri::command]
fn shortcuts_reset(app: tauri::AppHandle) -> Result<Settings> {
    shortcuts_update(app, settings::defaults())
}
#[tauri::command]
fn window_toggle(app: tauri::AppHandle) -> Result<()> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| desktop("主窗口不存在"))?;
    if w.is_visible().map_err(desktop)? && w.is_focused().map_err(desktop)? {
        w.hide().map_err(desktop)?;
    } else {
        w.show().map_err(desktop)?;
        w.unminimize().map_err(desktop)?;
        w.set_focus().map_err(desktop)?;
    }
    Ok(())
}
#[tauri::command]
fn window_set_always_on_top(app: tauri::AppHandle, value: bool) -> Result<Settings> {
    settings_update(
        app,
        SettingsPatch {
            always_on_top: Some(value),
            remember_window: None,
            compact: None,
            theme: None,
        },
    )
}
#[tauri::command]
fn window_control(app: tauri::AppHandle, action: String) -> Result<()> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| desktop("主窗口不存在"))?;
    match action.as_str() {
        "minimize" => w.minimize().map_err(desktop),
        "maximize" => {
            if w.is_maximized().map_err(desktop)? {
                w.unmaximize().map_err(desktop)
            } else {
                w.maximize().map_err(desktop)
            }
        }
        "close" => w.close().map_err(desktop),
        _ => Err(AppError::new("INVALID_ARGUMENT", "无效窗口操作")),
    }
}
#[tauri::command]
fn text_export(destination: String, text: String) -> Result<()> {
    if text.len() > 4 * 1024 * 1024 {
        return Err(AppError::new("LIMIT_EXCEEDED", "导出文本超过 4 MiB"));
    }
    let path = PathBuf::from(destination);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("INVALID_PATH", "无效导出路径"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(AppError::io)?;
    use std::io::Write;
    temp.write_all(text.as_bytes()).map_err(AppError::io)?;
    temp.as_file().sync_all().map_err(AppError::io)?;
    temp.persist(path).map_err(|e| AppError::io(e.error))?;
    Ok(())
}
fn restore_window(w: &tauri::WebviewWindow, s: &Settings) {
    let _ = w.set_always_on_top(s.always_on_top);
    if !s.remember_window {
        return;
    }
    if let Some(b) = &s.bounds {
        let monitors = w.available_monitors().unwrap_or_default();
        let visible = monitors.iter().any(|m| {
            let p = m.position();
            let size = m.size();
            b.x >= p.x
                && b.y >= p.y
                && i64::from(b.x) + i64::from(b.width) <= i64::from(p.x) + i64::from(size.width)
                && i64::from(b.y) + i64::from(b.height) <= i64::from(p.y) + i64::from(size.height)
        });
        if visible {
            let _ = w.set_size(tauri::PhysicalSize::new(
                b.width.max(520),
                b.height.max(420),
            ));
            let _ = w.set_position(tauri::PhysicalPosition::new(b.x, b.y));
        } else {
            let _ = w.center();
        }
    }
}
fn save_bounds(w: &tauri::Window) {
    let state = w.state::<Arc<Runtime>>();
    if let Ok(mut s) = state.settings.lock() {
        if s.remember_window && !w.is_minimized().unwrap_or(false) {
            if let (Ok(p), Ok(size)) = (w.outer_position(), w.inner_size()) {
                s.bounds = Some(Bounds {
                    x: p.x,
                    y: p.y,
                    width: size.width,
                    height: size.height,
                });
                let _ = s.save(&state.settings_path);
            }
        }
    };
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, key, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<Arc<Runtime>>();
                    let action = state.settings.lock().ok().and_then(|s| {
                        s.shortcuts
                            .iter()
                            .find(|b| {
                                b.enabled
                                    && b.scope == "global"
                                    && b.accelerator
                                        .parse::<Shortcut>()
                                        .is_ok_and(|k| k.id() == key.id())
                            })
                            .map(|b| b.action_id.clone())
                    });
                    if let Some(action) = action {
                        if action == "window.toggle" {
                            let _ = window_toggle(app.clone());
                        } else {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                            let _ = app.emit("shortcut-action", action);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("settings.json");
            let (settings, settings_error) = match Settings::load(&path) {
                Ok(s) => (s, None),
                Err(e) => {
                    if path.exists() {
                        let backup = path.with_file_name(format!(
                            "settings.invalid-{}.json",
                            chrono::Utc::now().timestamp_millis()
                        ));
                        std::fs::rename(&path, backup)?;
                    }
                    (Settings::default(), Some(e.message))
                }
            };
            let runtime = Arc::new(Runtime {
                sessions: Mutex::new(HashMap::new()),
                tasks: Mutex::new(HashMap::new()),
                settings: Mutex::new(settings.clone()),
                settings_path: path,
                shortcut_errors: Mutex::new(vec![]),
                settings_error,
            });
            app.manage(runtime.clone());
            for b in settings
                .shortcuts
                .iter()
                .filter(|b| b.enabled && b.scope == "global" && !b.accelerator.is_empty())
            {
                if let Err(e) = b
                    .accelerator
                    .parse::<Shortcut>()
                    .map_err(|e| e.to_string())
                    .and_then(|k| app.global_shortcut().register(k).map_err(|e| e.to_string()))
                {
                    runtime
                        .shortcut_errors
                        .lock()
                        .unwrap()
                        .push(format!("{}：{e}", b.accelerator));
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                restore_window(&w, &settings);
            }
            Ok(())
        })
        .on_window_event(|w, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                save_bounds(w);
                let state = w.state::<Arc<Runtime>>();
                let usable = state.settings.lock().ok().is_some_and(|s| {
                    s.shortcuts.iter().any(|b| {
                        b.enabled
                            && b.scope == "global"
                            && b.accelerator
                                .parse::<Shortcut>()
                                .is_ok_and(|k| w.app_handle().global_shortcut().is_registered(k))
                    })
                });
                if usable {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
            tauri::WindowEvent::Focused(false) => save_bounds(w),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            json_open,
            json_children,
            json_transform,
            json_cancel,
            json_close,
            json_task_status,
            json_task_release,
            unix_to_time,
            time_to_unix,
            random_generate,
            signature_compute,
            templates_list,
            templates_save,
            templates_delete,
            settings_get,
            settings_update,
            shortcuts_update,
            shortcuts_reset,
            window_toggle,
            window_set_always_on_top,
            window_control,
            text_export
        ])
        .build(tauri::generate_context!())
        .expect("DevKit 初始化失败")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(w) = app.get_webview_window("main") {
                    save_bounds(&w.as_ref().window());
                }
                let _ = app.global_shortcut().unregister_all();
            }
        });
}
