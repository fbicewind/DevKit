use crate::{
    error::{AppError, Result},
    tools::SignatureTemplate,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, io::Write, path::Path};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub action_id: String,
    pub scope: String,
    pub accelerator: String,
    pub enabled: bool,
}
pub fn defaults() -> Vec<ShortcutBinding> {
    [
        ("window.toggle", "global", "Alt+Space"),
        ("tool.json.open", "global", "Super+Shift+J"),
        ("json.format", "local", "Super+Enter"),
        ("result.copy", "local", "Super+Shift+C"),
        ("signature.compute", "local", "Super+Shift+S"),
        ("window.pin.toggle", "local", "Super+Shift+P"),
    ]
    .iter()
    .map(|(id, scope, key)| ShortcutBinding {
        action_id: (*id).into(),
        scope: (*scope).into(),
        accelerator: (*key).into(),
        enabled: true,
    })
    .collect()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub always_on_top: bool,
    pub remember_window: bool,
    pub compact: bool,
    pub theme: String,
    pub shortcuts: Vec<ShortcutBinding>,
    pub bounds: Option<Bounds>,
    pub templates: Vec<SignatureTemplate>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            always_on_top: false,
            remember_window: true,
            compact: false,
            theme: "dark".into(),
            shortcuts: defaults(),
            bounds: None,
            templates: vec![],
        }
    }
}
impl Settings {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(path).map_err(AppError::io)?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(AppError::new("SETTINGS_INVALID", "配置文件超过大小限制"));
        }
        let settings: Self = serde_json::from_slice(&bytes).map_err(|_| {
            AppError::new(
                "SETTINGS_INVALID",
                "配置文件损坏，请备份后移除 settings.json",
            )
        })?;
        if settings.version != 1 {
            return Err(AppError::new("SETTINGS_VERSION", "配置版本不受支持"));
        }
        settings.validate()?;
        Ok(settings)
    }
    pub fn validate(&self) -> Result<()> {
        validate_shortcuts(&self.shortcuts)?;
        if !["dark", "light", "system"].contains(&self.theme.as_str()) || self.templates.len() > 100
        {
            return Err(AppError::new("SETTINGS_INVALID", "无效设置"));
        }
        for t in &self.templates {
            t.validate()?;
            if t.secret_ref
                .as_ref()
                .is_some_and(|r| r != &format!("keychain:{}", t.id))
            {
                return Err(AppError::new("TEMPLATE_INVALID", "无效 Keychain 引用"));
            }
        }
        Ok(())
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let parent = path
            .parent()
            .ok_or_else(|| AppError::new("INVALID_PATH", "无效配置路径"))?;
        std::fs::create_dir_all(parent).map_err(AppError::io)?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(AppError::io)?;
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|_| AppError::new("SETTINGS_INVALID", "配置序列化失败"))?;
        temp.write_all(&bytes).map_err(AppError::io)?;
        temp.as_file().sync_all().map_err(AppError::io)?;
        temp.persist(path).map_err(|e| AppError::io(e.error))?;
        Ok(())
    }
}
pub fn canonical(acc: &str) -> Result<String> {
    let mut modifiers = HashSet::new();
    let mut key = None;
    for p in acc.split('+') {
        match p {
            "Super" | "Meta" | "Command" => {
                modifiers.insert("Super");
            }
            "Control" | "Ctrl" => {
                modifiers.insert("Control");
            }
            "Alt" | "Option" => {
                modifiers.insert("Alt");
            }
            "Shift" => {
                modifiers.insert("Shift");
            }
            s => {
                if s.is_empty() || key.is_some() {
                    return Err(AppError::new(
                        "SHORTCUT_INVALID",
                        "快捷键须包含修饰键和一个主键",
                    ));
                }
                key = Some(s.to_uppercase());
            }
        }
    }
    if modifiers.is_empty() || key.is_none() {
        return Err(AppError::new(
            "SHORTCUT_INVALID",
            "快捷键须包含修饰键和主键",
        ));
    }
    let mut parts: Vec<String> = ["Super", "Control", "Alt", "Shift"]
        .iter()
        .filter(|m| modifiers.contains(**m))
        .map(|s| s.to_string())
        .collect();
    parts.push(key.unwrap());
    Ok(parts.join("+"))
}
pub fn validate_shortcuts(bindings: &[ShortcutBinding]) -> Result<()> {
    let actions: HashSet<_> = defaults().into_iter().map(|b| b.action_id).collect();
    let mut ids = HashSet::new();
    let mut combos = HashSet::new();
    if bindings.len() != actions.len() {
        return Err(AppError::new("SHORTCUT_INVALID", "快捷键操作列表不完整"));
    }
    for b in bindings {
        if !actions.contains(&b.action_id)
            || !ids.insert(&b.action_id)
            || !["global", "local"].contains(&b.scope.as_str())
        {
            return Err(AppError::new("SHORTCUT_INVALID", "无效快捷键操作或作用域"));
        }
        if !b.enabled || b.accelerator.is_empty() {
            continue;
        }
        let c = canonical(&b.accelerator)?;
        if [
            "Super+Q",
            "Super+TAB",
            "Super+SPACE",
            "Alt+TAB",
            "Control+Alt+DELETE",
            "Super+H",
            "Super+M",
        ]
        .contains(&c.as_str())
        {
            return Err(AppError::new(
                "SHORTCUT_RESERVED",
                "该组合被系统保留，请选择其他快捷键",
            ));
        }
        if !combos.insert(c) {
            return Err(AppError::new(
                "SHORTCUT_CONFLICT",
                "此组合已被另一项操作使用",
            ));
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conflicts_and_persistence() {
        let mut s = Settings::default();
        s.shortcuts[2].accelerator = "Command+Shift+J".into();
        assert_eq!(s.validate().unwrap_err().code, "SHORTCUT_CONFLICT");
        s.shortcuts = defaults();
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("settings.json");
        s.compact = true;
        s.save(&path).unwrap();
        assert!(Settings::load(&path).unwrap().compact);
        s.shortcuts[0].accelerator = "Super+Q".into();
        assert_eq!(s.validate().unwrap_err().code, "SHORTCUT_RESERVED");
    }
}
