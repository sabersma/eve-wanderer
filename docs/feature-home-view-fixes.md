# Feature: Home 视图位置/布局/实时同步修复

> **分支**: `feature/sfi`
> **日期**: 2026-08-14
> **作者**: zhouting
>
> 本文档记录 home 视图下位置抖动、布局重叠、锁定拖拽、窗口最小化恢复等问题的修复，便于后续合并上游仓库时解决冲突。

---

## 功能清单

| # | 功能 | 说明 |
|---|------|------|
| 1 | 标签/状态更新不再动位置 | `useMapUpdateSystems` 在 home 视图只更新 data，不覆盖 position |
| 2 | 锁定/解锁正确同步拖拽 | home 视图更新 data 时同步 draggable/deletable |
| 3 | BFS 分支隔离 | `computeBfsLayout` 移植后端分支隔离，避免多分支重叠 |
| 4 | 孤立星系保持用户位置 | 孤立星系重排时保持 currentLayout，不再被数据坐标覆盖 |
| 5 | relayout 精准触发 | `relayoutIds` 改为检测"新增连接"，不再误判 |
| 6 | 窗口最小化恢复 | 增加 blur/focus 触发 ui_loaded，后端放开 nil 版本检查 |

---

## 修改文件清单

### 前端

| 文件 | 功能 |
|------|------|
| `assets/js/hooks/Mapper/components/map/hooks/api/useMapUpdateSystems.ts` | 1/2 | ref 读最新 viewMode；home 视图只更新 data + draggable/deletable |
| `assets/js/hooks/Mapper/components/map/hooks/useMapHandlers.ts` | 1 | 传入 viewMode |
| `assets/js/hooks/Mapper/components/mapWrapper/MapWrapper.tsx` | 1 | 移除冗余 updateSystems 覆盖、ref 里的 viewMode/layoutPositions |
| `assets/js/hooks/Mapper/components/map/helpers/layout.ts` | 3/4 | BFS 分支隔离 + 孤立星系保持 currentLayout |
| `assets/js/hooks/Mapper/components/mapWrapper/hooks/useViewLayout.ts` | 5 | relayoutIds 改为"新增连接"检测 |
| `assets/js/hooks/Mapper/useMapperHandlers.ts` | 6 | 增加 blur/focus 监听补触发 ui_loaded |

### 后端

| 文件 | 功能 |
|------|------|
| `lib/wanderer_app_web/live/map/event_handlers/map_core_event_handler.ex` | 6 | ui_loaded 版本号为 nil 时允许重推 init |

---

## 详细设计

### 1/2. 标签/锁定更新不再动位置（useMapUpdateSystems）

**根因**：
- `useMapHandlers` 的 `useImperativeHandle` 依赖为 `[]`，`command` 闭包固定捕获首次渲染的 `mapUpdateSystems`（当时 viewMode 还是 `'all'`），导致切到 home 后仍走 `convertSystem2Node`（数据坐标）覆盖 position。
- 即使修正 viewMode 传递，home 视图也漏了 draggable/deletable 的同步（`convertSystem2Node` 里 `draggable: !locked`），导致锁定/解锁后拖拽状态不更新。

**修复**：`useMapUpdateSystems` 改用 `ref.current` 读最新 viewMode（与 `useMapInit` 一致），home 视图分支：

```ts
return { ...node, data: system, draggable: !system.locked, deletable: !system.locked };
```

即保持 position（本地布局坐标）不变，只更新 data 和拖拽标志。

### 3. BFS 分支隔离（computeBfsLayout）

移植后端 `rearrange_systems` 的分支隔离逻辑：

- BFS 新增 `branchRoot`（home 直接子节点为独立分支，后代继承）
- 按 `{direction, branchRoot}` 分组，左右两侧分开
- 新增 `layoutSide`：每分支算高度（`max_per_depth × spacing_y + margin`）、纵向堆叠、分支内按 depth 列展开 + 父对齐
- 关键修正：depth=1 节点用 `branchCenterY`（分支中心）而非 `home.y`，避免不同分支的 depth-1 节点重叠

### 4. 孤立星系保持用户位置

`computeBfsLayout` 末尾，对孤立星系（无连接）保持 `currentLayout`（用户拖动的位置）：

```ts
if (connectedIds.has(s.id)) continue;
positions[s.id] = currentLayout?.[s.id] ?? { x: s.position.x, y: s.position.y };
```

避免 rearrange 把孤立星系重置回数据坐标（all 模式位置）。

### 5. relayoutIds 精准触发

原检测"位置 == 数据坐标"在全局坐标恰好是 BFS 布局时（如全局 rearrange 后）会误判。改为**对比上一帧 `filteredConnections` 检测"新增连接"**：

```ts
const prevConnections = prevConnectionsRef.current;
prevConnectionsRef.current = filteredConnections;
const newConnections = filteredConnections.filter(c => !prevConnections.some(p => p.id === c.id));
```

只对"新出现的连接"的端点星系重排，挪动/锁定/标签不再触发。

### 6. 窗口最小化恢复

- **前端**：`usePageVisibility` 用 `document.hidden` 检测不到窗口最小化（只检测标签页切换），故在 `useMapperHandlers` 增加 `window.blur`/`window.focus` 监听，窗口恢复焦点时补触发一次 `ui_loaded`。
- **后端**：`ui_loaded` 版本检查，前端 `wandererLastVersion` 首次加载后（延迟 reload 前）为 nil，导致 `to_string(nil) == to_string(app_version)` 恒 false 拦截重推。改为 `version_known? = not is_nil(version) and version != ""`，版本号未知时仍允许 `maybe_start_map` 重推 init。

---

## 关键设计决策

1. **position 与 data 解耦**：home 视图下 `update_system` 只更新 data，position 由本地布局（`useViewLayout`）单独维护，避免标签/锁定/状态更新拽动节点。
2. **用 ref 读最新状态**：`useMapUpdateSystems` 等被 `useImperativeHandle([])` 固定闭包捕获的 hook，统一用 `ref.current` 读最新 viewMode，规避闭包陈旧问题。
3. **relayout 只响应真实连接变化**：不用坐标启发式，改为对比连接增量，杜绝过滤/布局变化误触发。
4. **窗口可见性盲区补齐**：`document.hidden` 无法覆盖窗口最小化，用 blur/focus 补充，且版本检查对 nil 放行。

---

## 验证要点

1. home 视图改标签 → 位置不变、标签正常显示、无抖动。
2. home 视图锁定/解锁 → 拖拽状态正确同步，位置不变、不闪烁。
3. home 视图 rerange → 多分支隔离、无重叠，与全局视图布局逻辑一致。
4. 挪动星系 → 只有该星系动，链接星系不动。
5. 孤立星系（无连接）重排后保持拖动位置，不跟随 all 位置。
6. 窗口最小化 → 角色移动 → 恢复窗口，路径/角色自动补齐（ui_loaded 重推 init）。
7. 标签页切换、WebSocket 重连 → 数据正常恢复。

> 注：问题 3（窗口最小化偶发路径丢失）仍在持续观察中——已确认 ui_loaded 链路上半段正常（版本检查、maybe_start_map），断点在 handle_map_server_started → map_start 重推 init 的后续，待进一步加日志定位。
