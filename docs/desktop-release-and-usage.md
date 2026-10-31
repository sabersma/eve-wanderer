# Wanderer 桌面客户端：打包与使用手册

面向两类人：**维护者**负责打包发版（第一部分），**成员**只需要安装和日常使用（第二部分）。
第三部分是双方都可能用到的故障排查。

设计与实现细节见 [`desktop-client.md`](desktop-client.md)，开发说明见 [`../desktop/README.md`](../desktop/README.md)。

## 0. 全流程一览

```text
[维护者] 部署服务端（/desktop 路由 + 最新前端资源 + HTTPS/SSO）
        ↓
[维护者] 在 Windows 构建机打包 → 得到 setup.exe
        ↓
[维护者] 分发安装包（群文件 / 网盘）+ 版本说明
        ↓
[成员]   安装 → 首次填写服务器地址 → SSO 登录 → 选图
        ↓
[成员]   日常使用：主地图 + 五个独立窗口（信号 / J空间 / 位标 / KM / 成员）
```

关键前提：**安装包只是外壳**。地图页面、SSO、订阅、权限全部来自服务器。
所以大多数服务端更新只要部署完成就生效，不需要重新发客户端；只有客户端外壳本身
（窗口、快捷键、透明度、跟随等）变化时才需要出新安装包。

---

## 第一部分：打包（维护者）

### 1. 环境要求

| 角色 | 要求 |
| --- | --- |
| 服务端 | 已部署 `/desktop` 系列路由和最新前端资源；HTTPS 可访问；EVE SSO 回调已配置 |
| 构建机 | Windows 10/11 x64；Node.js 20+；Rust stable（MSVC 工具链）；Visual Studio Build Tools 的「使用 C++ 的桌面开发」+ Windows SDK；WebView2 Runtime；首次构建可联网下载 npm/crates 依赖 |
| 成员机 | Windows 10/11 x64；WebView2（Win11 自带，Win10 缺失时安装程序会联网安装） |

注意事项：

- **不能在 WSL/Linux 上生成 Windows 安装包**，Tauri 需要 Windows 的 MSVC 链接器和 WebView2。
- 如果在 WSL 里编辑 `desktop/`，先在 Windows 上同步再打包：
  `desktop/scripts/sync-to-windows.sh`（`node_modules`、`src-tauri/target` 不同步，Windows 端保留自己的副本）。
- 只改地图页面（`assets/`、`lib/`）时不需要重新打包客户端，由 Phoenix 提供。

### 2. 服务端准备（每次发版前）

1. `/desktop` 系列路由已部署：
   `/desktop`、`/desktop/:slug`、`/desktop/:slug/widget/:widget`，
   以及公开的版本清单 `/desktop/update.json`。
2. 前端资源已重建，且部署产物包含桌面相关改动：

   ```bash
   cd assets
   npm run build     # 产物写入 priv/static/assets
   ```

   本仓库请用 `npm`，不要用 `yarn`。

3. 数据库迁移：Docker 镜像启动时会自动执行（`rel/docker-entrypoint.sh` → `bin/migrate.sh`），
   Fly.io 的 `release_command` 也会执行；只有直接以 `mix phx.server` 部署时才需手动
   `mix ecto.migrate`。
4. 站点 HTTPS 证书有效。客户端对外只接受 `https://`，只有本机开发允许
   `http://localhost` / `http://127.0.0.1`。
5. EVE SSO 回调配置正确：桌面未登录时会跳到 `/auth/eve?desktop=1`，回调成功后回到
   `/desktop`；Web 登录仍回 `/characters`。
6. 用浏览器实际登录一次，确认能打开 `/desktop`、能看到地图列表。

### 3. 打包

在 **Windows** 上推荐直接运行打包脚本：

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

脚本会依次完成：

1. 检查 Windows / Node.js / Rust 工具链，确认没有设置 `WANDERER_SERVER_URL`；
2. 执行 `npm install` + `npm run build`；
3. 把 NSIS 和 MSI 安装包复制到 `desktop\dist\v<版本>\`；
4. 生成 `SHA256SUMS.txt`，并默认打包成 `desktop\dist\Wanderer_<版本>_x64.zip`
   （同时生成压缩包的 `.sha256` 校验文件）。

常用参数：

| 参数 | 作用 |
| --- | --- |
| `-SkipInstall` | 跳过 `npm install`（依赖已安装时加快构建） |
| `-Clean` | 构建前执行 `cargo clean`（明显变慢） |
| `-NoDist` | 只构建，不复制安装包、不生成 SHA256/zip |
| `-NoZip` | 照常复制安装包和生成 SHA256，但不生成 zip |
| `-OutputDir D:\release` | 自定义分发包输出目录 |

如果不用脚本，手动执行等价命令：

```powershell
cd desktop
npm install
npm run build
```

- **发布构建不要设置 `WANDERER_SERVER_URL`**。该变量只在客户端运行时读取，用于开发时
  跳过首次设置页，不会写进安装包；发布前清掉它可以避免本地测试时误跳过设置页。
  脚本检测到非空值会直接终止构建。
- 首次 release 构建要编译全部 Rust 依赖，耗时较长；之后是增量编译。
- 构建前确认 `desktop/src-tauri/icons/` 中的图标存在（打包会用到）。

### 4. 产物与分发

```text
desktop/src-tauri/target/release/bundle/
├─ nsis/Wanderer_0.1.0_x64-setup.exe   # 推荐分发给成员
└─ msi/Wanderer_0.1.0_x64_en-US.msi    # 需要 MSI 部署时使用
```

运行 `build.ps1` 后还会得到整理好的分发包：

```text
desktop/dist/
├─ v0.1.0/
│  ├─ Wanderer_0.1.0_x64-setup.exe
│  ├─ Wanderer_0.1.0_x64_en-US.msi
│  └─ SHA256SUMS.txt
├─ Wanderer_0.1.0_x64.zip             # 默认生成，推荐直接分发
└─ Wanderer_0.1.0_x64.zip.sha256      # 压缩包自身的 SHA256
```

zip 内含 NSIS 安装包、MSI（如果构建出）和 `SHA256SUMS.txt`；不需要时加 `-NoZip`。
`-NoDist` 会同时跳过复制、校验和 zip。

- **只发安装包**。`target/release/wanderer-desktop.exe` 依赖 WebView2 运行时和同目录资源，
  单独拷给成员不可靠；Tauri 也不提供单文件绿色版。
- 同一个安装包发给所有人。服务器地址不写进安装包，由成员首次启动时填写，
  保存在各自的 `%APPDATA%` 下。
- WebView2 使用 `downloadBootstrapper`：Win11 自带；Win10 缺失时安装程序联网安装。
  需要完全离线安装时，把 `tauri.conf.json` 的 `webviewInstallMode` 改为
  `embedBootstrapper` 或 `offlineInstaller`，安装包会明显变大。
- 运行打包脚本时，推荐直接分发 `desktop\dist\Wanderer_<版本>_x64.zip`：里面已包含
  安装包和 `SHA256SUMS.txt`；也可以发 `desktop\dist\v<版本>\` 整个目录。
- 手动构建时，建议自行计算并附上 SHA256。

### 5. 版本号与代码签名

- 修改版本号：`desktop/src-tauri/tauri.conf.json`（安装包文件名和版本信息以此为准），
  同时同步 `desktop/package.json` 和 `desktop/src-tauri/Cargo.toml`，避免各处版本展示不一致。
  打包脚本会检查 `package.json` 与 `tauri.conf.json` 是否一致。
- 安装包文件名会自动带上版本号。
- 未签名安装包会触发 Windows SmartScreen（“Windows 已保护你的电脑”），
  成员需要点「更多信息 → 仍要运行」。内部分发要提前说明；对外分发建议配置
  OV/EV 代码签名证书或 Azure Trusted Signing，在 `bundle.windows` 中配置证书或
  `signCommand` 后重新打包。
- 自动更新（`tauri-plugin-updater`）尚未接入，每次发版都需要重新分发安装包。
  客户端启动时会检查服务端的版本清单，发现新版本后提示成员去 Q 群共享下载，
  详见下一节。

### 6. 更新提示与使用统计

两件事都由服务端配置，客户端外壳不需要为此重新打包（客户端版本号本身除外）。

#### 版本清单（更新提示）

客户端启动时请求公开接口 `GET /desktop/update.json`，返回：

```json
{ "latest": "0.1.1", "notes": "本次修复……" }
```

服务端通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WANDERER_DESKTOP_LATEST_VERSION` | 编译时的客户端版本 | 最新客户端版本；只有比客户端自身版本新时才提示 |
| `WANDERER_DESKTOP_UPDATE_NOTES` | 空 | 可选的更新说明，显示在提示框里 |

默认值不是写死的：编译服务端时，`WandererApp.Env` 会读取仓库里的
`desktop/src-tauri/tauri.conf.json`（Dockerfile 会把该文件拷进构建阶段），把版本号
编进 release。因此**升完客户端版本号、用该提交重新构建并部署服务端后，更新提示自动生效**，
不需要额外在服务器上配置版本；只有想让服务端提示一个与仓库不同的版本时（例如回滚、
灰度发布），才需要设置 `WANDERER_DESKTOP_LATEST_VERSION`。

行为：

- 只在主窗口（地图选择 / 地图）弹出，独立小窗口不打扰；提示内容是
  “前往 Q 群共享下载新版本安装包，安装后重新启动客户端”。
- 「知道了」只关闭本次；「本版本不再提醒」写入本机 `localStorage`，同一版本不再弹出。
- 发版流程：先上传新安装包到群共享，再部署含新版本号的服务端；改反顺序会让成员
  看到提示却下载不到包。

#### 使用统计

客户端每个窗口挂载时向 LiveView 发送一次 `desktop_heartbeat`，服务端按
`install_id`（客户端 `localStorage` 中随机生成的 UUID）做 upsert，所以同时开多个
小窗口只算一个安装。数据表 `desktop_client_v1` 由迁移
`priv/repo/migrations/20261101120000_add_desktop_client_usage.exs` 创建。

部署时不需要手动执行迁移：Docker 镜像的入口脚本 `rel/docker-entrypoint.sh` 在
`run` 启动前会调用 `/app/bin/migrate.sh`（`WandererApp.Release.interweave_migrate`），
Fly.io 的 `release_command` 也是同一个脚本。只有不用 Docker/release 直接跑 `mix phx.server`
的环境才需要手动 `mix ecto.migrate`。

管理员页面 `/admin/desktop`（Admin → Desktop Clients → Client Usage）展示：

- 今日（UTC）/ 近 7 天 / 近 30 天的活跃安装数与活跃用户数（按 `user_id` 去重）；
- 近 30 天的版本分布；
- 最近 100 条上报，含用户、安装 ID、版本、平台、首次/最近上报时间。

注意：

- 心跳只在 Tauri 外壳中发送，网页版地图不会上报；客户端未登录时不会发送（没有用户）。
- `install_id` 存在每个窗口共用的 WebView `localStorage` 中，清除客户端本地数据会
  被视为一个新安装。
- 该表只增不删，长期运行可按需定期清理很久未上报的行。

### 7. 发版检查清单

构建与分发：

- [ ] 服务端已部署 `/desktop` 路由与最新 `priv/static/assets`
- [ ] 服务端镜像包含最新 `desktop/src-tauri/tauri.conf.json`（重建镜像后自动生效）
- [ ] 不需要手动迁移：容器启动时会自动执行；确认日志里没有迁移失败
- [ ] 新安装包已上传到 Q 群共享（顺序在部署新版本服务端之前）
- [ ] 旧版本客户端启动后能看到更新提示，`/admin/desktop` 能看到上报
- [ ] 服务端 HTTPS 证书有效，浏览器可正常登录并选图
- [ ] 构建时未设置 `WANDERER_SERVER_URL`
- [ ] `tauri.conf.json` / `package.json` 版本号已更新
- [ ] 在干净的 Windows 10/11 上安装，首次启动出现服务器设置页
- [ ] 输入地址后能完成 SSO 登录并进入地图
- [ ] 输错地址或服务不可用时，可通过原生菜单「服务器设置…」改回
- [ ] 覆盖安装后服务器地址、登录状态和窗口设置仍在
- [ ] SmartScreen 绕过说明已随安装包一起发出

实机快速验收：

- [ ] 五个独立窗口（信号 / JSpace / 位标 / KM / 成员）都能打开、移动、缩放
- [ ] 关闭主窗口后小窗口继续工作；关闭所有窗口后应用退出
- [ ] 小窗口置顶后关闭再打开、重启客户端后仍保持置顶
- [ ] 主地图工具条缩放后所有窗口同步；`Ctrl+=` / `Ctrl+-` / `Ctrl+0` 可用；
      「重置所有窗口缩放」把全部窗口恢复到 100%
- [ ] 小窗口顶栏和主地图工具条的「透明」滑杆都能调节，所有小窗口同步，
      重启后保持，主地图窗口始终不透明
- [ ] 小窗口关闭后重新打开，大小和位置恢复；换显示器后不会跑到屏幕外
- [ ] 小窗口保留原生标题栏、边框、最小化 / 关闭 / 边缘缩放
- [ ] 在两个 EVE 客户端之间切换，信号窗口在约 3–5 秒内切换到对应角色所在星系

---

## 第二部分：使用（成员）

### 8. 安装

1. 取得维护者发布的 `Wanderer_<版本>_x64-setup.exe`。
2. 双击安装。若出现 SmartScreen 提示，点「更多信息 → 仍要运行」。
3. 按向导完成安装并启动 **Wanderer**。

系统要求：Windows 10/11 x64。其他平台不受支持。

### 9. 首次启动：填写服务器地址

第一次启动会打开「设置 Wanderer 服务器」窗口：

1. 输入与 Web 版相同的服务器地址，例如 `https://wanderer.example.com`；
2. 也可以只输 `wanderer.example.com`，会自动补全 `https://`；
3. 部署在子路径时填完整地址，例如 `https://example.com/wanderer`；
4. 本机开发才使用 `http://localhost:4444` 这类地址。

规则：

- 只接受 `https://`；`http://localhost`、`http://127.0.0.1` 仅限本机开发。
- 不能带用户名、密码、查询参数或 `#` 片段。
- 点「保存并连接」后设置窗口关闭，主窗口打开服务器的 `/desktop`。
- 保存时只校验地址格式，不会探测服务器是否可达。地址填错或服务不可用时，主窗口会
  加载失败，可以通过原生菜单「服务器设置…」改回。

地址只保存在本机：

```text
%APPDATA%\app.wanderer.desktop\config.json
```

不会上传，也不影响其他成员。

### 10. 登录

- 未登录时不会经过 Web 欢迎页，而是直接进入 EVE SSO；登录成功后回到 `/desktop`。
- 所有窗口共用同一 WebView2 会话，登录一次即可，独立小窗口不再要求登录。
- 如果登录后停在空白页或报错，先用浏览器确认同一地址能正常登录，再联系维护者。

### 11. 选图与进入地图

- `/desktop` 会列出你可以访问的地图，选择后进入桌面精简地图。
- 桌面端固定使用订阅视图；没有订阅时会有提示，但跟随星系仍可显示。
- 权限判断与 Web 端完全一致，客户端没有任何绕过或放宽；ACL、审计等复杂操作仍只在 Web 端提供。
- 订阅模式下星系的新增/删除仍与 Web 端保持一致，桌面端不额外放开这些操作。

### 12. 主地图窗口

主地图右上角的悬浮工具条是桌面端唯一的设置入口：

| 控件 | 作用 |
| --- | --- |
| 地图 | 回到 `/desktop` 选图页 |
| 服务器 | 修改服务器地址 |
| 缩放 `−` / 百分比 / `+` | 调整所有窗口的界面缩放，每次 10%，范围 50%–200% |
| 重置所有窗口缩放 | 所有窗口回到 100% |
| 透明滑杆 | 调整五个小窗口的整体透明度（0%–70%） |
| 独立窗口：信号 / J空间 / 位标 / KM / 成员 | 打开或聚焦对应的独立窗口 |

缩放快捷键（所有桌面窗口通用）：`Ctrl+=` 放大、`Ctrl+-` 缩小、`Ctrl+0` 重置。
主窗口和所有小窗口共用同一个缩放比例，修改后立即同步。

### 13. 独立小窗口

窗口与首次打开的默认尺寸：

| 窗口 | 默认尺寸 |
| --- | --- |
| 信号 | 380 × 560 |
| J空间 | 360 × 420 |
| 位标 | 440 × 560 |
| KM | 720 × 460 |
| 成员 | 340 × 460 |

顶栏控件：

- **跟随**：勾选时跟随最后激活的 EVE 客户端；取消后不再跟随 EVE，改用主地图当前选中的星系。
- **置顶**：窗口保持在其他窗口上方。按挂件类型记住，关闭后重新打开或重启客户端仍保持。
- **透明**：整个小窗口（标题栏、边框、内容）一起变淡，范围 0%–70%。
  五个小窗口共享同一个透明度值，拖动后所有已打开的小窗口同步变化。
- **主图**：打开或聚焦主地图窗口。
- **挂件名按钮**：在当前窗口内切换挂件，不新建窗口，窗口大小保持不变。
- **×**：关闭当前窗口。

窗口行为：

- 拖动标题栏移动，拖边缘缩放；关闭后会记住大小和位置，下次从主图打开时恢复。
- 换到不同 DPI 的显示器时会按比例换算；位置如果不在任何显示器上，会居中打开。
- 小窗口内没有缩放设置，请用 `Ctrl+=` / `Ctrl+-` / `Ctrl+0`；快捷键同样作用于所有窗口。
- 关闭主地图窗口不会关闭小窗口；关闭全部窗口后应用退出。

> 置顶和透明度只在 Windows 上生效。WSL/Linux 下按钮会给出提示，但窗口管理器不会响应。

### 14. EVE 跟随

- 激活 EVE 客户端（进程 `exefile.exe`）后，客户端读取窗口标题中的角色名，与地图中已加载的
  角色匹配，再通过服务端角色位置切到对应星系。
- **不读取 EVE 日志、文件或内存**，只监听前台窗口标题。
- 位置来自服务端轮询，通常有 2–5 秒延迟。
- 如果还没激活过 EVE 客户端、角色不在当前地图或位置尚未加载，小窗口会回退到主地图当前选中的星系。
- 如果标题里没有可匹配的角色名，会显示「未匹配角色：<标题>」，此时请在主图手动选星系。
- EVE 以独占全屏运行时，浮窗可能被挡住；建议使用无边框窗口模式。

### 15. 配置、更新与卸载

配置文件：

```text
%APPDATA%\app.wanderer.desktop\config.json
```

主要字段：

| 字段 | 含义 |
| --- | --- |
| `server_url` | 上次保存的服务器地址 |
| `ui_scale` | 所有窗口共用的界面缩放（0.5–2.0） |
| `widget_opacity` | 小窗口整体不透明度（0.3–1.0） |
| `widget_always_on_top` | 各挂件窗口的置顶状态 |
| `window_sizes` | 各小窗口最后的大小和位置 |

- 想恢复默认：关闭客户端后删除该文件。会同时丢失服务器地址和窗口设置。
- **更新**：目前没有自动更新，下载新安装包覆盖安装即可。服务端页面更新后，重新打开窗口
  或重启客户端就能看到；只有客户端外壳变化才需要新安装包。覆盖安装会保留配置文件，
  登录状态通常也会保留，若提示登录请重新 SSO 一次。
- **卸载**：在 Windows「设置 → 应用」中卸载。`config.json` 不会自动删除，需要时可手动清理。
- **更换服务器**：点主图工具条的「服务器」，或使用窗口顶部原生菜单「服务器设置…」。
  保存后会关闭旧服务器的小窗口并重新加载主窗口，通常需要重新 SSO 登录。

---

## 第三部分：故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 安装时提示「Windows 已保护你的电脑」 | 安装包未签名 | 点「更多信息 → 仍要运行」；对外分发应由维护者签名 |
| 启动后白屏或一直加载 | 服务器不可达、地址错误、证书无效 | 用浏览器访问该地址；通过原生菜单「服务器设置…」改回正确地址 |
| 提示「请使用 https 地址」 | 填了 `http://` 且不是本机 | 改用 `https://`，本机开发才可用 `localhost` |
| 点「保存并连接」时提示错误 | 地址格式不符（非 https、含账号/参数等） | 按错误提示修改；本机开发才可用 `http://localhost` |
| 登录后停在空白页 | SSO 回调或会话问题 | 先用浏览器验证同一地址；联系维护者检查回调配置 |
| 小窗口一直显示「等待 EVE 客户端」 | 尚未激活 EVE，或角色不在当前地图 | 激活 EVE；确认角色已加入该地图；或在主图选星系 |
| 显示「未匹配角色：…」 | EVE 标题中没有角色名（多客户端 / 本地化） | 在主图手动选择星系 |
| 切换 EVE 客户端后几秒才跟随 | 服务端位置轮询延迟 | 正常现象，通常 2–5 秒 |
| 浮窗被 EVE 挡住 | EVE 使用独占全屏 | 改为无边框窗口模式，并给小窗口打开「置顶」 |
| 「置顶」没有效果 | 非 Windows 环境（如 WSL/Linux 开发） | 在 Windows 实机上使用 |
| 「透明」滑杆没有效果 | 非 Windows 环境，或远程桌面 / 显卡驱动合成异常 | 在 Windows 实机验证；调回 0% 等同完全不透明 |
| 快捷键缩放无效 | 焦点不在客户端窗口，或 WebView2 吞掉按键 | 先点击窗口再按；仍无效请向维护者反馈 |
| 修改服务器后要求重新登录 | 会话按域名隔离 | 正常现象，重新 SSO 即可 |
| 更新后没有看到新功能 | 新功能在服务端，或客户端版本未更新 | 重启客户端；确认安装的安装包版本号 |

---

## 附：本地开发（可选）

```powershell
cd desktop
npm install
$env:WANDERER_SERVER_URL = "http://localhost:4444"
npm run dev
```

`WANDERER_SERVER_URL` 仅用于开发时跳过设置页，优先级高于本机配置，且不会改写配置文件。
不设置时，首次启动会显示服务器地址设置页。

从 WSL 编辑、在 Windows 编译时：

```bash
desktop/scripts/sync-to-windows.sh            # 同步 desktop/ 到 Windows
desktop/scripts/sync-to-windows.sh --dry-run  # 只预览变更
```
