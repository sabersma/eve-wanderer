# Wanderer Desktop

Windows 10/11 桌面客户端（Tauri 2 + 系统 WebView2）。它不复制地图逻辑：每个窗口加载现有 Phoenix LiveView 页面（`/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget`），因此地图数据、SSO 用户、订阅规则、读写权限与 Web 端完全一致。

设计说明见 [`../docs/desktop-client.md`](../docs/desktop-client.md)；
打包与成员使用流程见 [`../docs/desktop-release-and-usage.md`](../docs/desktop-release-and-usage.md)。

## 目录

```
desktop/
├── package.json              # Tauri CLI 入口
├── web/index.html            # 首次启动的服务器地址设置页
├── scripts/                  # build.ps1（Windows 打包）与 sync-to-windows.sh（WSL 同步）
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs            # 命令注册、应用状态、原生菜单
        ├── config.rs         # 服务器地址校验与持久化
        ├── windows.rs        # 主窗口 / 独立小窗口 / 设置窗口
        └── eve_watcher.rs    # Win32 前台窗口监听（仅 Windows）
```

## 环境要求

- Windows 10/11，已安装 WebView2 Evergreen Runtime（Win11 自带，Win10 通常已随 Edge 安装）。
- Node.js 20+、Rust stable、Visual Studio Build Tools（C++ 桌面开发 + Windows SDK）。
- 可访问的 Wanderer 服务端。

## 开发

```powershell
cd desktop
npm install

# 可选：开发时跳过首次启动的设置页（Phoenix dev 默认端口 4444）
$env:WANDERER_SERVER_URL = "http://localhost:4444"
npm run dev
```

不设置环境变量时，客户端第一次启动会显示服务器地址设置页；保存后地址会写入本机配置，之后直接进入地图选择。

### 从 WSL 同步 `desktop/`

如果代码主要在 WSL 中编辑、只在 Windows 上编译，不需要 git push/pull，只同步这一层即可：

```bash
desktop/scripts/sync-to-windows.sh            # 默认同步到 /mnt/d/work/win/github/sabersma/eve-wanderer/desktop/
desktop/scripts/sync-to-windows.sh --dry-run  # 先看会改哪些文件
```

`node_modules` 和 `src-tauri/target` 不会同步，Windows 端保留自己的副本；`tauri dev` 检测到变化会自动重编。改 `assets/`、`lib/` 等地图页面时不需要运行这个脚本，它们由 Phoenix 提供。

SSO 登录沿用页面的会话 Cookie。所有窗口共享同一个 WebView2 用户数据目录，所以主窗口登录后，小窗口不需要再次登录。

桌面窗口未登录时不会经过 Web 的欢迎页：`/desktop` 系列路由的 `ensure_authenticated_desktop` 直接跳到
`/auth/eve?desktop=1`，服务端用 session 记录来源，回调成功后回到 `/desktop`（Web 登录仍回 `/characters`）。

## 服务器地址

首次启动时填写的地址会保存到：

```text
%APPDATA%\<应用标识>\config.json
```

内容形如：

```json
{
  "server_url": "https://wanderer.example.com",
  "ui_scale": 1.0,
  "widget_opacity": 1.0,
  "widget_always_on_top": { "kills": true },
  "window_sizes": {
    "signatures": { "width": 380.0, "height": 560.0, "x": 120.0, "y": 80.0 }
  }
}
```

- `ui_scale`：WebView2 缩放比例（0.5–2.0），由主地图右上角工具条的「缩放 − / + / 重置所有窗口缩放」修改，
  快捷键 `Ctrl+=` / `Ctrl+-` / `Ctrl+0`。
- `window_sizes`：每个小窗口最后一次的大小和位置（物理像素），重新打开时恢复；换显示器或分辨率后，落不到任何屏幕上的位置会被丢弃（窗口居中打开）。
- `widget_opacity`：小窗口整体不透明度（0.3–1.0），由主地图工具条或小窗口顶栏的「透明」滑杆修改。
- `widget_always_on_top`：每个挂件窗口的置顶状态，重新打开该窗口时恢复。

规则：

- 仅接受 `https://`；本机开发可用 `http://localhost` / `http://127.0.0.1`。
- 可以直接输入 `example.com`，会自动补全 `https://`。
- 支持部署在子路径下，例如 `https://example.com/wanderer`。
- 地址只能通过设置页修改，修改后会自动关闭旧服务器的小窗口并重新加载主窗口。

修改入口：

- 主地图右上角「服务器」按钮；
- 窗口顶部原生菜单「服务器设置…」——即使当前服务器打不开、页面加载失败，也能通过它改回正确地址。

开发时如果设置了 `WANDERER_SERVER_URL`，它优先于本机保存的地址，不会改写配置文件。

## 界面缩放与窗口尺寸

**界面缩放**（字体、间距、地图一起缩放，不会出现字大了行高没变）：

- 主地图右上角工具条的「缩放」区域：`−` / `+` 每次 10%，中间显示当前比例，
  「重置所有窗口缩放」一键回到 100%；
- 所有桌面窗口（含小窗口）都支持快捷键 `Ctrl+=` / `Ctrl+-` / `Ctrl+0`；
- 缩放设置只显示在主地图窗口：小窗口顶栏不再有缩放设置，原生菜单也只剩「服务器设置…」；
  透明度不在此列——小窗口顶栏仍然保留「透明」滑杆，可在原窗口直接调节；
- 点击小窗口后按快捷键缩放的是所有窗口，因为它们共用同一 `ui_scale`；
- 范围 50%–200%，立即应用到所有已打开的窗口；
- 保存在 `config.json` 的 `ui_scale`，新打开的窗口和小窗口都会沿用，重启客户端后保持。
- 没有启用 WebView2 自带的 Ctrl+滚轮缩放：它只改当前窗口且不保存，会和工具条设置的统一缩放不一致。

**小窗口尺寸**：

- 每个小窗口可以直接拖拽缩放和移动，关闭后按 widget 类型记住（`window_sizes`），下次从主图或切换菜单打开时恢复；
- 首次打开使用默认尺寸（见下方列表）；
- 保存的是物理像素，换到不同 DPI 的显示器时会按目标显示器的缩放比例换算；位置如果不在任何显示器上，会改为居中打开。
- 主地图窗口和服务器设置窗口暂不记忆尺寸。

## 小窗口透明度

五个独立小窗口可以整体调透明度，方便压在地图或游戏画面上查看：

- 入口：主地图工具条的「透明」滑杆，以及每个小窗口顶栏的「透明」滑杆（两处调的是同一个值）；
  范围 0%–70%（0% = 完全不透明，70% = 只剩 30% 不透明度），默认 0%，步进 5%；
- 透明度作用于**整个原生窗口**：标题栏、边框、顶栏、表格和文字一起变淡，不会出现
  “只有底色变了、内容还是实心”的情况；窗口内页面本身保持完全不透明；
- 所有小窗口共享同一设置，拖动后其他已打开的小窗口同步变化；
- 保存在 `config.json` 的 `widget_opacity`，新打开的小窗口直接以该透明度显示，重启后保持；
- 页面就绪时（`desktop_ready`）会用 `config.json` 的值同步滑杆，并回写 `localStorage`，
  所以旧版本缓存的过期值不会让滑杆显示和窗口实际透明度不一致；
- 主地图窗口始终不透明。

实现：`windows.rs` 的 `apply_widget_opacity` 给窗口加 `WS_EX_LAYERED`，再用
`SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)` 统一淡出整个窗口（与 Electron
`win.setOpacity` 相同的做法）。窗口保留原生标题栏、边框和 DWM 阴影，最小化/最大化/关闭/边缘缩放
都是系统行为；顶栏空白处仍可直接拖动窗口，右侧「×」仍可关闭当前窗口（按钮、滑杆、复选框可正常点击）。

早期版本尝试过 `.transparent(true)` + `.no_redirection_bitmap(true)` + CSS `opacity`：Windows 上
WebView2 逐像素透明必须关掉重定向位图，这会丢失系统标题栏/边框，而且页面会合成到白色背景上
（越透明越白），因此改为窗口级 alpha。

已知限制：透明度仅在 Windows 生效（WSL/Linux 开发时滑杆只改配置，窗口外观不变）；EVE 独占
全屏时浮窗仍可能被挡住；`WS_EX_LAYERED` 让窗口走重定向位图合成，个别驱动/远程桌面下可能有
性能开销，遇到时可把透明度调回 0%（alpha 255 等同不透明）。

## 已有的窗口与命令

窗口：

- `main`：`/desktop`（地图选择）→ `/desktop/:slug`（订阅模式的精简地图）。
- `widget-<slug>-signatures`：`/desktop/:slug/widget/signatures`（380 × 560）
- `widget-<slug>-jspace`：`/desktop/:slug/widget/jspace`（360 × 420）
- `widget-<slug>-bookmarks`：`/desktop/:slug/widget/bookmarks`（440 × 560）
- `widget-<slug>-kills`：`/desktop/:slug/widget/kills`（720 × 460）
- `widget-<slug>-characters`：`/desktop/:slug/widget/characters`（340 × 460）

尺寸在 `src-tauri/src/windows.rs` 的 `default_widget_size` 里维护（首次打开的默认值，之后按用户调整过的大小恢复）；
新增 widget 时这里和 `lib/wanderer_app_web/live/map/map_live.ex` 的 `@desktop_widgets` 都要补。
窗口内切换挂件只替换内容，不重建窗口，用户调整过的大小和界面缩放都会保留。

页面通过 `window.__TAURI__.core.invoke` 调用：

| 命令 | 作用 |
| --- | --- |
| `desktop_ready` | 页面就绪，返回客户端版本、最后一次 EVE 前台信息、当前透明度、界面缩放和窗口置顶状态 |
| `get_server_url` | 读取已保存的服务器地址（设置页使用） |
| `set_server_url` | 校验并保存地址，然后跳转主窗口 |
| `open_server_settings` | 打开服务器设置窗口 |
| `open_widget` | 打开/聚焦独立小窗口（恢复上次的尺寸、透明度和置顶） |
| `open_main` | 打开/聚焦主地图窗口 |
| `close_self` | 关闭当前窗口 |
| `set_always_on_top` | 小窗口置顶，并按挂件类型缓存到 `config.json`（仅 Windows 生效；WSLg/GTK Wayland 会忽略） |
| `set_window_title` | 更新窗口标题（系统名/角色名） |
| `set_widget_opacity` | 设置并保存小窗口整体透明度，立即应用到所有小窗口 |
| `zoom_in` / `zoom_out` / `zoom_reset` | 放大/缩小/重置所有窗口的界面缩放，返回实际比例 |

页面来自远程服务器，Tauri 对**远程 origin 的自定义命令**有额外 ACL 限制：命令必须声明在 `build.rs` 的 `AppManifest` 里，并在 `capabilities/default.json` 中授予生成的 `allow-<命令>` 权限。两者缺一，`invoke` 会被拒绝，按钮看起来“点了没反应”。新增命令时两处都要改。

**创建窗口的命令必须写成 `async fn`**。Windows 下在同步命令或菜单等事件回调里调用 `WebviewWindowBuilder::build()` 会死锁，表现是新窗口（以及整个应用）一直“未响应”。菜单回调创建窗口时要放到独立线程（见 `lib.rs` 的 `on_menu_event`）。

页面里的外链（zkillboard、dotlan、anoik、J-Space Helper 等 `window.open` / `target="_blank"`）由 `windows.rs` 的 `on_new_window` 交给系统默认浏览器打开。wry 在没有处理器时会拒绝所有新窗口请求，删掉它这些按钮就会“点了没反应”。

## 使用上报与更新提示

布局 hook `assets/js/hooks/desktopShell.ts` 挂在 `Layouts.desktop` 根元素上，每个窗口挂载时：

1. 调用 `desktop_ready` 取版本号（`env!("CARGO_PKG_VERSION")`），
2. `pushEvent("desktop_heartbeat", { install_id, version, platform })` —— 服务端按
   `install_id` upsert，多开窗口只算一个安装；
3. 拉取 `/desktop/update.json`，发现新版本时在主窗口提示成员去 Q 群共享下载。

网页版没有 Tauri invoke 桥，hook 直接跳过。服务端默认把**编译时从
`src-tauri/tauri.conf.json` 读到的版本**作为最新版本（Dockerfile 会把该文件拷进构建阶段，
`WandererApp.Env` 用 `@external_resource` 编进 release）；需要时用
`WANDERER_DESKTOP_LATEST_VERSION` 覆盖，`WANDERER_DESKTOP_UPDATE_NOTES` 作为更新说明。
管理员统计页为 `/admin/desktop`；细节见
[`../docs/desktop-client.md`](../docs/desktop-client.md) 的 7.7 节和
[`../docs/desktop-release-and-usage.md`](../docs/desktop-release-and-usage.md) 的发版手册。

## EVE 跟随

`eve_watcher.rs` 使用 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` 监听前台窗口，只在进程名为 `exefile.exe` 时记录窗口标题，不会读取 EVE 日志或文件。React 侧把标题与地图中已加载的角色名匹配，再用服务端已跟踪的角色位置得到星系。

因此：

- 如果尚未激活过 EVE 客户端，独立窗口会回退到主地图当前选中的星系；两者都没有时，信号窗口会直接提示原因，而不是让“添加信号”点击后没有任何反应。
- 点击客户端窗口不会清除“最后激活的 EVE 客户端”，只是不再更新。
- 位置来自服务端角色位置轮询，通常有 2–5 秒延迟。
- 如果 EVE 以独占全屏运行，浮窗可能无法显示；建议使用无边框窗口模式。

## 打包与分发

逐步操作手册（含成员安装/使用、故障排查）见
[`../docs/desktop-release-and-usage.md`](../docs/desktop-release-and-usage.md)。

### 1. 先部署服务端

客户端本身不含地图页面，所有窗口都加载 Wanderer 服务端。因此分发安装包之前，必须先把包含以下内容的版本部署到正式服务器：

- `/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget` 路由；
- 重建后的 `priv/static/assets`（`cd assets && npm run build`）；
- 可被成员访问的 HTTPS 地址和有效的 EVE SSO 回调配置。

如果成员连接的是同一台服务器，这一步只需要做一次。

### 2. 打包（不需要写死服务器地址）

同一个安装包可以发给所有成员。每个成员第一次启动时填写服务器地址，保存在自己的 `%APPDATA%` 下，互不影响。

Windows 上推荐直接运行打包脚本，它会检查环境、执行 `npm install` + `npm run build`，
把安装包复制到 `desktop\dist\v<版本>\`、生成 `SHA256SUMS.txt`，并默认把安装包和
校验文件打包成 `desktop\dist\Wanderer_<版本>_x64.zip`：

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

等价的手动命令：

```powershell
cd desktop
npm install
npm run build
```

脚本参数：`-SkipInstall`（跳过依赖安装）、`-Clean`（先 `cargo clean`）、
`-NoDist`（只构建不复制）、`-NoZip`（不生成 zip）、`-OutputDir D:\release`（自定义分发包目录）。

不要为发布构建设置 `WANDERER_SERVER_URL`；该变量只在运行时生效，用于开发时跳过设置页，
不会写进安装包。打包脚本检测到非空值会拒绝构建。

### 3. 产物

Tauri 原始产物：

```text
desktop/src-tauri/target/release/bundle/
├─ nsis/Wanderer_0.1.0_x64-setup.exe   # 推荐发给成员
└─ msi/Wanderer_0.1.0_x64_en-US.msi    # 需要 MSI 分发时使用
```

`build.ps1` 整理后的分发包：

```text
desktop/dist/
├─ v0.1.0/
│  ├─ Wanderer_0.1.0_x64-setup.exe
│  ├─ Wanderer_0.1.0_x64_en-US.msi
│  └─ SHA256SUMS.txt
├─ Wanderer_0.1.0_x64.zip             # 默认生成，推荐直接分发这个
└─ Wanderer_0.1.0_x64.zip.sha256      # 压缩包自身的 SHA256
```

zip 内包含 NSIS 安装包、MSI（如果构建出）和 `SHA256SUMS.txt`。不需要 zip 时加 `-NoZip`。

Tauri 不提供“单文件绿色版”。`target/release/wanderer-desktop.exe` 依赖 WebView2 运行时和同目录资源，直接拷贝这个 exe 不可靠；请分发安装包。

WebView2 使用 `downloadBootstrapper`：Win11 自带，Win10 若缺失会由安装程序联网安装。需要完全离线安装时，改成 `embedBootstrapper` 或 `offlineInstaller`，安装包会明显变大。

### 4. 代码签名（可选但强烈建议）

未签名的安装包会触发 Windows SmartScreen（“Windows 已保护你的电脑”），成员需要点“更多信息 → 仍要运行”。对外分发建议：

- 购买代码签名证书（OV/EV）或使用 Azure Trusted Signing；
- 在 `tauri.conf.json` 的 `bundle.windows` 配置证书指纹或 `signCommand`；
- 签名后再上传发布。

内部小范围使用可以先不签名，但要提前告知成员如何绕过提示。

### 5. 版本与发布

- 同时修改 `desktop/src-tauri/tauri.conf.json`（安装包文件名以它为准）、
  `desktop/package.json` 和 `desktop/src-tauri/Cargo.toml` 的 `version`；
- 安装包文件名会带上版本号；
- 自动更新（`tauri-plugin-updater`）、托盘、单实例、窗口位置持久化尚未接入，属于 P1。

### 6. 发布检查清单

- [ ] 服务端已部署桌面路由与最新前端资源
- [ ] 服务端 HTTPS 证书有效，成员可直接访问
- [ ] 安装包未设置 `WANDERER_SERVER_URL`，首次启动会出现设置页
- [ ] 在干净的 Windows 10/11 上安装，输入地址并完成 SSO 登录
- [ ] 断网或输错地址后，可通过原生菜单「服务器设置…」改回
- [ ] 打开五个独立窗口（信号/JSpace/位标/KM/成员），确认置顶、跟随、关主窗口后仍存活
- [ ] 关闭其中一个置顶的小窗口再打开，置顶状态恢复；重启客户端后仍保持
- [ ] 主地图工具条缩放后所有窗口同步变化，重启客户端后仍保持；小窗口内 `Ctrl+=` / `Ctrl+-` / `Ctrl+0` 也可缩放
- [ ] 点击「重置所有窗口缩放」后所有窗口回到 100%
- [ ] 调整某个小窗口大小/位置后关闭再打开，尺寸恢复；换显示器后不会跑到屏幕外
- [ ] 拖动主地图工具条或任意小窗口顶栏的「透明」滑杆，小窗口整个窗口（标题栏/边框/顶栏/列表/文字）一起变透明并透出地图/桌面；重启后保持，其他小窗口同步，主地图窗口不变
- [ ] 小窗口顶栏仍有「透明」滑杆，但不再有缩放菜单；原生菜单只有「服务器设置…」
- [ ] 小窗口原生标题栏/边框/最小化/关闭/边缘缩放正常，DWM 阴影可见
- [ ] 版本号与发布说明已更新

## 当前边界

- 仅 Windows。其他平台能编译但 EVE 跟随不可用。
- 置顶同样只在 Windows 生效：WSLg 的 GTK/Wayland 没有 keep-above，开发时点击置顶看起来“没反应”属于环境限制，需在 Windows 实机验证。
- 主地图窗口不显示 Web 端保存的挂件布局；信号/J空间/位标/KM/成员只在独立窗口中出现，路线、建筑、评论等其他挂件暂未提供独立窗口。
- 界面缩放只作用于客户端窗口，不影响 Web 端浏览器里的页面；主地图窗口尺寸仍固定，只有小窗口会记住大小和位置。
- 透明度只作用于五个小窗口，主地图窗口保持不透明；窗口保留原生标题栏和边框；
  透明度仅在 Windows 生效，EVE 独占全屏下浮窗仍可能无法显示。
- SSO 在 WebView2 内嵌登录遇到服务端限制时，需要回退到系统浏览器 + loopback 回调（设计文档中的 P0 风险项，尚未实现）。
- 订阅模式下新增/删除星系与 Web 完全一致，客户端没有任何绕过。
