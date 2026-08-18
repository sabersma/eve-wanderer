# ESI 频率限制导致角色位置更新失败 —— 实现方案

> 需求来源：生产日志出现成批 `ESI_RATE_LIMITED` 警告及周期性 "Location updates falling behind" 警告，用户偶发看到地图上角色位置不更新。方案见 `docs/ratelimit`（ESI 官方限流文档摘录）。

## 背景 / 根因

排查确认两个独立的、已验证的根因：

1. **单角色维度的结构性超额请求（主要原因）**。ESI 把 `/characters/{id}/location`、`/characters/{id}/online`、`/characters/{id}/ship` 三个接口归入同一个 token bucket（分组 `char-location`）：每 900 秒窗口 1200 tokens，每次成功响应消耗 2 tokens → 单角色可持续请求速率上限 **0.667 请求/秒（三个接口合计）**。旧轮询频率 location 1s + ship 2s + online 30s ≈ **1.533 请求/秒**，超出预算约 2.3 倍，属于与负载/角色数量无关的结构性问题。
2. **旧版全局错误限流没有断路器**。ESI 另有一套全应用共享的限流：每分钟最多 100 次非 2xx/3xx 响应，超出后所有 ESI 路由返回 420 直到窗口重置。30+ 个独立 `TrackerPool` GenServer 在 420 封禁期间会各自继续调用 ESI，浪费资源且可能延长封禁窗口。

此外还有一个较小缺陷：`tracker.ex` 的 429 退避逻辑从未读取 ESI 返回的 `Retry-After` 头，只认识 420 的头部字段，其余情况一律用固定短默认值，导致可能在真正允许重试之前就被重试。

## 方案与已实现改动

### 1. 重新分配 `char-location` 共享桶的轮询间隔（主要修复）

目标把合计消耗控制在预算的 ~80%（0.533 请求/秒），为错误响应（4xx 消耗 5 tokens）和突发流量留余量。location 为核心实时功能优先保障：

| 接口 | 旧值 | 新默认值 | 速率 |
| --- | --- | --- | --- |
| location | 1s | **2s** | 0.500 请求/秒 |
| ship | 2s | **60s** | 0.017 请求/秒 |
| online | 30s | **60s** | 0.017 请求/秒 |
| **合计** | 1.533 请求/秒 | | **0.533 请求/秒（预算的 80%）** |

- `lib/wanderer_app/character/tracker_pool.ex`：三个硬编码模块属性改为读取 `Application.get_env/3` 的私有函数（复用现有 `location_concurrency/0` 写法），6 处调用点同步替换。`@check_offline_characters_interval`、`@update_info_interval`、`@update_wallet_interval` 不变（不同限流分组）。
- `config/runtime.exs`：新增 3 个环境变量（`WANDERER_UPDATE_LOCATION_INTERVAL_MS` / `_SHIP_` / `_ONLINE_`，默认 2000/60000/60000），运维可直接调环境变量重新分配频率，无需改代码重新发布。

### 2. 修正 429 的 Retry-After 处理

`lib/wanderer_app/character/tracker.ex` 的 `get_reset_timeout/2` 新增一条分支，正确解析 429 响应里的 `retry-after` 头（用 `Integer.parse/1` 防御式解析，非法值退回原有默认 TTL）。无需改动任何调用点，`update_online/1`、`update_ship/1`、`update_location/1`、`update_wallet/1`、`maybe_update_corporation/2` 自动生效。

### 3. 为旧版 420 限流增加全局断路器

`lib/wanderer_app/esi/api_client.ex`：

- 新增 `esi_globally_rate_limited?/0`（读 `WandererApp.Cache` 里的 `"esi:global_blackout_until"` key）和 `mark_global_rate_limited/1`（按响应头 `x-esi-error-limit-reset` 设置 TTL），复用现有 Nebulex/ETS 缓存机制。
- `do_get_request/4`、`do_post_esi/3` 拆成「短路判断 + `_uncached` 主体」：命中全局封禁时直接返回 `{:error, :error_limited, %{}}`，不发起任何 HTTP 请求；两者各自的 420 分支在返回错误前调用 `mark_global_rate_limited/1`。
- **不**对 429 做全局断路（429 是单角色维度限流，已单独处理）；`do_post/2`（非 ESI 自定义路由服务）和 `refresh_token/1`（`login.eveonline.com`，非 ESI）保持不受影响。`tracker.ex` 无需改动，已统一处理 `{:error, :error_limited, headers}` 且对缺失头部字段有兜底。

### 4. 补充可观测性

`prom_ex_plugin.ex` 中定义的 `[:wanderer_app, :esi, :error]` 指标此前从未被 emit 过。新增 `emit_esi_error/2` 辅助函数，在 `do_get_request_uncached/4` 与 `do_post_esi_uncached/3` 的 504/404/403/401/未知状态码/Mint pool timeout/generic error 等非 2xx/3xx/420/429 分支中调用，纯增量修改，不改变任何控制流。

## 关键文件

- `lib/wanderer_app/character/tracker_pool.ex` —— 轮询间隔改为可配置函数
- `config/runtime.exs` —— 新增 3 个环境变量
- `lib/wanderer_app/character/tracker.ex` —— `get_reset_timeout/2` 新增 retry-after 分支
- `lib/wanderer_app/esi/api_client.ex` —— 全局断路器 + 错误 telemetry

## 验证结果

- `mix compile --warnings-as-errors`：改动文件无新增警告（另有 2 处与本次改动无关的既有警告，位于 `map_pings_event_handler.ex`、`map_audit_api_controller.ex`）。
- `mix format --check-formatted`：通过。
- `mix credo --strict`：仅既有问题（implicit try、命名规范、negated if 等），无新增。
- `mix dialyzer`：改动前后对比，警告总数一致（154 条），逐条比对确认为同一批既有警告随插入行数整体下移，**无新增警告**。
- `mix test`：900 tests，16 failures，均为既有失败且与本次改动文件无关（`AuthControllerTest`、`SlugRecoveryTest`、`MapScopesTest`），与 tracker/tracker_pool/api_client/ESI 无关。

## 已知边界 / 说明

- 这三个模块目前没有直接的单元测试覆盖，验证以编译/静态检查/手动 `iex` 检查为主。
- 前端无改动，本次修复不涉及 `make deploy`。
- 生产观察建议：上线后关注一个完整 900 秒窗口内 `ESI_RATE_LIMITED` 出现频率是否明显下降，以及新增的 `wanderer_app_esi_error_count` 指标（PromEx/Grafana）。
