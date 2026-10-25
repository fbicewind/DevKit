# DevKit macOS 本地开发者工具箱 — 产品及技术开发方案

> 文档版本：1.0 | 日期：2026-10-25 | 阶段：开发设计 | 交付平台：macOS | 目标分发：DMG 自用安装

## 1. 项目目标与边界

DevKit 是完全离线、单用户、本地安装的开发辅助工具，包含：**JSON 格式化/压缩/排序/节点折叠**、**时间戳转换**、**随机字符串生成**、**可配置签名计算**、**窗口移动/缩放/置顶**、**全局及应用内快捷键自定义**。使用 Tauri 2 + React + TypeScript + Rust，交付 `.app` 与 `.dmg`。

**关键验收目标：30 MiB 级（以 30 × 1024 × 1024 字节为测试基准）的合法 JSON 能打开、查看树形节点、折叠、格式化、压缩、排序并导出；期间 UI 可响应、不会因整树 DOM 渲染而卡死。** 不保证任意深度、恶意输入、超大单节点都以相同速度处理；须定义深度/节点/内存预算和可恢复错误。

不做云端同步、登录注册、在线更新或后端服务；不自动上传任何输入文本、签名 secret 或用户文件。

## 2. V1 功能清单与验收

| 模块 | 编号 | V1 功能 | 核心验收 |
|---|---|---|---|
| JSON | J01 | 本地打开/粘贴 JSON、合法性校验、精确定位错误 | 错误信息含行列/路径（可获得时） |
| JSON | J02 | 2/4空格/Tab 格式化、单行压缩 | 字符串内容不变化；导出内容是合法 JSON |
| JSON | J03 | 对象键按字典规则递归升序/降序排序 | 数组顺序不变；规则固定且可测试 |
| JSON | J04 | 节点展开/折叠、全部折叠、指定深度展开 | 仅渲染可见节点 |
| JSON | J05 | 大文件后台解析、取消、进度/阶段提示、文件导出 | 30 MiB 压测中 UI 可响应 |
| 时间戳 | T01 | Unix 秒/毫秒到标准时间、ISO8601 | 支持负值、异常、时区 |
| 时间戳 | T02 | 标准时间到秒/毫秒 | 明确输入所属时区、夏令时规则 |
| 随机字符串 | R01 | 大写/小写/数字/符号及自定义字符集 | 用户所选范围有效；空范围拒绝 |
| 随机字符串 | R02 | 长度/数量、复制及导出 | 使用安全随机源、无模偏采样 |
| 签名 | S01 | 模板保存/修改/删除 | secret 不进入普通配置文件 |
| 签名 | S02 | MD5/SHA1/SHA256/HMAC-SHA256 | 与公开测试向量一致 |
| 签名 | S03 | 变量替换、手工/当前 timestamp | 一次计算只生成一个 timestamp |
| 桌面 | W01 | 窗口拖动/缩放/置顶、侧边栏紧凑模式 | macOS 上实际有效 |
| 桌面 | W02 | 记忆上次位置、尺寸、置顶状态 | 重启后恢复，超出屏幕时纠正位置 |
| 快捷键 | K01 | 全局唤起/隐藏、导航工具 | 后台状态仍可唤起 |
| 快捷键 | K02 | 应用内快捷键录制、冲突提示、恢复默认 | 关闭重启后配置保留 |
| 分发 | D01 | ARM64（按需 x64） `.dmg` 安装包 | 拖拽到 Applications 即可安装 |

## 3. 界面信息架构

单窗口布局：**自定义 macOS 风格标题栏**（置顶/设置） + **左侧导航**（JSON、时间戳、随机字符、签名、设置） + **主工作区** + **底部状态栏**。

- 默认 900 × 650；最小 520 × 420；紧凑模式隐藏侧边栏标签，可调整大小。
- 状态栏显示文件大小、操作状态、错误等；异步长任务提供取消按钮。
- 切换页签保留非敏感输入；大 JSON 在 Rust 后端保留会话句柄，前端仅保留句柄、选择位置等轻状态。
- HTML 交互文件 `DevKit-交互原型.html` 是**界面与小数据操作演示**，不是 Tauri 源码，不能验证桌面置顶或 30 MiB 处理性能。

### 推荐默认快捷键

| Action ID | 默认按键 | 作用域 |
|---|---|---|
| `window.toggle` | Option+Space | 全局（可修改） |
| `tool.json.open` | Cmd+Shift+J | 全局（可修改） |
| `json.format` | Cmd+Enter | 应用内 |
| `result.copy` | Cmd+Shift+C | 应用内 |
| `signature.compute` | Cmd+Shift+S | 应用内 |
| `window.pin.toggle` | Cmd+Shift+P | 应用内 |

全局快捷键的默认键位不保证在每台 Mac 上可注册。应提供第一次启动时的冲突提示及替换按钮，避免强制覆盖系统和其他软件。

## 4. 技术栈

- 桌面容器：**Tauri 2**，macOS 窗口、剪贴板、菜单栏（如需）、Global Shortcut 插件、文件对话框与 DMG。
- UI：**React + TypeScript + Vite + Tailwind CSS**，组件可采用 shadcn/ui 风格。
- 轻量 JSON 文本编辑：CodeMirror 6；大 JSON 采用自建虚拟化树/分块文本只读预览。
- 逻辑和性能敏感操作：**Rust**（serde_json 用于正常 JSON；大文件需要保真 token/索引策略）。
- 持久化：应用专属配置目录 JSON；保密凭据使用 **macOS Keychain**。配置文件不保存明文 Secret。
- 测试：Vitest + React Testing Library（前端）、cargo test（Rust）、Playwright/系统端到端测试。

### 外部依赖治理

固定 Tauri、插件、Rust toolchain 及 npm 依赖版本；生产构建采用 lockfile；对于哈希算法验证固定测试向量。MD5、SHA-1 仅用于对接旧系统的签名兼容，**不应推荐用于现代安全认证**。

## 5. 分层架构

```text
React UI
  ├─ JSON Editor (小文件) / Virtualized Tree (大文件)
  ├─ 时间戳 / 随机数 / 签名 / 设置
  └─ stores + Tauri client (typed commands)
                │ invoke / events
Tauri Rust Commands（入参校验、任务ID、错误映射）
                │
Rust Services
  ├─ JsonSessionManager（parse/index/tree paging/export/cancel）
  ├─ TimeService（时区、Unix 时间）
  ├─ RandomService（OS CSPRNG）
  ├─ SignatureService（template/encoding/digest）
  ├─ ShortcutManager（registration, rollback, dispatch）
  ├─ WindowManager（pin, toggle, bounds）
  └─ SettingsStore / KeychainAdapter
                │
本地文件系统 / macOS Keychain / Window APIs
```

重要约束：**不得把 30 MiB 原文、完整 AST、渲染树和格式化输出同时复制进前端内存**。前端以会话 ID 调用 Rust 命令，树形节点按需获取。对大文件使用基于 token/offset 的索引或受控结构化迭代；性能测试后决定具体索引实现。

## 6. JSON 模块详细设计

### 6.1 两级模式

1. **编辑模式**：小文件，例如 ≤ 2 MiB（阈值由性能实测调整），CodeMirror 完整编辑，格式化/压缩/排序。
2. **大文件模式**：默认只读；Rust 后台解析并索引；虚拟化树，折叠/展开/搜索局部节点；导出到新文件。必要时提供显式“编辑小段内容”，不能把大文件自动装进浏览器输入控件。

### 6.2 处理流程

```text
打开文件/导入剪贴板
  ├─ 小文本：校验 → CodeMirror → 操作 → 结果
  └─ 大文件：Rust 读取（有上限）→ 后台 token/索引 → sessionId
       → 获取 root node → 分页加载子节点 → 虚拟滚动
       → 格式化/压缩/排序（后台流式写临时文件）
       → 完成后原子移动到用户指定路径
```

- `json_open` 返回会话 ID、总大小、根节点摘要、阶段及错误。
- `json_children` 按 parent node ID、offset、limit 返回扁平子节点（含类型、摘要、是否存在子节点）。
- `json_transform` 返回 task ID，后台生成临时输出，通过事件报告阶段、已处理字节、失败或完成路径。
- `json_cancel` 请求取消，Rust 在安全检查点响应并清理临时文件。
- `json_close` 释放索引/缓存/临时文件。

### 6.3 精度、语义与特殊输入

- JSON 对象 Key 排序不能改变数组顺序；键排序指定明确比较规则（建议按 Unicode 标量值的确定性顺序或 UTF-8 字节序，二者选一后写测试）。
- 对大整数/高精度数值及科学计数法，明确为**数值字面量保真**：优先 token/span-based 解析与重写；若初期使用 `serde_json::Value`，必须启用/验证所选数字策略，未经验证不得宣称保真。
- 排序时处理重复 Key：一般 Map 会抹掉重复字段，**不能静默丢失**。设计为输入检测到重复 Key 则拒绝“排序”（格式化/压缩能否保留重复 Key 由 tokenizer 实现保障）；向用户显示错误与位置。
- 对超深嵌套、异常大量节点、巨型单字符串、无效 UTF-8 设置软/硬限制；避免递归爆栈与内存膨胀。
- 解析与导出不修改原文件；采用临时文件和原子保存；磁盘空间不足时展示错误且不覆盖源数据。
- 小 JSON 修改后再次查看会重新建立树快照；大文件查看会话只对应已打开的文件版本。

### 6.4 测试矩阵

| 数据 | 测试内容 |
|---|---|
| 1 MiB | 编辑、复制、格式化、排序 |
| 10 MiB | 树分页、长时间滚动、取消 |
| 30 MiB | 打开、格式化、压缩、排序、导出、窗口交互 |
| 30 MiB 单个长字符串 | 懒展示、防 DOM 卡顿 |
| 100 万+ 小节点（大小受限） | 虚拟列表规模、索引预算 |
| 极深 JSON | 深度限制/明确错误，不崩溃 |
| 超大整数/小数 | 字面量精度保持 |
| 重复 Key / 非法 UTF-8 | 确定性错误处理 |
| 极低可用内存 / 空磁盘 | 操作失败可恢复、不污染源文件 |

目标是**无 UI 主线程长时间冻结、可取消、内存不持续泄漏**；具体首开耗时和峰值 RSS 由目标硬件跑基准后设定，可用活动监视器、Rust profiling、前端 performance panel 记录。

## 7. 时间戳模块

- 模式 A：Unix 秒/毫秒 → 本地/UTC/Asia/Shanghai/Asia/Tokyo 标准时间及 ISO 8601。
- 模式 B：标准时间 + 输入时区 → 秒和毫秒；支持 `YYYY-MM-DD HH:mm:ss` 和 ISO 输入。
- 明确的时区选择优先于推断；自动判断秒/毫秒仅作为便捷选项，并显示选择结果。
- 夏令时无效本地时间需报错，重复本地时间需选择较早或较晚偏移；负数 Unix 时间戳适用。
- 支持“现在”、复制、清除；默认单次点击转换，也可开启自动更新预览。

## 8. 随机字符串模块

- 字符集默认 `[A-Z][a-z][0-9]`；可以勾选符号，或输入自定义字符集覆盖预设。
- 默认 32 字符、5 条；产品建议限制单条 1–4096、数量 1–200、总输出字符数 ≤100,000（配置可调整）。
- Rust 使用 OS 加密安全随机源、无偏采样（rejection sampling）；多字节 Unicode 字符集以字符数组而非 UTF-8 字节采样。
- 输出支持全部复制、单条复制及 `.txt` 文件导出。

## 9. 签名计算模块

### 9.1 配置数据模型

```json
{
  "id": "third-party-a",
  "name": "第三方系统A",
  "algorithm": "MD5",
  "template": "{secret}{timestamp}{fixedStr}",
  "timestamp": {"unit": "milliseconds", "source": "current"},
  "variables": {"fixedStr": "api-v1"},
  "secretRef": "keychain:third-party-a",
  "output": {"encoding": "hex", "case": "lower"}
}
```

### 9.2 计算规则

1. 读取选中模板及变量，secret 从 Keychain 取出（也可使用仅当前会话 secret）。
2. 在计算开始时**只采样一次 timestamp**，除非用户手工输入固定值。
3. 仅允许白名单 `{name}` 变量做字符串替换，检测缺失变量、未知变量、空 Secret 策略。
4. 明确字符串拼接的编码（默认 UTF-8），可配置 Hex 大小写。
5. 计算 MD5/SHA1/SHA256、HMAC-SHA256（HMAC 不等价于“secret+消息”）。
6. 返回 `{timestamp, sign}` 及非敏感诊断；可复制签名、时间戳或 JSON。
7. 默认不记录 secret、完整拼接原文、请求历史；调试选项展示原文时必须显式确认且默认遮蔽 secret。

模板 CRUD 限于本地；可提供导入导出模板，但默认不导出 Secret。

## 10. 快捷键模块

### 10.1 交互与数据

- 点击“快捷键”字段进入录制状态，捕获 `Cmd/Shift/Option/Control + 主键`；Esc 取消、Backspace 清除。
- Action ID 与物理快捷键分离；同一命名空间避免重复注册；记录适用作用域 `global | local`。
- 禁止或警告系统常见保留快捷键；全局注册可能被其他应用占用，**`isRegistered` 只确认本应用是否已注册，不能用来判断其他应用是否占用**。
- 全局变更流程：预校验 → 尝试注册新组合 → 成功才注销旧组合 → 保存配置；失败回滚并提示。
- 应用启动读取配置，逐项注册，展示不能注册的条目；应用退出/禁用时注销。
- App 内监听键盘事件并尊重输入控件焦点，防止在文本输入时误触全局工具操作。

### 10.2 Tauri 集成

官方插件：`@tauri-apps/plugin-global-shortcut`。按项目所需配置 capability 权限，如 `global-shortcut:allow-register` / `allow-unregister`。注册事件时区分按下/释放，避免重复执行。

官方文档：https://tauri.app/plugin/global-shortcut/ ；JS API：https://tauri.app/reference/javascript/global-shortcut/

## 11. 窗口与偏好设置

- `always_on_top`：使用 Tauri Window API，图钉切换；设置中显示当前状态。
- `show/hide/focus`：全局唤起后置前；隐藏而非销毁页面；避免频繁创建窗口。
- `resize/move`：使用普通系统可调整窗口，最小限制 520 × 420；关闭前记忆坐标、大小、屏幕标识。
- 当外接显示器消失时重定位到可见区域，避免窗口“丢失”。
- 主题跟随系统，默认深色；配置集中写入 app config 目录并做版本迁移。
- 本地浏览器 HTML **无法真正置顶、注册系统快捷键、访问 macOS Keychain**，需要在应用中验收。

## 12. Tauri Command API 草案

```ts
interface JsonOpenRequest { path: string }
interface JsonOpenResult { sessionId: string; sizeBytes: number; rootNodeId: string; mode: 'edit'|'large' }
interface JsonChildrenRequest { sessionId: string; nodeId: string; offset: number; limit: number }
interface JsonNode { id: string; key?: string; type: 'object'|'array'|'string'|'number'|'boolean'|'null'; summary: string; hasChildren: boolean; childCount?: number }
interface JsonTransformRequest { sessionId: string; kind: 'format'|'minify'|'sort'; indent?: 2|4|'tab'; sortDirection?: 'asc'|'desc'; destination: string }
interface TaskStartResult { taskId: string }
interface TaskProgress { taskId: string; phase: string; bytesProcessed?: number; bytesTotal?: number; done: boolean; error?: string }
interface SignatureComputeRequest { templateId?: string; algorithm: string; template: string; variables: Record<string,string>; timestampMode: 'seconds'|'milliseconds'|'fixed'; timestamp?: string }
interface SignatureComputeResult { timestamp: string; sign: string }
interface ShortcutBinding { actionId: string; scope: 'global'|'local'; accelerator: string; enabled: boolean }
```

Rust Commands（建议）：

- `json_open`, `json_children`, `json_transform`, `json_cancel`, `json_close`
- `time_to_unix`, `unix_to_time`
- `random_generate`
- `signature_compute`, `templates_list`, `templates_save`, `templates_delete`
- `shortcuts_list`, `shortcuts_update`, `shortcuts_reset`
- `window_toggle`, `window_set_always_on_top`, `settings_get`, `settings_update`

所有路径/模板/长度等字段在 Rust 层二次校验，错误采用稳定错误码，例如 `JSON_INVALID`、`LIMIT_EXCEEDED`、`SHORTCUT_CONFLICT`、`DISK_FULL`、`SIGNATURE_VAR_MISSING`。

## 13. 项目结构

```text
devkit/
├── src/
│   ├── app/
│   ├── components/{layout,common}/
│   ├── features/{json,time,random,signature,settings}/
│   ├── services/tauri-api.ts
│   ├── stores/
│   └── styles/
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   ├── services/{json,time,random,signature,shortcuts}/
│   │   ├── storage/{settings,keychain}/
│   │   ├── window/
│   │   └── lib.rs
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/{fixtures,e2e,benchmarks}/
├── package.json
└── README.md
```

## 14. 开发顺序与里程碑

| 阶段 | 交付 | 退出条件 |
|---|---|---|
| M0 工程骨架 | Tauri React 项目、布局、主题、基础 IPC、权限 | macOS dev 正常启动 |
| M1 JSON 引擎 | 小文件编辑、大文件会话、树索引、异步转化、取消、导出 | 30 MiB 基准测试通过 |
| M2 基础工具 | 时间戳、随机字符串及其 UI | 边界条件测试通过 |
| M3 签名工具 | 模板、Keychain、算法、复制 | 兼容测试向量通过 |
| M4 桌面体验 | 置顶、尺寸记忆、全局/局部快捷键录制及冲突回滚 | 重启、外接屏、快捷键冲突实测通过 |
| M5 发布 | App icon、DMG、安装说明、回归报告 | 全新 Mac 用户目录完成安装与启动 |

## 15. 构建与 DMG 安装

在 macOS 上准备 Xcode Command Line Tools、Rust、Node.js；使用 `npm create tauri-app@latest` 初始化时选 React + TypeScript，然后替换为模块化工程。

```bash
npm install
npm run tauri dev

# 添加插件（按实际所需启用）
npm run tauri add global-shortcut

# 打包 DMG
npm run tauri build -- --bundles dmg
```

通常输出于 `src-tauri/target/release/bundle/dmg/`。打开 DMG，拖 `DevKit.app` 到 Applications。开发自用可以先采取本地构建；未签名/未公证的下载或传输应用可能遇到 Gatekeeper 安全拦截。对他人分发时再配置 Developer ID 签名和 Apple 公证。Apple Silicon 与 Intel 分别编译或视需求提供 Universal 构建。

Tauri macOS 分发官方文档：https://tauri.app/distribute/dmg/ ；官方全局快捷键文档：https://tauri.app/plugin/global-shortcut/ 。

## 16. 完成定义（Definition of Done）

- [ ] 30 MiB 复杂 JSON 测试（含深嵌套/长字符串/大量节点）通过或对超限制文件给出可恢复提示。
- [ ] JSON 输出合法，数字字面量保真；数组顺序不变；重复 Key 不被静默丢弃。
- [ ] 解析、变换、导出时界面能拖动/点击，可取消任务，临时文件正确清理。
- [ ] 时间戳双向转换经过时区、负数时间戳、夏令时测试。
- [ ] 随机字符串抽样无明显偏差，输入边界受限。
- [ ] 签名结果与测试向量/第三方已知样本一致；timestamp 不漂移，Secret 安全存储。
- [ ] 全局快捷键即使窗口隐藏仍可唤起，冲突可诊断、修改可回滚。
- [ ] 窗口置顶/缩放/位置保存正常，应用重启后配置保持。
- [ ] DMG 安装成功；离线运行，不访问业务网络；隐私信息不落日志。
- [ ] 使用 README 说明安装、快捷键、运行限制、数据存储与故障排查。

## 17. 原型与正式产品差异

随文 HTML 原型是无需安装的独立文件，供确认功能布局和交互。它的 JSON 操作采用浏览器 `JSON.parse`/`JSON.stringify`，**不能保证大整数、重复 Key 与 30 MiB 内存表现**；为了避免浏览器卡顿限定 2 MiB 输入和约 750 个树节点。签名演示使用页面内 MD5 及浏览器 Web Crypto 计算 SHA，模板持久化在当前浏览器 `localStorage`，**不存 Secret**。快捷键录制能保存，但不进行系统全局注册；“置顶”按钮仅模拟状态。生产验收必须使用真正的 Tauri + Rust 版本。
