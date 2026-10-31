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
- 支持将信号、KM、星系成员等小组件拆成独立窗口。
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
│  └─ desktop-client.md              # 本文档
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
│     │  ├─ DesktopMainBar.tsx       # 主地图上的“独立窗口”入口
│     │  ├─ DesktopWidgetBar.tsx     # 小窗口工具条：跟随状态/置顶/切换
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
| `/desktop/:slug/widget/kills` | `MapLive :widget` | 独立 KM 窗口 |
| `/desktop/:slug/widget/characters` | `MapLive :widget` | 独立星系成员窗口 |
| `/desktop/:slug/widget/jspace` | `MapLive :widget` | 独立 J-Space 窗口（活跃公司排行） |

路由必须放在单段 catch-all `live "/:slug"` 之前。

`MapLive` 在桌面 action 中设置：

- `desktop_mode?: true`
- `desktop_widget: nil | "signatures" | "kills" | "characters" | "jspace"`
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
  - widget 窗口直接按“跟随星系 → 星系 ID”读取信号/KM/成员，不要求该星系已订阅（不读地图可见集，也不改变新增/删除的权限判断）。
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
5. 页面用地图 `characters` 中的角色名匹配标题：优先本人角色，取最长匹配，忽略大小写。
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
| `desktop_ready` | `{ mode, widget }` | 页面就绪，返回最后一次 EVE 状态 |
| `get_server_url` | — | 读取本机保存的服务器地址 |
| `set_server_url` | `{ url }` | 校验并保存地址，重建/跳转主窗口，关闭旧 widget |
| `open_server_settings` | — | 打开服务器设置窗口 |
| `open_widget` | `{ mapSlug, widget }` | 打开独立 widget 窗口 |
| `open_main` | — | 打开/聚焦主地图窗口 |
| `close_self` | — | 关闭当前窗口 |
| `set_always_on_top` | `{ value }` | 置顶开关（仅 Windows 生效，WSL/Linux 下被窗口管理器忽略） |
| `set_window_title` | `{ title }` | 设置窗口标题 |

安全约束：

- Tauri capability 的 remote URL 允许 `https://*`（服务端地址运行时可配置），但每个窗口都安装导航白名单：只允许服务端 origin 与 EVE SSO 域名，避免任意 HTTPS 页面获得 IPC。
- 页面来自远程 origin 时，Tauri 只放行在 app ACL manifest 中声明、且被 capability 授予的自定义命令。因此命令必须同时出现在 `src-tauri/build.rs` 的 `AppManifest::commands` 与 `capabilities/default.json` 的 `allow-<命令>` 中；缺失时 `invoke` 返回拒绝错误，前端表现为按钮无响应。
- 页面只能调用上述白名单命令；Rust 不执行页面传入的任意脚本。
- Rust → 页面的数据统一 `serde_json` 序列化后注入。
- 其他外部导航（非服务端、非 EVE SSO）直接阻止，页面本身不会离开 Wanderer。
- `window.open` / `target="_blank"`（zkillboard、dotlan、anoik、J-Space Helper 等）不再走导航白名单，而是交给 `on_new_window`：仅 `http`/`https` 用系统默认浏览器打开，其余 scheme 丢弃。没有这个处理器时 wry 会拒绝所有新窗口请求，页面里的外链按钮会“点了没反应”。

## 8. 前端实现要点

### 8.1 桌面状态

新增一个轻量外部 store（`desktop/bridge.ts`），保存：

- `active`：是否在 Tauri 桌面环境。
- `mode`：`main` / `widget`。
- `widget`：当前 widget 类型。
- `mapSlug`。
- `lastEve`：最后一次 EVE 前台信息。
- `followEnabled`：本地设置，默认开启。

`index.tsx` 在挂载时读取 `#mapper` 的 `data-*`，初始化 store，并把 `window.__wandererDesktop` 暴露给 Rust。

### 8.2 可见星系

`computeVisibleSystemIds` 增加可选参数 `extraSeedIds`：

- Web 端不传，行为不变。
- 桌面端传入跟随星系，作为额外 BFS 种子。
- 订阅为空时，如果存在额外种子，仍然渲染跟随星系及其可达簇。
- 不修改 `hideUnsubscribed` 的写入权限语义。
- P0 的 widget 窗口不渲染地图，所以种子目前只影响 `MapRootProvider` 的可见集；widget 数据（信号/KM/成员）直接使用跟随星系 ID，不依赖该可见集。

### 8.3 活动星系

`useDesktopActiveSystem()`：

- 在 `characters` 中匹配 `lastEve.title`。
- 返回匹配角色、跟随星系、当前活动星系。
- widget 模式下优先使用跟随星系。
- 主地图模式仍使用用户点选星系。

### 8.4 Widget 窗口

- 主地图窗口不渲染 Web 端保存的挂件布局（`windowsSettings`）：信号/KM/成员只出现在独立 widget 窗口里，由主窗口的 `DesktopMainBar` 打开；Web 端的挂件设置不受影响。
- `MapRootContent` 在 widget 模式下只渲染目标 widget，不渲染地图；`map_event` 由 `MapRoot` 的命令处理器维护状态，独立窗口无需隐藏的 React Flow 图。
- `SystemSignatures` / `WSystemKills` / `LocalCharacters` 使用活动星系，而不是仅依赖 `selectedSystems`。
- 跟随解析不到星系时（EVE 未激活、角色不在该地图、位置未同步），widget 回退到主图最后选中的星系（主窗口写入 `localStorage`，widget 通过 `storage` 事件联动）。两者都没有时，信号窗口会说明原因并禁用 `+`，避免点击后静默无响应。
- 信号添加/编辑对话框宽度按窗口自适应（`min(390px, calc(100vw - 24px))`），适配 380px 宽的独立信号窗口。
- 信号窗口保留现有粘贴、编辑、删除、撤销、链接逻辑。
- `DesktopWidgetBar` 显示跟随状态、跟随开关、置顶、打开主地图、切换挂件等操作。
- 窗口内的挂件切换**不新开窗口**：点击信号/KM/成员/J空间只是替换当前窗口的内容（React 本地状态），
  窗口本身、置顶状态和 LiveView socket 都保留，因此只需要置顶一个小窗口就能在各挂件间来回看。
  想要并排多个窗口时，仍可从主地图的 `DesktopMainBar` 打开独立窗口。
- 窗口标题随当前挂件更新；窗口尺寸保持用户最后调整的大小，不随切换自动缩放。
- 置顶只在 Windows（WebView2）生效。WSLg 的 GTK/Wayland 没有 keep-above，`set_always_on_top` 会被窗口管理器忽略；开发时工具条会短暂提示这一点，避免误判为按钮失效。Windows 实机仍需按发布检查清单验证。

## 9. Tauri / Rust 实现要点

- 主窗口启动时读取本机配置：有服务器地址 → `{server_url}/desktop`；没有 → 本地设置页。设置页保存后立即跳转主窗口，不需要重启。
- 服务器地址保存在 `%APPDATA%\<identifier>\config.json`；运行时 `WANDERER_SERVER_URL` 优先，仅用于开发。
- 原生菜单「服务器设置…」不依赖远程页面，服务器地址输错或服务不可用时仍可改回。
- 修改地址会关闭旧服务器的 widget 窗口，避免跨服务器残留数据。
- 所有窗口使用同一个 WebView2 配置目录，共享 SSO Cookie。
- 窗口位置/大小持久化、单实例、托盘菜单为 P1；当前启动时直接创建主窗口。
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

1. 三个独立 widget 窗口完整交互。
2. 信号跟随开关、手动角色/星系选择。
3. 星系编辑、连线增删改、信号增删改的桌面验证。
4. 托盘、窗口持久化、置顶、开机启动（可选）。
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
| 多窗口 Presence / 追踪副作用 | 1 主窗口 + 3 widget，关闭主窗口观察 | 依赖 15 分钟宽限期；必要时 widget 窗口只读追踪 |
| 大图下多窗口内存/首屏 | 大图 4 窗口压测 | P2 精简 widget payload |
| EVE 标题无角色名 | 多客户端/本地化测试 | 手动选择；仍不读日志文件 |
| 独占全屏无法覆盖 | 全屏/无边框对比 | 文档建议无边框窗口 |
| 远程页面 IPC 被 CSP/能力限制 | P0 实测 invoke/eval | 限定 capability remote URL，必要时改自定义协议 |
| 新增/删除与 Web 不一致 | 对照 Web 的 home + hide 设置 | 不做桌面绕过，完全复用现有判断 |

## 12. 验收标准

- 登录后进入 `/desktop` 选图；进入地图后固定订阅视图。
- 无订阅时有提示；跟随星系仍可显示。
- 桌面端星系编辑、连线增删改、信号增删改与 Web 实时同步。
- 星系新增/删除的可用性与 Web 完全一致，没有桌面专属放宽。
- 信号、KM、成员三个窗口可独立打开、移动、置顶；关闭主窗口后继续工作。
- 在两个 EVE 客户端之间切换，信号窗口在约 3–5 秒内切到对应角色所在星系。
- 不读取 EVE 日志、文件或内存。
- ACL、审计等复杂操作不出现在桌面精简布局中。

## 13. 当前验证状态

已在开发环境完成：

- `mix compile` 通过；`mix phx.routes` 包含 `/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget`。
- `assets && npm run build` 通过，`priv/static/assets` 已包含桌面前端改动。
- Prettier 检查通过。
- `computeVisibleSystemIds` 的 7 个 Jest 用例通过（含桌面跟随种子、隐藏模式、Web 行为不变）。

尚未验证（需要 Windows + Rust 工具链）：

- `desktop/` 下的 `cargo check` / `npm run dev`（当前 WSL 环境没有 `cargo`）。
- Tauri 窗口、IPC、WebView2 内 EVE SSO 跳转、Win32 前台窗口监听。
- 首次启动的服务器设置页、配置写入 `%APPDATA%`、原生菜单改地址、切换服务器后重建主窗口。
- 真实 EVE 客户端切换时的跟随延迟。

桌面目录首次运行：

```powershell
cd desktop
npm install
$env:WANDERER_SERVER_URL = "http://localhost:4000"
npm run dev
```

## 14. 打包分发

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
