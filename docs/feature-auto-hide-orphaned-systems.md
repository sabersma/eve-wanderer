# Feature: 自动隐藏孤立星系节点 (Auto-Hide Orphaned Star Systems)

> **分支**: `feature/sfi`
> **日期**: 2026-06-09
> **作者**: zhouting
>
> 本文档用于记录本次功能变更的详细信息，便于后续合并上游仓库（wanderer-industries/wanderer）时解决冲突。

---

## 功能概述

在地图删除链接时，如果链接某一侧的所有星系节点中：
- 没有任何角色存在
- 没有 status 为 `home` (1) 或 `friendly` (2) 的节点
- 没有被锁定的节点

则自动将这些孤立节点及其内部链接隐藏（设置 `visible: false`），而非永久删除。

当玩家重新进入这些隐藏星系之一，或手动创建连接到这些隐藏星系之一时，自动重新显示整个被隐藏的组件。

---

## 修改文件清单

| 文件 | 变更 | 行数 |
|------|------|------|
| `.gitignore` | 添加 `.claude` 目录 | +1 |
| `lib/wanderer_app/map.ex` | 新增 2 个辅助函数 | +30 |
| `lib/wanderer_app/map/server/map_server_connections_impl.ex` | 核心逻辑：自动隐藏/取消隐藏 | +340 / -3 |
| `lib/wanderer_app/map/server/map_server_impl.ex` | 新增 2 个委托函数 | +2 |
| `lib/wanderer_app/map/server/map_server_systems_impl.ex` | 角色进入时级联取消隐藏 | +7 |

---

## 详细变更说明

### 1. `lib/wanderer_app/map.ex` — 新增辅助函数

在 `find_system_by_location/2` 之后添加了以下两个函数：

```elixir
# 查找系统（不过滤 visible 字段，可用于检查隐藏系统）
def find_system_by_location_any(map_id, location)

# 更新缓存中系统的 visible 字段
def update_system_visibility(map_id, solar_system_id, visible)
```

**合并注意**: 如果是上游在 `find_system_by_location` 附近有修改，保留双方的改动即可。这两个新函数是纯新增，不修改现有函数。

---

### 2. `lib/wanderer_app/map/server/map_server_connections_impl.ex` — 核心逻辑（改动最大）

#### 2.1 `maybe_remove_connection/3` (约第 1017 行)

**原逻辑**: 删除连接 → 广播 → 清除缓存 → 返回。

**新增**: 在最后一步调用 `maybe_auto_hide_orphaned_systems(map_id, source_id, target_id)` 进行自动隐藏检查。

同时将原来的 `location.solar_system_id` / `old_location.solar_system_id` 提取为本地变量 `source_id` / `target_id` 以便复用。

#### 2.2 `maybe_add_connection/5` (约第 714 行)

**原逻辑**: 追踪活动 → 返回 `:ok`。

**新增**: 在返回 `:ok` 之前调用 `maybe_unhide_if_hidden/2` 检查源和目标系统是否需要取消隐藏。

```elixir
maybe_unhide_if_hidden(map_id, old_location.solar_system_id)
maybe_unhide_if_hidden(map_id, location.solar_system_id)
```

#### 2.3 新增公开函数

| 函数 | 说明 |
|------|------|
| `maybe_auto_hide_orphaned_systems/3` | 删除链接后检查是否需要自动隐藏孤立组件 |
| `maybe_unhide_connected_systems/2` | 取消隐藏指定系统所在的所有隐藏组件 |

#### 2.4 新增私有函数

| 函数 | 说明 |
|------|------|
| `maybe_unhide_if_hidden/2` | 检查系统是否隐藏，若是则级联取消隐藏 |
| `build_connection_adjacency/1` | 从连接列表构建双向邻接表 |
| `get_connected_component/4` | BFS 从起点找到所有可达系统（不过滤可见性） |
| `bfs_collect/4` | BFS 收集辅助函数 |
| `bfs_hidden_component/4` | BFS 遍历仅 hidden 的系统（遇 visible 停止） |
| `bfs_hidden_collect/5` | BFS 隐藏组件收集辅助函数 |
| `should_hide_component?/3` | 判断组件是否应该被隐藏 |
| `hide_component_systems/3` | 执行隐藏操作（设置 visible=false，移除缓存连接） |
| `unhide_component_systems/4` | 执行取消隐藏操作（恢复 visible=true，从 DB 恢复连接） |

**合并注意**: 
- `maybe_remove_connection` 和 `maybe_add_connection` 的改动较小，合并时注意保留 `source_id`/`target_id` 变量以及新增的函数调用
- 新增的 ~300 行代码全部集中在 `maybe_remove_connection` 和 `update_connection` 之间，可以整块迁移
- 这些函数都使用了 `WandererApp.MapSystemRepo` 和 `WandererApp.MapConnectionRepo`，如果上游修改了这些 repo 的 API，需要相应调整

---

### 3. `lib/wanderer_app/map/server/map_server_systems_impl.ex` — 角色进入时取消隐藏

#### 3.1 添加 alias (约第 7 行)

```elixir
alias WandererApp.Map.Server.ConnectionsImpl
```

#### 3.2 `do_add_system_from_location/4` 中的两处修改

**现有系统变可见**（第 640 行附近，`update_visible!(%{visible: true})` 之后）:

```elixir
ConnectionsImpl.maybe_unhide_connected_systems(map_id, updated_system.solar_system_id)
```

**新系统创建**（第 696 行附近，`upsert` 成功后）:

```elixir
ConnectionsImpl.maybe_unhide_connected_systems(map_id, system.solar_system_id)
```

**合并注意**: 两处修改都是在 `ExternalEvents.broadcast` 之后、`:telemetry.execute` 之前。合并时只需确保 `ConnectionsImpl.maybe_unhide_connected_systems` 调用保留在正确位置。

---

### 4. `lib/wanderer_app/map/server/map_server_impl.ex` — 新增委托

在 `defdelegate cleanup_connections` 之后添加：

```elixir
defdelegate maybe_auto_hide_orphaned_systems(map_id, source_id, target_id), to: ConnectionsImpl
defdelegate maybe_unhide_connected_systems(map_id, solar_system_id), to: ConnectionsImpl
```

**合并注意**: 纯新增，两行委托。

---

### 5. `.gitignore` — 忽略 `.claude` 目录

添加了 `.claude` 到 `.gitignore`。这是 IDE 工具目录，与功能无关。如果上游也有类似修改，任选一个即可。

---

## 依赖关系

```
map.ex (新增 find_system_by_location_any, update_system_visibility)
  ↓
map_server_connections_impl.ex (使用上述函数 + MapSystemRepo + MapConnectionRepo)
  ↓
map_server_systems_impl.ex (调用 ConnectionsImpl.maybe_unhide_connected_systems)
  ↓
map_server_impl.ex (委托 ConnectionsImpl 的公开函数)
```

---

## 关键设计决策

1. **软隐藏而非删除**: 系统标记 `visible: false`，保留 DB 中的位置、状态、标签等数据
2. **连接保留在 DB 中**: 隐藏组件的内部连接从缓存中移除但保留在 DB 中，取消隐藏时从 DB 恢复
3. **取消隐藏时从 DB 查询连接**: 因为隐藏的连接不在缓存中，`unhide_component_systems` 使用 `MapConnectionRepo.get_by_map` 查询 DB 来恢复连接
4. **BFS 遍历仅限隐藏系统**: 取消隐藏时 BFS 遍历只在 `visible: false` 的系统间传播，遇到 `visible: true` 的系统停止
5. **前端透明**: 使用已有的广播事件 (`:systems_removed`, `:add_system`, `:add_connection`, `:remove_connections`)，前端无需修改

---

## 验证步骤

1. **自动隐藏**: 创建 home-A-B-C 线性连接 → 删除 A-B → B 和 C 应自动消失
2. **不隐藏(有 home)**: B 设为 status=home → 删除 A-B → B 和 C 不消失
3. **不隐藏(有角色)**: 角色在 C → 删除 A-B → B 和 C 不消失
4. **角色进入恢复**: 隐藏链 B-C → 角色跳入 B → B 和 C 重新出现
5. **手动连接恢复**: 隐藏链 B-C → 手动创建 home-B 连接 → B 和 C 重新出现
6. **运行现有测试**: `mix test` 确保无回归

---

## 合并时常见冲突场景

| 冲突位置 | 可能原因 | 解决策略 |
|----------|----------|----------|
| `map.ex` 的 `find_system_by_location` 附近 | 上游修改了同名函数 | 保留双方的函数，确保新函数放在合适位置 |
| `connections_impl.ex` 的 `maybe_remove_connection` | 上游调整了删除逻辑 | 合并时保留 `source_id`/`target_id` 变量和 `maybe_auto_hide_orphaned_systems` 调用 |
| `connections_impl.ex` 的 `maybe_add_connection` | 上游调整了添加逻辑 | 保留 `maybe_unhide_if_hidden` 两行调用 |
| `systems_impl.ex` 的 alias 区域 | 上游添加了新 alias | 保留 `ConnectionsImpl` alias |
| `systems_impl.ex` 的 `do_add_system_from_location` | 上游修改了系统添加逻辑 | 保留两处 `maybe_unhide_connected_systems` 调用 |
| `map_server_impl.ex` 的 delegate 区域 | 上游添加了新 delegate | 保留两行新 delegate |
| `MapConnectionRepo` / `MapSystemRepo` API 变更 | 上游修改了 repo 函数签名 | 检查 `get_by_map`、`get_by_map_and_solar_system_id`、`update_visible!` 等函数是否变更 |
