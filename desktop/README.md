# Wanderer Desktop

Windows 10/11 桌面客户端（Tauri 2 + 系统 WebView2）。它不复制地图逻辑：每个窗口加载现有 Phoenix LiveView 页面（`/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget`），因此地图数据、SSO 用户、订阅规则、读写权限与 Web 端完全一致。

设计说明见 [`../docs/desktop-client.md`](../docs/desktop-client.md)。

## 目录

```
desktop/
├── package.json              # Tauri CLI 入口
├── web/index.html            # 首次启动的服务器地址设置页
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

## 服务器地址

首次启动时填写的地址会保存到：

```text
%APPDATA%\<应用标识>\config.json
```

内容形如：

```json
{
  "server_url": "https://wanderer.example.com"
}
```

规则：

- 仅接受 `https://`；本机开发可用 `http://localhost` / `http://127.0.0.1`。
- 可以直接输入 `example.com`，会自动补全 `https://`。
- 支持部署在子路径下，例如 `https://example.com/wanderer`。
- 地址只能通过设置页修改，修改后会自动关闭旧服务器的小窗口并重新加载主窗口。

修改入口：

- 主地图右上角「服务器」按钮；
- 窗口顶部原生菜单「服务器设置…」——即使当前服务器打不开、页面加载失败，也能通过它改回正确地址。

开发时如果设置了 `WANDERER_SERVER_URL`，它优先于本机保存的地址，不会改写配置文件。

## 已有的窗口与命令

窗口：

- `main`：`/desktop`（地图选择）→ `/desktop/:slug`（订阅模式的精简地图）。
- `widget-<slug>-signatures`：`/desktop/:slug/widget/signatures`
- `widget-<slug>-kills`：`/desktop/:slug/widget/kills`
- `widget-<slug>-characters`：`/desktop/:slug/widget/characters`

页面通过 `window.__TAURI__.core.invoke` 调用：

| 命令 | 作用 |
| --- | --- |
| `desktop_ready` | 页面就绪，返回最后一次 EVE 前台信息 |
| `get_server_url` | 读取已保存的服务器地址（设置页使用） |
| `set_server_url` | 校验并保存地址，然后跳转主窗口 |
| `open_server_settings` | 打开服务器设置窗口 |
| `open_widget` | 打开/聚焦独立小窗口 |
| `open_main` | 打开/聚焦主地图窗口 |
| `close_self` | 关闭当前窗口 |
| `set_always_on_top` | 小窗口置顶（仅 Windows 生效；WSLg/GTK Wayland 会忽略） |
| `set_window_title` | 更新窗口标题（系统名/角色名） |

页面来自远程服务器，Tauri 对**远程 origin 的自定义命令**有额外 ACL 限制：命令必须声明在 `build.rs` 的 `AppManifest` 里，并在 `capabilities/default.json` 中授予生成的 `allow-<命令>` 权限。两者缺一，`invoke` 会被拒绝，按钮看起来“点了没反应”。新增命令时两处都要改。

**创建窗口的命令必须写成 `async fn`**。Windows 下在同步命令或菜单等事件回调里调用 `WebviewWindowBuilder::build()` 会死锁，表现是新窗口（以及整个应用）一直“未响应”。菜单回调创建窗口时要放到独立线程（见 `lib.rs` 的 `on_menu_event`）。

页面里的外链（zkillboard、dotlan、anoik、J-Space Helper 等 `window.open` / `target="_blank"`）由 `windows.rs` 的 `on_new_window` 交给系统默认浏览器打开。wry 在没有处理器时会拒绝所有新窗口请求，删掉它这些按钮就会“点了没反应”。

## EVE 跟随

`eve_watcher.rs` 使用 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` 监听前台窗口，只在进程名为 `exefile.exe` 时记录窗口标题，不会读取 EVE 日志或文件。React 侧把标题与地图中已加载的角色名匹配，再用服务端已跟踪的角色位置得到星系。

因此：

- 如果尚未激活过 EVE 客户端，独立窗口会回退到主地图当前选中的星系；两者都没有时，信号窗口会直接提示原因，而不是让“添加信号”点击后没有任何反应。
- 点击客户端窗口不会清除“最后激活的 EVE 客户端”，只是不再更新。
- 位置来自服务端角色位置轮询，通常有 2–5 秒延迟。
- 如果 EVE 以独占全屏运行，浮窗可能无法显示；建议使用无边框窗口模式。

## 打包与分发

### 1. 先部署服务端

客户端本身不含地图页面，所有窗口都加载 Wanderer 服务端。因此分发安装包之前，必须先把包含以下内容的版本部署到正式服务器：

- `/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget` 路由；
- 重建后的 `priv/static/assets`（`cd assets && npm run build`）；
- 可被成员访问的 HTTPS 地址和有效的 EVE SSO 回调配置。

如果成员连接的是同一台服务器，这一步只需要做一次。

### 2. 打包（不需要写死服务器地址）

同一个安装包可以发给所有成员。每个成员第一次启动时填写服务器地址，保存在自己的 `%APPDATA%` 下，互不影响。

```powershell
cd desktop
npm install
npm run build
```

不要为发布构建设置 `WANDERER_SERVER_URL`；该变量只用于开发时跳过设置页。
把地址写死进安装包会导致成员无法修改，服务器迁移时只能重新发版。

### 3. 产物

```text
desktop/src-tauri/target/release/bundle/
├─ nsis/Wanderer_0.1.0_x64-setup.exe   # 推荐发给成员
└─ msi/Wanderer_0.1.0_x64_en-US.msi    # 需要 MSI 分发时使用
```

Tauri 不提供“单文件绿色版”。`target/release/wanderer-desktop.exe` 依赖 WebView2 运行时和同目录资源，直接拷贝这个 exe 不可靠；请分发安装包。

WebView2 使用 `downloadBootstrapper`：Win11 自带，Win10 若缺失会由安装程序联网安装。需要完全离线安装时，改成 `embedBootstrapper` 或 `offlineInstaller`，安装包会明显变大。

### 4. 代码签名（可选但强烈建议）

未签名的安装包会触发 Windows SmartScreen（“Windows 已保护你的电脑”），成员需要点“更多信息 → 仍要运行”。对外分发建议：

- 购买代码签名证书（OV/EV）或使用 Azure Trusted Signing；
- 在 `tauri.conf.json` 的 `bundle.windows` 配置证书指纹或 `signCommand`；
- 签名后再上传发布。

内部小范围使用可以先不签名，但要提前告知成员如何绕过提示。

### 5. 版本与发布

- 同时修改 `desktop/package.json` 和 `desktop/src-tauri/tauri.conf.json` 的 `version`；
- 安装包文件名会带上版本号；
- 自动更新（`tauri-plugin-updater`）、托盘、单实例、窗口位置持久化尚未接入，属于 P1。

### 6. 发布检查清单

- [ ] 服务端已部署桌面路由与最新前端资源
- [ ] 服务端 HTTPS 证书有效，成员可直接访问
- [ ] 安装包未设置 `WANDERER_SERVER_URL`，首次启动会出现设置页
- [ ] 在干净的 Windows 10/11 上安装，输入地址并完成 SSO 登录
- [ ] 断网或输错地址后，可通过原生菜单「服务器设置…」改回
- [ ] 打开三个独立窗口，确认置顶、跟随、关主窗口后仍存活
- [ ] 版本号与发布说明已更新

## 当前边界

- 仅 Windows。其他平台能编译但 EVE 跟随不可用。
- 置顶同样只在 Windows 生效：WSLg 的 GTK/Wayland 没有 keep-above，开发时点击置顶看起来“没反应”属于环境限制，需在 Windows 实机验证。
- 主地图窗口不显示 Web 端保存的挂件布局；信号/KM/成员只在独立窗口中出现，路线、建筑、评论等其他挂件暂未提供独立窗口。
- SSO 在 WebView2 内嵌登录遇到服务端限制时，需要回退到系统浏览器 + loopback 回调（设计文档中的 P0 风险项，尚未实现）。
- 订阅模式下新增/删除星系与 Web 完全一致，客户端没有任何绕过。
