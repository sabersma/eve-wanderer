# Wanderer 桌面客户端（Windows）设计与开发说明

> 状态：P0 已实现，待 Windows 实机验证（Rust 部分未在当前 WSL 环境编译）
> 目标平台：Windows 10 / 11
> 服务端：现有 Phoenix 应用（不新增独立数据服务）

## 1. 目标与边界

### 1.1 目标

为现有 Wanderer 地图提供一个 Windows 桌面壳：

- 使用与 Web 相同的 EVE SSO 用户体系。
- 使用同一套地图数据、权限、订阅与实时事件。
- 地图渲染复用现有 React Flow 地图，不重写渲染层。
- 支持将信号、J空间、本地位标、KM、星系成员等小组件拆成独立窗口。
- 信号窗口支持跟随“最后激活的 EVE 客户端”的角色所在星系。
- 支持 P1 范围内的地图写操作：星系编辑、连线增删改、信号增删改。
- 主窗口关闭后，独立小组件窗口继续存在。

### 1.2 非目标（P1 不做）

- 完整的 ACL、审计、评论、路线、建筑、Ping、订阅购买等复杂管理功能。
- 独立的数据服务或第二套数据库。
- 读取 EVE 客户端日志、文件、内存。
- 与 Web 完全一致的所有边缘功能。
- 独占全屏 EVE 下的悬浮覆盖（建议 EVE 使用无边框窗口模式）。

## 2. 总体架构

采用 **Tauri 2 + WebView2 多窗口**：

```text
┌─────────────────────────────────────────────────────────────┐
│ Tauri 进程（Windows）                                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ main window  │  │ widget window│  │ widget window│       │
│  │ /desktop/:s  │  │ /widget/sig  │  │ /widget/kill │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│         └────────── 共享 WebView2 配置目录 ──┘               │
│                     （共享 SSO Cookie）                      │
│                                                             │
│  Rust：窗口管理 / 托盘 / EVE 前台监听 / 桥接                  │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS / WebSocket
┌─────────────────────────────▼───────────────────────────────┐
│ 现有 Phoenix 应用                                           │
│  - LiveView 页面（/desktop、/desktop/:slug、widget 路由）    │
│  - MapLive / MapEventHandler / Map GenServer                │
│  - 现有权限、订阅、Presence、PubSub                          │
└─────────────────────────────────────────────────────────────┘
```

关键结论：

- **不新增桌面 API、Token、Channel**。每个窗口加载服务端渲染的 LiveView 页面，使用现有命令处理器。
- **不新增数据服务**。桌面与 Web 读写同一套 PostgreSQL 和同一个 Map GenServer。
- Rust 只做窗口、托盘、EVE 前台监听和页面桥接，不参与地图业务逻辑。
- 多窗口各自持有 LiveView socket；角色追踪的清理由权限变化驱动，Presence 有 15 分钟宽限期，因此主窗口关闭后 widget 窗口可以继续工作。

## 3. 目录结构

```text
eve-wanderer/
├─ docs/
│  ├─ desktop-client.md              # 本文档
│  └─ desktop-release-and-usage.md   # 打包与成员使用手册
├─ lib/
│  └─ wanderer_app_web/
│     ├─ live/
│     │  ├─ desktop/
│     │  │  ├─ desktop_live.ex       # /desktop 地图选择
│     │  │  └─ desktop_live.html.heex
│     │  └─ map/
│     │     ├─ map_live.ex           # 增加 :desktop / :widget action
│     │     └─ map_live.html.heex    # data-desktop / data-widget
│     └─ components/layouts/
│        └─ desktop.html.heex        # 桌面布局（无 Web 侧栏）
├─ assets/
│  └─ js/hooks/Mapper/
│     ├─ desktop/
│     │  ├─ bridge.ts                # 页面 ↔ Rust 桥
│     │  ├─ useDesktopBridge.ts      # 外部 store hook
│     │  ├─ useDesktopActiveSystem.ts
│     │  ├─ resolve.ts               # 纯匹配函数（避免循环依赖）
│     │  ├─ DesktopMainBar.tsx       # 主地图：独立窗口入口、缩放、透明度
│     │  ├─ DesktopWidgetBar.tsx     # 小窗口工具条：跟随状态/置顶/透明/切换
│     │  ├─ useDesktopZoomShortcuts.ts # Ctrl+= / Ctrl+- / Ctrl+0
│     │  └─ types.ts
│     ├─ index.tsx                   # 读取 data-*，初始化 bridge
│     ├─ components/mapRootContent/MapRootContent.tsx
│     ├─ components/mapWrapper/MapWrapper.tsx
│     ├─ mapRootProvider/MapRootProvider.tsx
│     └─ components/mapInterface/widgets/...
└─ desktop/
   ├─ README.md
   ├─ package.json
   ├─ web/index.html                 # 首次启动的服务器地址设置页
   └─ src-tauri/
      ├─ Cargo.toml
      ├─ build.rs
      ├─ tauri.conf.json
      ├─ capabilities/default.json
      └─ src/
         ├─ main.rs
         ├─ lib.rs            # 命令、状态、原生菜单
         ├─ config.rs         # 服务器地址校验与持久化
         ├─ windows.rs        # 主窗口 / widget / 设置窗口
         └─ eve_watcher.rs
```

## 4. 服务端路由与页面

| 路由 | LiveView action | 用途 |
|---|---|---|
| `/desktop` | `DesktopLive :index` | 登录后的地图选择 |
| `/desktop/:slug` | `MapLive :desktop` | 桌面主地图，精简布局 |
| `/desktop/:slug/widget/signatures` | `MapLive :widget` | 独立信号窗口 |
| `/desktop/:slug/widget/jspace` | `MapLive :widget` | 独立 J-Space 窗口（活跃公司排行） |
| `/desktop/:slug/widget/bookmarks` | `MapLive :widget` | 独立本地位标窗口（信号/位标对比） |
| `/desktop/:slug/widget/kills` | `MapLive :widget` | 独立 KM 窗口 |
| `/desktop/:slug/widget/characters` | `MapLive :widget` | 独立星系成员窗口 |

路由必须放在单段 catch-all `live "/:slug"` 之前。

`MapLive` 在桌面 action 中设置：

- `desktop_mode?: true`
- `desktop_widget: nil | "signatures" | "jspace" | "bookmarks" | "kills" | "characters"`（白名单为 `MapLive` 的 `@desktop_widgets`）
- 桌面感知的跳转：`change_map` → `/desktop/:slug`；`no_access` / `map_deleted` → `/desktop`。

`#mapper` DOM 增加：

```heex
<div
  id="mapper"
  phx-hook="Mapper"
  phx-update="ignore"
  data-desktop={@desktop_mode?}
  data-widget={@desktop_widget}
  data-map-slug={@map_slug}
></div>
```

## 5. 桌面模式行为

### 5.1 订阅模式

- 桌面固定使用订阅视图（`viewMode = "home"`），不提供全局视图切换。
- 不强制修改用户的 `hide_unsubscribed_clusters` 设置。
- **新增 / 删除星系与 Web 完全一致**：
  - 不绕过 home + 隐藏模式的限制。
  - Web 端不能新增时，桌面端同样不能新增。
  - 不为桌面开放额外权限。
- 显示规则沿用 Web 的订阅视图：
  - 从订阅星系、本人角色所在星系出发，沿连线可达的星系显示。
  - 隐藏模式开启时，只显示订阅星系可达的簇。
  - widget 窗口直接按“跟随星系 → 星系 ID”读取信号/位标/KM/成员，不要求该星系已订阅（不读地图可见集，也不改变新增/删除的权限判断）。
  - `MapRootProvider` 额外把“跟随星系”作为显示种子；P0 的 widget 窗口不渲染地图，因此这一项是为后续小地图/主图联动预留的显示行为，同样不改变写入权限。
- 订阅为空时显示非阻塞提示，引导用户先订阅星系列表。

> 说明：`hide_unsubscribed_clusters` 的生效逻辑仍由服务端和现有前端共同决定。桌面端不覆盖它，也不修改用户保存在服务端的设置。

### 5.2 写操作范围（P1）

| 对象 | 操作 | 复用命令 | 权限 |
|---|---|---|---|
| 星系 | 编辑名称/描述/标签/状态/位置 | `update_system*` | `update_system` |
| 星系 | 新增 | `manual_add_system` | `add_system`，且受 Web 端同款 home + 隐藏模式限制 |
| 星系 | 删除 | `delete_systems` | `delete_system` |
| 连线 | 新增 / 修改 / 删除 | `manual_add_connection` / `update_connection_*` / `manual_delete_connection` | `add_connection` / `update_system` / `delete_connection` |
| 信号 | 新增 / 修改 / 删除 / 粘贴 / 链接 / 取消链接 / 撤销 | `update_signatures` / `link_signature_to_system` 等 | `update_system` + 主角色 |

前置条件：

- 写操作需要 `main_character_id` 与已追踪角色。
- 缺少主角色或追踪角色时，桌面显示明确提示，不静默失败。

### 5.3 桌面布局

- 使用独立的桌面 layout，隐藏 Web 侧栏、导航和大部分管理入口。
- 主地图复用现有 `MapRootContent`，保留地图编辑能力。
- 桌面固定订阅视图，隐藏全局/订阅视图切换器。
- 独立 widget 窗口只渲染对应 widget，不渲染地图；`map_event` 由 `MapRoot` 的命令处理器维护状态，因此不需要隐藏的 React Flow 图。

## 6. EVE 客户端跟随

### 6.1 检测方式

只使用 Win32 窗口元数据，不读取 EVE 日志、文件或内存：

1. `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` 监听前台窗口变化。
2. 通过 `GetWindowThreadProcessId` + `QueryFullProcessImageNameW` 判断进程名是否为 `exefile.exe`。
3. 通过 `GetWindowTextW` 读取窗口标题。
4. Rust 把 `{ title, process, hwnd, at }` 广播给所有桌面窗口。
5. 页面用地图 `characters` 中的角色名匹配标题：按完整名字匹配（两侧不能是字母/数字/下划线），取最长匹配，忽略大小写；本人角色只用于同长度时的排序。
6. 用匹配角色的 `location.solar_system_id` 解析所在星系。

### 6.2 “最后激活”语义

- 只有 EVE 窗口获得前台时才更新跟随目标。
- 焦点切到桌面悬浮窗、浏览器或其他程序时，**不清空**最后目标。
- 这样点击悬浮窗不会丢失跟随对象。

### 6.3 延迟与兜底

- 角色位置由服务端每 2 秒轮询，实际跟随延迟约 2–5 秒。
- 标题不含角色名 / 角色未追踪 / 角色不在当前地图时：
  - 显示当前状态（未检测到、位置未知、角色不在本图）。
  - 提供手动选择入口（P1）。
- 独占全屏 EVE 下悬浮窗可能无法覆盖，建议使用无边框窗口模式。

## 7. 页面 ↔ Rust 桥

### 7.1 Rust → 页面

通过 `webview.eval()` 调用页面全局对象：

```js
window.__wandererDesktop.onActiveEve({
  title: "Character Name - EVE",
  process: "exefile.exe",
  hwnd: 123456,
  at: 1730000000000
});

window.__wandererDesktop.onDesktopState({
  lastEve: { ... } | null
});
```

### 7.2 页面 → Rust

通过 Tauri IPC 调用白名单命令：

| 命令 | 参数 | 说明 |
|---|---|---|
| `desktop_ready` | `{ mode, widget }` | 页面就绪，返回最后一次 EVE 状态、透明度、缩放和置顶状态 |
| `get_server_url` | — | 读取本机保存的服务器地址 |
| `set_server_url` | `{ url }` | 校验并保存地址，重建/跳转主窗口，关闭旧 widget |
| `open_server_settings` | — | 打开服务器设置窗口 |
| `open_widget` | `{ mapSlug, widget }` | 打开独立 widget 窗口（恢复尺寸、透明度、置顶） |
| `open_main` | — | 打开/聚焦主地图窗口 |
| `close_self` | — | 关闭当前窗口 |
| `set_always_on_top` | `{ value }` | 置顶开关，并按 widget id 缓存到 `config.json`（仅 Windows 生效，WSL/Linux 下被窗口管理器忽略） |
| `set_window_title` | `{ title }` | 设置窗口标题 |
| `set_widget_opacity` | `{ opacity }` | 保存并立即应用到所有 widget 窗口 |
| `zoom_in` / `zoom_out` / `zoom_reset` | — | 放大/缩小/重置所有窗口的界面缩放，返回实际比例 |

安全约束：

- Tauri capability 的 remote URL 允许 `https://*`（服务端地址运行时可配置），但每个窗口都安装导航白名单：只允许服务端 origin 与 EVE SSO 域名，避免任意 HTTPS 页面获得 IPC。
- 页面来自远程 origin 时，Tauri 只放行在 app ACL manifest 中声明、且被 capability 授予的自定义命令。因此命令必须同时出现在 `src-tauri/build.rs` 的 `AppManifest::commands` 与 `capabilities/default.json` 的 `allow-<命令>` 中；缺失时 `invoke` 返回拒绝错误，前端表现为按钮无响应。
- 页面只能调用上述白名单命令；Rust 不执行页面传入的任意脚本。
- Rust → 页面的数据统一 `serde_json` 序列化后注入。
- 其他外部导航（非服务端、非 EVE SSO）直接阻止，页面本身不会离开 Wanderer。
- `window.open` / `target="_blank"`（zkillboard、dotlan、anoik、J-Space Helper 等）不再走导航白名单，而是交给 `on_new_window`：仅 `http`/`https` 用系统默认浏览器打开，其余 scheme 丢弃。没有这个处理器时 wry 会拒绝所有新窗口请求，页面里的外链按钮会“点了没反应”。

### 7.3 桌面登录（SSO）

桌面窗口没有 Web 端欢迎页，未登录时直接进入 EVE SSO，登录完成后回到 `/desktop`：

1. `/desktop` 系列路由挂在 `live_session :desktop`，`on_mount: {UserAuth, :ensure_authenticated_desktop}`。
   没有 `user_id` 时重定向到 `/auth/eve?desktop=1`（而不是 Web 端的 `/auth/eve`）。
2. `AuthController` 的 `store_desktop_origin` plug 把 `desktop` 标记写进 session —— Ueberauth 跳转 EVE 时
   会丢掉 query string，只有 session 能把来源带到回调。
3. 回调成功后：session 里有 `desktop` 标记就删除标记并重定向 `/desktop`；否则保持原来的 `/characters`。
   标记用完即清，同一浏览器会话之后的 Web 登录不受影响。
4. 所有窗口共享同一个 WebView2 用户数据目录，因此主窗口登录后，独立小窗口直接复用 Cookie，不需要再次登录。

已知边界：WebView2 内嵌 SSO 若被服务端策略或第三方 Cookie 限制拦截，回退方案（系统浏览器 + loopback 回调）
仍未实现，见 P2。

### 7.4 独立窗口尺寸

`windows.rs` 的 `default_widget_size` 给出每个小窗口**首次打开**时的尺寸（逻辑像素，最小 260×220）：

| widget | 默认尺寸 |
| --- | --- |
| `signatures` | 380 × 560 |
| `jspace` | 360 × 420 |
| `bookmarks` | 440 × 560 |
| `kills` | 720 × 460 |
| `characters` | 340 × 460 |

用户拖拽调整后，窗口关闭时按 widget 类型写入 `config.json` 的 `window_sizes`，下次打开恢复：

- 保存的是 `inner_size()` / `outer_position()` 的物理像素；
- 恢复时用窗口中心所在显示器的 `scale_factor` 换算回逻辑像素（跨 DPI 显示器时观感一致），并限制在该显示器范围内（最小 260×220，最大不超过屏幕）；
- 位置如果不在任何已连接显示器上（拔掉副屏、分辨率变化），丢弃位置、居中打开，避免窗口跑到屏幕外；
- `Resized`/`Moved` 事件按 800ms 节流写盘，`CloseRequested`/`Destroyed` 时强制写入最终值。

主地图窗口与服务器设置窗口不参与这套记忆。新增 widget 时要在 `default_widget_size` 里补一行，
否则 `open_widget` 会返回 `unsupported widget`。

### 7.5 界面缩放

除了窗口大小，还可以整体缩放页面（字体、间距、图标、地图一起缩放，避免只放大字体导致行高错位）：

- 实现：`WebviewWindow::set_zoom`（Windows 即 WebView2 的 `SetZoomFactor`），wry 已封装；
- 控件只出现在主地图右上角的 `DesktopMainBar`：`−` / `+` / 当前比例 / 「重置所有窗口缩放」；
- 快捷键 `Ctrl+=` / `Ctrl+-` / `Ctrl+0` 由页面统一处理（`useDesktopZoomShortcuts`），
  主地图和小窗口都可用；原生菜单已不再包含缩放项，小窗口里也就没有这些设置；
- 步进 10%，范围 `MIN_UI_SCALE = 0.5` 到 `MAX_UI_SCALE = 2.0`，保存在 `config.json` 的 `ui_scale`；
- 修改时立即应用到所有已打开窗口；新窗口在 build 后应用一次，并在 `on_page_load` 重新应用
  （WebView2 在新文档加载时可能把缩放重置为 1.0）；
- 修改服务器地址触发主窗口 `navigate` 后也会重新应用。
- 没有打开 `zoom_hotkeys_enabled(true)`（WebView2 自带的 Ctrl+滚轮）：它只作用于当前窗口且不持久化，
  会和工具条维护的统一缩放产生偏差；需要统一效果时走工具条或快捷键。
- 缩放是全局的：在小窗口里按快捷键也会改变所有窗口，因为五个窗口共用同一 `ui_scale`。

缩放是客户端本地设置，不经过服务端，也不影响 Web 端浏览器里的页面。

### 7.6 小窗口透明度

五个独立 widget 窗口的**整个窗口**（标题栏、边框、顶栏、列表、文字）可以整体变透明，
压在地图或游戏画面上时不会完全挡住后面：

- Rust 侧：窗口保留原生的标题栏、边框和 DWM 阴影。`apply_widget_opacity` 给窗口加上
  `WS_EX_LAYERED`，再用 `SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)` 对整个窗口
  做统一 alpha（与 Electron 的 `win.setOpacity` 同一做法）。窗口内页面保持完全不透明，
  不做任何逐像素透明。
- 之前尝试过 `.transparent(true)` + `.no_redirection_bitmap(true)` + CSS `opacity`：Windows 上
  WebView2 的逐像素透明必须关掉重定向位图，而该样式不会绘制系统标题栏/边框（无边框窗口），
  且页面仍会合成到白色背景上，表现为“越透明越白”。因此改为窗口级 alpha。
- 主地图窗口和服务器设置窗口不加 `WS_EX_LAYERED`，始终保持不透明。
- 范围：透明度 0%–70%（默认 0%，步进 5%），对应窗口 opacity 1.0–0.3；入口有两个——
  主地图工具条的「透明」滑杆和每个小窗口顶栏的「透明」滑杆，它们调的是同一个共享值。
- 页面侧：`setWidgetOpacity` 同时写 `localStorage` 并调用命令 `set_widget_opacity`；Rust 保存到
  `config.json` 的 `widget_opacity`，并立即应用到所有已打开的 widget 窗口（同一设置，五个窗口
  共享）。新窗口创建时读取该值，避免先全不透明再淡入的闪烁。
- `localStorage`（`wanderer:desktop:widget-opacity`）只用于其他窗口滑杆 UI 的同步
  （`storage` 事件），实际透明度以 `config.json` 为准。`localStorage` 不可用时 UI 退回默认值，
  窗口透明度仍由 Rust 配置决定。
- 顶栏容器仍带 `data-tauri-drag-region="deep"`，按内容拖动更方便；能力中保留
  `core:window:allow-start-dragging`。最小化/最大化/关闭/边缘缩放交还原生标题栏，
  顶栏右侧的「×」仍调用 `close_self` 关闭当前窗口。
- 透明度缓存：Rust 保存到 `config.json` 的 `widget_opacity`；页面 `ready()` 时 `desktop_ready`
  返回该值并同步主地图滑杆（同时回写 `localStorage`），所以重启后滑杆显示与窗口实际透明度一致，
  旧版本缓存的过期值不会残留。默认 1.0（滑杆 0%）。

已知限制：EVE 以独占全屏运行时透明窗口同样可能被挡住（建议游戏用无边框窗口模式）；
`WS_EX_LAYERED` 会让窗口走重定向位图合成，个别驱动/远程桌面下可能有性能开销，需在
Windows 实机确认；透明度只在 Windows 生效（WSL/Linux 开发时不改变窗口，滑杆仅更新配置）。

### 7.7 使用上报与更新提示

由布局 hook `assets/js/hooks/desktopShell.ts`（挂在 `Layouts.desktop` 的根元素上）负责，
不经过 Mapper，因此地图选择页、地图页和每个 widget 窗口都会执行：

- **使用上报**：`mounted` 时调用 `desktop_ready` 取 `version`（Rust 侧返回
  `env!("CARGO_PKG_VERSION")`），然后 `pushEvent("desktop_heartbeat", { install_id, version, platform })`。
  `install_id` 保存在 WebView `localStorage`（`wanderer:desktop:install-id`，`crypto.randomUUID()`
  或 16 字节随机数兜底）。服务端 `WandererApp.DesktopUsage.record_heartbeat/2` 按
  `install_id` upsert 到 `desktop_client_v1`，所以一个客户端开多个窗口只算一个安装。
  `DesktopLive` 和 `MapLive` 都实现了该事件；网页版（没有 Tauri invoke 桥）直接跳过。
- **更新提示**：读取布局上的 `data-update-url`（`/desktop/update.json`），比较 `latest` 与
  客户端版本；较新时在主窗口（路径不含 `/widget/`）显示提示框，内容为前往 Q 群共享下载
  新版本安装包。`WANDERER_DESKTOP_UPDATE_NOTES` 作为补充说明；未设置
  `WANDERER_DESKTOP_LATEST_VERSION` 时，服务端使用编译时从
  `desktop/src-tauri/tauri.conf.json` 读到的版本（`WandererApp.Env` 的模块属性，
  Dockerfile 会把该文件拷进构建阶段）。「本版本不再提醒」写入 `localStorage`
  （`wanderer:desktop:update-skip`）。未接入 `tauri-plugin-updater`：不做静默下载/安装，
  也不需要签名密钥。

## 8. 前端实现要点

### 8.1 桌面状态

新增一个轻量外部 store（`desktop/bridge.ts`），保存：

- `active`：是否在 Tauri 桌面环境。
- `mode`：`main` / `widget`。
- `widget`：当前 widget 类型。
- `mapSlug`。
- `lastEve`：最后一次 EVE 前台信息。
- `followEnabled`：本地设置，默认开启。
- `widgetOpacity`：小窗口整体透明度（0.3–1.0），默认 1.0；由 Rust 通过 `WS_EX_LAYERED`
  应用到原生窗口，页面不参与淡出。
- `uiScale`：所有窗口共用的 WebView2 缩放比例，默认 1.0；命令返回实际值，主地图工具条据此显示百分比。
- `alwaysOnTop`：当前小窗口是否置顶；每个 widget 单独缓存，`desktop_ready` 用窗口真实状态初始化。

`index.tsx` 在挂载时读取 `#mapper` 的 `data-*`，初始化 store，并把 `window.__wandererDesktop` 暴露给 Rust。

### 8.2 可见星系

`computeVisibleSystemIds` 增加可选参数 `extraSeedIds`：

- Web 端不传，行为不变。
- 桌面端传入跟随星系，作为额外 BFS 种子。
- 订阅为空时，如果存在额外种子，仍然渲染跟随星系及其可达簇。
- 不修改 `hideUnsubscribed` 的写入权限语义。
- P0 的 widget 窗口不渲染地图，所以种子目前只影响 `MapRootProvider` 的可见集；widget 数据（信号/位标/KM/成员）直接使用跟随星系 ID，不依赖该可见集。

### 8.3 活动星系

`useDesktopActiveSystem()`：

- 在 `characters` 中匹配 `lastEve.title`。
- 返回匹配角色、跟随星系、当前活动星系。
- widget 模式下优先使用跟随星系。
- 主地图模式仍使用用户点选星系。

### 8.4 Widget 窗口

- 主地图窗口不渲染 Web 端保存的挂件布局（`windowsSettings`）：信号/J空间/位标/KM/成员只出现在独立 widget 窗口里，由主窗口的 `DesktopMainBar` 打开；Web 端的挂件设置不受影响。
- `MapRootContent` 在 widget 模式下只渲染目标 widget，不渲染地图；`map_event` 由 `MapRoot` 的命令处理器维护状态，独立窗口无需隐藏的 React Flow 图。
- `SystemSignatures` / `JspaceWidget` / `LocalBookmarks` / `WSystemKills` / `LocalCharacters` 使用活动星系，而不是仅依赖 `selectedSystems`。
- 本地位标窗口的粘贴内容按星系保存在 `localStorage`，没有服务端读写；多个窗口之间通过 `storage` 事件同步，与 Web 端互不影响。匹配规则见 [`feature-local-bookmarks.md`](feature-local-bookmarks.md)。
- 跟随解析不到星系时（EVE 未激活、角色不在该地图、位置未同步），widget 回退到主图最后选中的星系（主窗口写入 `localStorage`，widget 通过 `storage` 事件联动）。两者都没有时，信号窗口会说明原因并禁用 `+`，避免点击后静默无响应。
- 信号添加/编辑对话框宽度按窗口自适应（`min(390px, calc(100vw - 24px))`），适配 380px 宽的独立信号窗口。
- 信号窗口保留现有粘贴、编辑、删除、撤销、链接逻辑。
- `DesktopWidgetBar` 显示跟随状态、跟随开关、置顶、透明度滑杆、打开主地图、切换挂件等操作；
  缩放设置不在小窗口显示，统一放在主地图的 `DesktopMainBar`，小窗口用
  `Ctrl+=` / `Ctrl+-` / `Ctrl+0` 缩放；透明度在两个位置都可调（共享同一值）。
- 置顶状态按 widget id 缓存在 `config.json` 的 `widget_always_on_top`，窗口创建时恢复；
  `set_always_on_top` 先改窗口再写配置，页面 `desktop_ready` 读取窗口真实状态初始化按钮。
- 窗口内的挂件切换**不新开窗口**：点击信号/J空间/位标/KM/成员只是替换当前窗口的内容（React 本地状态），
  窗口本身、置顶状态和 LiveView socket 都保留，因此只需要置顶一个小窗口就能在各挂件间来回看。
  想要并排多个窗口时，仍可从主地图的 `DesktopMainBar` 打开独立窗口。
- 窗口标题随当前挂件更新；窗口尺寸保持用户最后调整的大小，不随切换自动缩放。
- 置顶只在 Windows（WebView2）生效。WSLg 的 GTK/Wayland 没有 keep-above，`set_always_on_top` 会被窗口管理器忽略；开发时工具条会短暂提示这一点，避免误判为按钮失效。Windows 实机仍需按发布检查清单验证。

## 9. Tauri / Rust 实现要点

- 主窗口启动时读取本机配置：有服务器地址 → `{server_url}/desktop`；没有 → 本地设置页。设置页保存后立即跳转主窗口，不需要重启。
- 服务器地址、`ui_scale`、`widget_opacity`、`widget_always_on_top` 和小窗口几何信息保存在
  `%APPDATA%\<identifier>\config.json`；运行时 `WANDERER_SERVER_URL` 优先，仅用于开发。
- 配置读写有互斥锁保护，窗口拖动产生的几何写入会节流；配置文件损坏时不会静默覆盖（避免丢掉服务器地址）。
- 原生菜单只剩「服务器设置…」，不依赖远程页面，服务器地址输错或服务不可用时仍可改回。
- 缩放/透明度不放在原生菜单：菜单会出现在每个窗口里，而用户希望这些设置只出现在主地图窗口；
  主地图工具条负责显示和修改，小窗口只保留快捷键。
- 原生菜单不含「退出」项：关闭所有窗口即退出应用。`windows::save_all_geometry` 保留，
  恢复该菜单项时使用。
- `desktop_ready` 同时返回 `widgetOpacity`、`uiScale` 和 `alwaysOnTop`，页面据此对齐主地图滑杆、
  缩放百分比和小窗口置顶按钮。
- 修改地址会关闭旧服务器的 widget 窗口，避免跨服务器残留数据。
- 所有窗口使用同一个 WebView2 配置目录，共享 SSO Cookie。
- 小窗口位置/大小、界面缩放、小窗口背景透明度已实现；主窗口尺寸记忆、单实例、托盘菜单仍为 P1。
- EVE watcher 在独立线程安装 `SetWinEventHook` 并运行 Win32 消息循环；前台事件通过 `run_on_main_thread` 更新状态并广播到所有窗口，不阻塞消息循环。
- `desktop_ready` 返回最后一次 EVE 状态，解决新窗口加载晚于前台切换的问题。
- **创建窗口的命令必须是 `async fn`**。`WebviewWindowBuilder::build()` 在 Windows 上从同步命令或事件回调（包括菜单回调）调用会死锁，表现为新窗口和整个应用“未响应”。因此 `open_widget`、`open_main`、`open_server_settings`、`set_server_url` 都是 async；菜单回调里的窗口创建放在独立线程。
- 后续接入 `tauri-plugin-updater`、NSIS/MSI 安装包和代码签名。

## 10. 开发阶段

### P0（已实现）

1. ✅ 文档与本目录结构。
2. ✅ `/desktop`、`/desktop/:slug`、widget 路由与桌面 layout。
3. ✅ `#mapper` data 属性与前端 bridge。
4. ✅ 桌面固定订阅视图、活动星系与可见星系种子。
5. ✅ widget-only 渲染。
6. ✅ Tauri 窗口管理、独立小窗口、EVE watcher（待 Windows 编译验证）。

### P1

1. 五个独立 widget 窗口完整交互。
2. 信号跟随开关、手动角色/星系选择。
3. 星系编辑、连线增删改、信号增删改的桌面验证。
4. 托盘、主窗口位置持久化、开机启动（可选）；置顶、五个小窗口的尺寸与置顶状态记忆已完成。
5. 安装包、自动更新、代码签名。

### P2

1. 更多 widget（路线、建筑、评论等）。
2. 更轻量的 widget 数据载荷（避免每个窗口加载完整地图）。
3. 多地图/多窗口布局预设。
4. 更完善的 SSO 回退方案。

## 11. 风险与验证

| 风险 | 验证方式 | 处理 |
|---|---|---|
| WebView2 内 EVE SSO 被拦截 | P0 实测完整 redirect | 回退系统浏览器 + loopback + 一次性会话 URL（需服务端小回调） |
| 多窗口 Presence / 追踪副作用 | 1 主窗口 + 5 widget，关闭主窗口观察 | 依赖 15 分钟宽限期；必要时 widget 窗口只读追踪 |
| 大图下多窗口内存/首屏 | 大图 4 窗口压测 | P2 精简 widget payload |
| EVE 标题无角色名 | 多客户端/本地化测试 | 手动选择；仍不读日志文件 |
| 独占全屏无法覆盖 | 全屏/无边框对比 | 文档建议无边框窗口 |
| `WS_EX_LAYERED` 在部分驱动/远程桌面上有性能开销或合成异常 | Windows 实机调透明度、拖动缩放、长时间挂机 | 把透明度调回 0%（alpha 255 等同不透明）；必要时去掉该命令，退回不透明窗口 |
| 分层窗口让 WebView2 闪烁/重绘异常 | Windows 实机拖动滑杆连续变化 | 改为节流（拖动结束再应用）或只在 Windows 10/11 启用 |
| 远程页面 IPC 被 CSP/能力限制 | P0 实测 invoke/eval | 限定 capability remote URL，必要时改自定义协议 |
| 新增/删除与 Web 不一致 | 对照 Web 的 home + hide 设置 | 不做桌面绕过，完全复用现有判断 |

## 12. 验收标准

- 登录后进入 `/desktop` 选图；进入地图后固定订阅视图。
- 无订阅时有提示；跟随星系仍可显示。
- 桌面端星系编辑、连线增删改、信号增删改与 Web 实时同步。
- 星系新增/删除的可用性与 Web 完全一致，没有桌面专属放宽。
- 信号、J空间、位标、KM、成员五个窗口可独立打开、移动、置顶；关闭主窗口后继续工作。
- 置顶状态按窗口缓存，关闭后重新打开（或重启客户端）仍保持。
- 主地图工具条缩放后所有已打开窗口立即同步，重启后保持；小窗口内 `Ctrl+=` / `Ctrl+-` / `Ctrl+0`
  也能缩放；「重置所有窗口缩放」把所有窗口恢复为 100%。
- 小窗口的大小和位置在关闭后记住，换显示器不会跑到屏幕外。
- 小窗口顶栏不再显示缩放设置，但保留「透明」滑杆；原生菜单只有「服务器设置…」。
- 拖动主地图工具条或任意小窗口顶栏的「透明」滑杆后，小窗口整个窗口（标题栏/边框/顶栏/列表/文字）
  一起变透明并透出地图/桌面，主地图窗口始终不透明；重启客户端后保持该值。
- 小窗口保留原生标题栏和边框，可最小化、最大化、关闭、拖边缘缩放；顶栏空白处也可拖动窗口，「×」可关闭。
- 在两个 EVE 客户端之间切换，信号窗口在约 3–5 秒内切到对应角色所在星系。
- 不读取 EVE 日志、文件或内存。
- ACL、审计等复杂操作不出现在桌面精简布局中。

## 13. 当前验证状态

已在开发环境完成：

- `mix compile` 通过；`mix phx.routes` 包含 `/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget`。
- `assets && npm run build` 通过，`priv/static/assets` 已包含桌面前端改动。
- Prettier 检查通过。
- `computeVisibleSystemIds` 的 7 个 Jest 用例通过（含桌面跟随种子、隐藏模式、Web 行为不变）。
- `desktop/src-tauri` 的 `cargo check --offline` 通过（Linux 宿主目标，覆盖窗口、菜单、缩放、
  透明度/置顶配置与命令注册；`WS_EX_LAYERED` / `SetLayeredWindowAttributes` 与 EVE 前台监听、
  `ShellExecuteW` 一样是 `cfg(windows)` 代码，仍需在 Windows 上编译）。
- 前端缩放/透明度/置顶改造后 `npm run build` 通过，`set_widget_opacity`、`zoom_in`、`zoom_out`、
  `zoom_reset` 命令调用已包含在 `priv/static/assets` 中。

尚未验证（需要 Windows + Rust 工具链）：

- `npm run dev` / Windows 目标编译（WSL 的 `cargo check --target x86_64-pc-windows-msvc` 需要未缓存的
  `winapi`，内网环境下载失败）。
- Tauri 窗口、IPC、WebView2 内 EVE SSO 跳转、Win32 前台窗口监听。
- 首次启动的服务器设置页、配置写入 `%APPDATA%`、原生菜单改地址、切换服务器后重建主窗口。
- 界面缩放的主地图工具条、快捷键与重置所有窗口：重点确认 WebView2 是否把
  `Ctrl+=` / `Ctrl+-` / `Ctrl+0` 交给页面（菜单加速键已移除，若被 WebView2 吞掉需要另行处理），
  以及小窗口内快捷键是否同步改变所有窗口。
- 小窗口尺寸/位置与置顶状态记忆，以及拔掉副屏后的居中兜底。
- 小窗口透明度的实际观感（尤其 `WS_EX_LAYERED` 下 WebView2 内容是否整体变淡）、跨窗口同步、
  重启后恢复，以及连续拖动滑杆时的重绘性能。
- 分层窗口下原生标题栏/边框、DWM 阴影、拖动和边缘缩放是否正常。
- 真实 EVE 客户端切换时的跟随延迟。

桌面目录首次运行：

```powershell
cd desktop
npm install
$env:WANDERER_SERVER_URL = "http://localhost:4000"
npm run dev
```

## 14. 打包分发

逐步操作手册（含成员安装/使用、发版检查清单、故障排查）见
[`desktop-release-and-usage.md`](desktop-release-and-usage.md)。以下为设计层面的要点。

发布安装包前，必须满足：

1. 服务端已部署 `/desktop` 系列路由和最新 `priv/static/assets`；
2. 服务端使用成员可访问的 HTTPS 地址，EVE SSO 回调已在服务端配置好。

服务器地址**不写进安装包**。同一个安装包发给所有成员，成员第一次启动时在设置页填写地址。地址保存在 `%APPDATA%\<identifier>\config.json`，之后可通过主地图的「服务器」按钮或原生菜单「服务器设置…」修改。

```powershell
cd desktop
npm install
npm run build
```

`WANDERER_SERVER_URL` 仅用于开发时跳过设置页，优先级高于本机配置，但不会改写配置文件。发布构建不要设置它。

产物：

```text
src-tauri/target/release/bundle/
├─ nsis/Wanderer_0.1.0_x64-setup.exe   # 推荐分发
└─ msi/Wanderer_0.1.0_x64_en-US.msi
```

注意事项：

- Tauri 不产出单文件绿色版；不要把 `target/release/wanderer-desktop.exe` 单独发给成员。
- WebView2 使用 `downloadBootstrapper`：Win11 自带，Win10 缺失时联网安装。离线场景改用 `embedBootstrapper` / `offlineInstaller`。
- 未签名安装包会触发 SmartScreen；对外分发建议配置代码签名，内部使用需提前说明。
- 服务器地址由成员自己填写，迁移服务器不需要重新发版；旧地址打不开时仍可用原生菜单改回。
- 修改服务器地址会关闭旧服务器的 widget 窗口，并重新加载主窗口；成员可能需要重新 SSO 登录。
- 地址只接受 HTTPS；本机开发允许 `http://localhost` / `http://127.0.0.1`。支持子路径部署（如 `https://example.com/wanderer`）。
- 自动更新、托盘、单实例、窗口位置持久化仍在 P1。
- 详细清单见 [`desktop/README.md`](../desktop/README.md)。
