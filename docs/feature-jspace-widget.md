# J-Space Helper 挂件（活跃公司排行）

地图新增 `J-Space` 挂件：对当前星系（跟随 EVE 客户端或主图选中）展示 J-Space Helper 统计的
**活跃天数前 5 的公司**，每行包含公司 logo/名称、联盟 logo/名称，以及 zKillboard 跳转。

本文件记录需求边界、两端改动和部署配置。

## 1. 需求边界（已确认）

| 项目 | 决定 |
|---|---|
| 数据来源 | J-Space Helper 新增的只读集成接口（共享 token 鉴权） |
| 调用路径 | 浏览器 → Wanderer（LiveView 事件）→ J-Space Helper；浏览器不直连 |
| 保护名单 | 集成接口不使用 `protected_*` 名单（保护只约束交互式搜索页面） |
| 显示范围 | 只显示 J 空间；其他星系显示提示 |
| 排行 | 固定按活跃天数取前 5 |

不读取 EVE 客户端日志/文件；跟随行为复用既有的 `useDesktopActiveSystem`（标题匹配 + 位置）。

## 2. 结构

```
浏览器 (React 挂件)
   │  pushEvent "get_jspace_corporations" { system_id, limit }
   ▼
MapLive → MapEventHandler → MapJspaceEventHandler        (lib/wanderer_app_web/live/map/...)
   │  缓存命中就直接回复；未命中才发请求
   ▼
WandererApp.Jspace.Client                                 (lib/wanderer_app/jspace/client.ex)
   │  GET {JSPACE_BASE_URL}/api/integration/v1/systems/:id/corporations
   │  X-Integration-Token: {JSPACE_API_TOKEN}
   ▼
J-Space Helper (Go) → MySQL killmail_union
```

浏览器不直连的原因：J-Space Helper 的集成接口用共享 token 鉴权、没有用户会话，也不发 CORS 头；
地图页的 CSP 又把 `connect-src` 限制为 `'self'`。放在服务端代理同时可以共享缓存。

## 3. J-Space Helper 侧

改动位于 `/home/saber/work/eve/j-space-helper`：

- `internal/config/config.go`：新增 `Integration.Token`。
- `configs/config.yaml`：

  ```yaml
  integration:
    token: ""   # 与 Wanderer 的 JSPACE_API_TOKEN 一致；留空则整个 /api/integration 返回 404
  ```

- `internal/http/middleware/integration_auth.go`：`RequireIntegrationToken`，空 token 直接 404，
  `X-Integration-Token` 用常量时间比较，不匹配返回 401。
- `internal/http/handlers/integration_handler.go` + `internal/service/integration_service.go`：
  `GET /api/integration/v1/systems/:system_id/corporations?days=&limit=`，`limit` 默认 5、上限 20，
  `days` 不得超过入库回看天数。
- `internal/repository/repository.go`：`GetTopCorporationsInSystemByActiveDays` 按
  `COUNT(DISTINCT killmail_dt) DESC, COUNT(DISTINCT killmail_id) DESC, corporation_id ASC`
  排序，保证并列时结果稳定。
- 响应：`{ system, reason?, lookback_days, corporations[] }`；非虫洞星系返回
  `reason: "not_jspace"`，无数据返回 `reason: "no_data"`。公司/联盟名先查本地 ESI 缓存，
  缺失时批量补查；失败时退化为 `Corp#id` / `Alliance#id`，不影响整个请求。

## 4. Wanderer 侧

### 4.1 配置（`config/runtime.exs`）

| 环境变量 | 说明 |
|---|---|
| `JSPACE_BASE_URL` | J-Space Helper 地址，例如 `https://jspace.20mm.cn` |
| `JSPACE_API_TOKEN` | 共享 token，必须与 `integration.token` 一致 |
| `JSPACE_TIMEOUT_MS` | 单次请求超时，默认 3000 |
| `JSPACE_CACHE_TTL_MS` | 成功结果缓存时间，默认 300000（5 分钟） |

`BASE_URL` 或 `TOKEN` 为空时挂件提示 “not configured”，不会向未鉴权的地址发请求。

### 4.2 代码

- `lib/wanderer_app/jspace/client.ex`：Req 调用、错误归一化。
- `lib/wanderer_app_web/live/map/event_handlers/map_jspace_event_handler.ex`：
  `get_jspace_corporations` 事件，缓存 key `jspace:system:{id}:{limit}`；成功缓存 5 分钟，
  失败缓存 60 秒（避免下游故障时每个用户每次都重试）。
- `lib/wanderer_app_web/live/map/map_event_handler.ex`：把该 UI 事件加入白名单。

错误码：`jspace_not_configured` / `jspace_unavailable` / `jspace_timeout` / `unknown_system`。

事件由 LiveView 同步回复（与 `get_system_kills` 一致），因此只在缓存未命中时阻塞该连接，
超时上限为 `JSPACE_TIMEOUT_MS`。

### 4.3 前端

- `assets/js/hooks/Mapper/components/mapInterface/widgets/JspaceWidget/`：
  - `JspaceWidget.tsx`：按 `useDesktopActiveSystem` 取星系；静态信息已知且不是虫洞时直接提示，
    未知时交给服务端判断（`reason: "not_jspace"` 同样提示）。
  - `hooks/useJspaceCorporations.ts`：`OutCommand.getJspaceCorporations`，请求序号防止旧响应覆盖。
  - `components/JspaceCorporationRow.tsx`：公司/联盟 logo 与名称，点击进入对应 zKillboard。
- 注册：`WidgetsIds.jspace`、`DEFAULT_WIDGETS`（默认隐藏）、`WIDGETS_CHECKBOXES_PROPS`。
- 设置迁移 `to_4`：旧版本设置里没有该挂件的窗口描述，迁移时补齐缺失项；可见性不变，
  用户仍需在“地图设置 → 挂件”中打开。
- `STORED_SETTINGS_VERSION` 提升到 4。

### 4.4 桌面客户端

- `desktop/types.ts` 的 `DesktopWidget` 增加 `'jspace'`；`MapRootContent`、`DesktopWidgetBar`
  （标签“J空间”、窗口切换）同步。
- `MapLive.@desktop_widgets` 增加 `jspace`；`windows.rs` 的 `open_widget` 增加窗口尺寸。
- 独立窗口同样通过 LiveView 事件取数，遵循“跟随客户端星系 / 主图选择”回退逻辑。

## 5. 部署检查

1. J-Space Helper：`integration.token` 设置为随机串，重启服务。
2. Wanderer：配置 `JSPACE_BASE_URL` 与相同的 `JSPACE_API_TOKEN`，重启后打开挂件。
3. 联调：`curl -H "X-Integration-Token: <token>" "$JSPACE_BASE_URL/api/integration/v1/systems/<J系ID>/corporations?limit=5"`。
4. 回归：`mix compile`、`cd assets && npm run build`、`go test ./...`（jspace）。

## 6. 已知取舍

- 只做前 5、只按活跃天数排序；需要更多指标（KB 数、最近活跃时间）时扩展集成接口参数即可。
- 服务端不做“权限/订阅”判断：数据来自公开击杀数据，与地图订阅无关。
- 集成接口维护在服务端，浏览器端无法枚举 J-Space Helper 的其它页面权限。
