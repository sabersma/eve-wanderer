# J-Space Helper 挂件（活跃公司排行）

地图新增 `J-Space` 挂件：对当前星系（跟随 EVE 客户端或主图选中）展示 J-Space Helper 统计的
**活跃天数前 5 的公司**（默认显示前 3，可展开），顶部先展示星系类型/效果/破碎标记。
每行包含公司 logo/名称、联盟 logo/名称、活跃天数、当前活跃等级、推断活跃时区，以及 zKillboard 跳转。

本文件记录需求边界、两端改动和部署配置。

## 1. 需求边界（已确认）

| 项目 | 决定 |
|---|---|
| 数据来源 | J-Space Helper 新增的只读集成接口（共享 token 鉴权） |
| 调用路径 | 浏览器 → Wanderer（LiveView 事件）→ J-Space Helper；浏览器不直连 |
| 保护名单 | 集成接口不使用 `protected_*` 名单（保护只约束交互式搜索页面） |
| 显示范围 | 只显示 J 空间；其他星系显示提示 |
| 排行 | 固定按活跃天数取前 5，默认展开前 3 |
| 星系信息 | 顶部展示星系名、虫洞等级/静态、效果与破碎标记 |
| 活跃提示 | 高 / 中 / 低 / 无；综合最近击杀与当前 UTC 小时是否落在该公司的活跃时段 |
| 活跃时区 | 由回看窗口内 24 小时击杀分布推断，返回 UTC 偏移与峰值时段 |

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
  排序，保证并列时结果稳定，并带回 `MAX(killmail_dt)` 作为最近活跃日期。
  `GetCorporationHourlyKills` 用一条 `GROUP BY corporation_id, killmail_hr` 查询取回各公司
  的 24 小时 UTC 分布。
- 响应：`{ system, reason?, lookback_days, corporations[] }`；非虫洞星系返回
  `reason: "not_jspace"`，无数据返回 `reason: "no_data"`。公司/联盟名先查本地 ESI 缓存，
  缺失时批量补查；失败时退化为 `Corp#id` / `Alliance#id`，不影响整个请求。
- 每家公司新增字段：

  | 字段 | 说明 |
  |---|---|
  | `last_active_days` | 距最近一次击杀的整天数（0 = 今天，UTC） |
  | `activity_level` | `high` / `medium` / `low` / `none` |
  | `timezone_offset` | 推断的 UTC 偏移（-12..+14），样本不足时省略 |
  | `active_window_utc` | 推断的峰值活跃时段 `{start, end}`（UTC 整点，含端点，可跨午夜） |

  等级规则：14 天无击杀为 `none`；最近 7 天有击杀且当前 UTC 小时落在峰值 3 小时窗口内为
  `high`；当前 UTC 小时属于覆盖 70% 击杀的核心小时为 `medium`；其余仍算 `low`。
  时区推断假设公司活跃高峰在本地 21:00 前后，并用 3 小时峰值窗口反推 UTC 偏移；
  总击杀少于 10 条、或峰值窗口不足全部击杀 35%（活跃过于分散）时不输出，避免噪声。

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
    未知时交给服务端判断（`reason: "not_jspace"` 同样提示）。星系信息（名称、中文名、虫洞等级、
    静态、效果、破碎标记）与 J-Space Helper 链接、刷新按钮统一渲染在挂件表头；表头使用左对齐的
    `flex-wrap` 布局，窄窗口时自动换行而不是把链接或等级挤出右侧。下方直接是公司列表，列表默认
    只渲染前 3 行，多于 3 行时显示 “Show all” 展开按钮。
  - `hooks/useJspaceCorporations.ts`：`OutCommand.getJspaceCorporations`，请求序号防止旧响应覆盖。
  - `components/JspaceCorporationRow.tsx`：公司/联盟 logo 与名称；活跃天数紧跟公司名（不再被
    `flex-1` 推到窗口右侧）；第三行展示活动等级徽标与推断时区（本地时间窗口）。点击进入
    zKillboard。
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

- 只做前 5、只按活跃天数排序；需要更多公司时同步调整接口 `limit` 与前端展示。
- 活跃时区是**推断值**：只用 UTC 小时分布和“本地 21:00 高峰”假设，无法区分相隔 24 小时的
  时区（例如 UTC+12 与 UTC-12），优先取正偏移；样本少于 10 条击杀时不显示。
- 活跃等级在 J-Space Helper 响应时计算，并由 Wanderer 缓存 5 分钟，因此跨整点时最多滞后
  5 分钟；它表示“该公司现在是否可能在线”，不是实时在线状态。
- 服务端不做“权限/订阅”判断：数据来自公开击杀数据，与地图订阅无关。
- 集成接口维护在服务端，浏览器端无法枚举 J-Space Helper 的其它页面权限。
