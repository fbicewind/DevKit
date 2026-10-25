# DevKit

基于 Tauri 2、React、TypeScript 和 Rust 的 macOS 离线开发者工具箱。界面根据 [交互原型](doc/DevKit-交互原型.html) 实现，产品范围见 [开发方案](doc/DevKit-开发方案.md)。应用运行时不请求业务网络，不上传输入、文件或 Secret。

## 开发与构建

需要 macOS 12+、Xcode Command Line Tools、Node.js 22.18+ 和 Rust。仓库通过 `.nvmrc`、`rust-toolchain.toml`、精确依赖版本和两个 lockfile 固定构建依赖。

```sh
nvm use
npm ci
npm run tauri dev
```

如果终端没有 `cargo`，先安装 [Rust](https://www.rust-lang.org/tools/install)，再将 `$HOME/.cargo/bin` 加入 PATH。Rustup 会根据仓库配置安装 Rust 1.90.0。

```sh
npm run tauri build -- --bundles app,dmg
```

Apple Silicon 的安装包位于 `src-tauri/target/release/bundle/dmg/`，应用位于 `src-tauri/target/release/bundle/macos/DevKit.app`。打开 DMG 后将应用拖到 Applications。构建默认采用本机架构和本地 ad-hoc 签名；对外分发需要 Developer ID 签名与公证。Intel 构建需另装 `x86_64-apple-darwin` target，再使用 `--target x86_64-apple-darwin`。

`npm run dev` 只提供浏览器界面预览，会明确显示预览标记；计算、钥匙串、文件、全局快捷键和窗口功能必须在 Tauri 应用内使用。

## 功能与使用

- **JSON**：打开文件、导入剪贴板、编辑、定位校验错误、2/4 空格或 Tab 格式化、压缩、递归升降序排序、复制、导出、按需节点展开和折叠。修改后点击“校验并刷新树”；变换完成会更新树快照。
- **时间戳**：秒、毫秒和自动判断，支持负值及小数秒，精度为毫秒；标准日期、ISO 8601 双向转换，支持本地及常用 IANA 时区。无偏移日期按所选时区解释；ISO 自带偏移表示绝对时刻。夏令时不存在的本地时间会报错，歧义时间可选择较早或较晚时刻。
- **随机字符串**：大小写、数字、符号及自定义 Unicode 字符集，自动去重；操作系统 CSPRNG 与无偏整数区间采样。单条 1–4096 字符、1–200 条、总计不超过 100,000 字符，支持逐条复制、全部复制、TXT 导出。
- **签名**：MD5、SHA1、SHA256、HMAC-SHA256；白名单变量替换；一次计算只采样一次时间戳；手动时间戳、Hex 大小写及 Base64；本地模板新建、修改、删除。Secret 默认仅在内存中，勾选后保存到 macOS Keychain；配置文件只保存引用。HMAC 的 Secret 是密钥，消息来自公式，两者独立。不会显示完整拼接原文或记录请求历史。
- **桌面**：原生 macOS 标题栏按钮、拖动和缩放、置顶、窗口位置与尺寸记忆、断开外接屏后的可见区域恢复、紧凑侧边栏、深浅色及跟随系统主题。
- **快捷键**：支持修改作用域、录制、清除、冲突检测和恢复默认；全局注册失败会提示。配置更新先尝试注册新组合，失败时保留旧组合与配置。关闭窗口时，如仍有可用全局唤起组合，隐藏应用；通过菜单“退出 DevKit”结束进程。

| 操作             | 默认组合        | 作用域                    |
| ---------------- | --------------- | ------------------------- |
| 显示 / 隐藏窗口  | Option + Space  | 全局                      |
| 打开 JSON 工具   | Cmd + Shift + J | 全局                      |
| 格式化 JSON      | Cmd + Enter     | 应用内；JSON 编辑器也可用 |
| 复制当前工具结果 | Cmd + Shift + C | 应用内                    |
| 计算签名         | Cmd + Shift + S | 应用内                    |
| 窗口置顶         | Cmd + Shift + P | 应用内                    |

快捷键录制使用物理字母键，因此 Option 改变输入字符时仍能正确识别。应用内操作尊重输入控件焦点；Esc 退出录制，Backspace 清除。全局组合可能被其他应用占用，打开设置重新录制即可。

## 大 JSON 的实现和边界

Rust 自建严格 JSON tokenizer 和扁平 span 索引，原始数字、字符串转义和重复字段均保留，不经过 JavaScript `JSON.parse` 或浮点数。Key 按**解码后的 UTF-8 字节序**比较，数组顺序始终不变。重复 Key（包括 `"a"` 与 `"\u0061"`）会拒绝排序并给出位置，格式化与压缩保留所有字段。

- 编辑模式上限 **2 MiB**。使用 CodeMirror；格式化膨胀后超过编辑上限时，可用“导出”直接写入文件。
- 大文件通过原生文件对话框或“粘贴”按钮导入，不会加载到浏览器输入框。前端只持有会话 ID、短摘要和已请求的节点页。
- 文件上限 **64 MiB**，最多 **1,500,000 个值节点**，嵌套深度最多 **128**。超出任何上限会返回 `LIMIT_EXCEEDED`，应用继续可用。索引向量按固定批次申请内存，节点结构不复制值文本；最多同时保留两个快照，界面更新后主动释放旧会话。
- 子节点每页最多 500，界面每次取 200；仅渲染视口内的树行。批量按深度展开有约 2,000 个节点的加载预算，其余可手动展开、分页加载。长字符串或 Key 仅展示短摘要。
- 读文件、解析、变换和导出在后台工作线程运行；任务提供阶段、已处理字节与取消。索引进度代表扫描位置，导出进度代表已写出的原文片段字节，均不是精确剩余时间。
- 输出逐节点写入目标目录的临时文件，成功后原子替换目标；失败或取消会清除临时文件。**不能覆盖已打开的源文件**，避免污染原始数据。
- 错误位置包含行与列；不接受 BOM、非 UTF-8、无效 Unicode 代理对或 JSON 注释。约束偏向开发数据，避免异常输入引起递归溢出或无界节点分配。

## 数据存储

设置和模板位于 `~/Library/Application Support/com.devkit.local/settings.json`，通过限制权限的临时文件原子写入。不保存工具输入、JSON 文件内容、计算历史或 Secret。损坏或不支持的配置会先备份为 `settings.invalid-<timestamp>.json`，再使用默认配置，并在界面提示。

钥匙串条目的服务名为 `com.devkit.local`，账户名为模板 UUID。选中已保存模板后，Secret 留空会读取其钥匙串值；可输入临时 Secret 覆盖本次计算。勾选“移除已存 Secret”并保存可单独删除凭据；删除模板也会删除关联凭据。

## 验证

```sh
npm run build
npm test
npm run test:rust
npx playwright install chromium
npm run test:e2e
npm run bench:json
```

Rust 测试覆盖保真变换、重复 Key、数组顺序、严格语法、深度限制、分页、原子导出与取消、负数时间戳、DST 跳变/歧义、Unicode 随机字符及 MD5/SHA1/SHA256/RFC 4231 HMAC 向量。30 MiB 基准会构造精确 31,457,280 字节的数据，测试打开、分页、三种变换导出并重新校验，以及 30 MiB 单字符串的短摘要和导出。

前端单元测试覆盖物理键录制；Playwright 测试覆盖页面切换、输入保留、录制取消、边界校验和 520×420 最小布局。浏览器测试不能替代系统全局快捷键、钥匙串或真实窗口测试。当前验证结果和限制记录在 [验收记录](doc/验收记录.md)。

## 故障排查

- 全局快捷键不可用：设置页会显示失败项，更换组合后保存；`is_registered` 只检查本应用已注册的组合，不用于探测其他应用。
- 钥匙串拒绝访问：检查系统权限并重新输入 Secret。应用不会降级为明文存储。
- 输出超过编辑上限：点击导出；输入和现有快照保持可用。
- 文件超限或磁盘写入失败：错误会在工作区显示，选择较小数据或新的输出路径重试。
- 关闭窗口后找不到应用：使用全局组合唤起，或点击 Dock 图标；通过系统应用菜单退出。

Tauri 集成参考 [全局快捷键](https://tauri.app/plugin/global-shortcut/) 与 [macOS DMG 分发](https://tauri.app/distribute/dmg/)。
