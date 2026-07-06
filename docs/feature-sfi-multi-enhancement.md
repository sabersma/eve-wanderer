# Feature: 多特性增强 (SFI Multi-Enhancement)

> **分支**: `feature/sfi`
> **日期**: 2026-07-05 ~ 2026-07-08
> **作者**: zhouting
>
> 本文档记录本次会话中实现的所有功能变更，便于后续合并上游仓库时解决冲突。

---

## 功能清单

| # | 功能 | 说明 |
|---|------|------|
| 1 | 自动隐藏恢复修复 | 修复取消隐藏时连接不恢复、位置不调整、刷新后隐藏星系泄漏的问题 |
| 2 | 隐藏星系过期清理 | 隐藏超过 1 天的星系和连接自动从数据库清理 |
| 3 | 虫洞信号清理优化 | 虫洞信号 1 天过期，非虫洞信号 2 天过期 |
| 4 | System Info 最后修改者 | 星系设置窗口中显示每个字段的最后修改者 |
| 5 | 无修改不产生记录 | Save 时如果值未变化（trim 后）不产生审计记录 |
| 6 | 基于 home 的层级布局 | BFS 层级扩散布局，支持一键重排、分支区域隔离、水平连线对齐 |
| 7 | 多 home/friendly 集群隔离 | locked home/friendly 作为 BFS 边界，方向自动远离，避免跨集群冲突 |

---

## 修改文件清单

| 文件 | 涉及功能 | 变更量 |
|------|----------|--------|
| `lib/wanderer_app/map.ex` | 1/6 | 新增 `update_system_visibility`(修复), `update_system_cache_position` |
| `lib/wanderer_app/map/map_garbage_collector.ex` | 2/3 | 新增 `cleanup_orphaned_connections`, 修改 `cleanup_system_signatures` |
| `lib/wanderer_app/map/map_position_calculator.ex` | 6 | 新增 `get_level_position`, `find_available_vertical_position` |
| `lib/wanderer_app/map/server/map_server_connections_impl.ex` | 1 | 重写 `unhide_component_systems`, 修复 `bfs_hidden_component` |
| `lib/wanderer_app/map/server/map_server_impl.ex` | 1 | 新增 2 个 delegate |
| `lib/wanderer_app/map/server/map_server_systems_impl.ex` | 2/6/7 | 新增层级布局核心、隐藏清理、重排逻辑 |
| `lib/wanderer_app_web/live/map/event_handlers/map_core_event_handler.ex` | 1 | `get_map_data` 过滤隐藏系统和无效连接 |
| `lib/wanderer_app_web/live/map/event_handlers/map_systems_event_handler.ex` | 4/6 | 新增 `rearrange_systems`、`get_system_last_modified`、无修改跳过 |
| `lib/wanderer_app_web/live/map/map_event_handler.ex` | 4/6 | 注册新 UI 事件 |
| `lib/wanderer_app/security_audit.ex` | 4 | 新增 `get_system_last_modified` 查询 |
| `assets/js/hooks/Mapper/types/mapHandlers.ts` | 4/6 | 新增 `rearrangeSystems`, `getSystemLastModified` |
| `assets/js/hooks/Mapper/components/contexts/ContextMenuSystem/` | 4/6 | 新增重排菜单项、最后修改者显示保存去重 |
| `assets/js/hooks/Mapper/components/mapInterface/components/SystemSettingsDialog/SystemSettingsDialog.tsx` | 4/5 | 显示最后修改者、保存去重 |
| `config/runtime.exs` | 2 | 新增 `cleanup_orphaned_connections` 调度 |

---

## 详细变更

### 1. 自动隐藏恢复修复

**问题**: 删除 A-B 连接后 BCD 被隐藏，重新连接 A-B 时三个问题：
- B-C、C-D 连接不恢复
- BCD 位置不自动调整到 A 附近
- 刷新页面后隐藏星系重新出现

**修复**:

- `unhide_component_systems` 改用传入的 `all_connections`（合并了缓存+DB 连接），而非重新查询 DB。恢复连接时双向检查缓存 key（`"A_B"` 和 `"B_A"`）。
- 新增桥接连接检测：一端可见一端隐藏的连线作为锚点，将隐藏组件整体偏移到可见系统附近（150px 确定偏移）。
- `get_map_data` 过滤 `visible: false` 系统和不含可见端点的连接。
- `bfs_hidden_component` 修复返回元组 bug：改为只返回 component MapSet。
- `map.ex` 新增 `update_system_cache_position` 同步缓存中的位置。

### 2. 隐藏星系过期清理

- `@hidden_system_expire_hours 24`（1 天过期）
- `do_cleanup_hidden_systems(map_id)`：查询 DB 中 `visible=false` 且 `updated_at` 超过 1 天的星系，安全检查（无角色）后删除系统及其 DB 连接。
- `cleanup_orphaned_connections`（每天执行）：清理端点系统已被删除的孤立连接。

### 3. 虫洞信号清理优化

`cleanup_system_signatures` 改为分两轮：
- 虫洞信号（`group == "Wormhole"`）：超过 1 天删除
- 其他信号：超过 2 天删除

### 4. System Info 最后修改者 + 无修改不产生记录

- `SecurityAudit.get_system_last_modified/2`：查询 UserActivity 表中 `:system_updated` 事件，对每个字段（name/labels/description）返回最近修改的角色名。
- 前端 `SystemSettingsDialog` 在 custom_name、custom_label、description 下方显示 "Last modified by: {name}"。
- 保存时对比 trim 后的新旧值，未变化则不发送 update 命令。

### 6. 基于 home 的层级布局（BFS Level Layout）

**核心算法** (`map_server_systems_impl.ex`):

- **bfs_rearrange_metadata**: BFS 从 home 出发，追踪 depth、direction、parent、branch_root、excluded
- **compute_rearrange_positions**: 纯数学预计算所有位置（不依赖 R-tree），完全确定性
- **find_closest_y**: 父子 Y 对齐，冲突时上下搜索最近空位

**行为**:
- 有 home 时，新系统按 BFS 深度分级排列到对应列
- 同分支系统被划分到独立的纵向区域，避免交叉
- 子节点优先对齐父节点 Y 坐标（水平连线）
- 新增系统复用同样的分支感知、父对齐逻辑（增量一致）

**右键菜单**: home 星系右键新增 "Re-arrange layout"，一键重排整个集群。

### 7. 多 home/friendly 集群隔离

- BFS 遇到 `locked == true && status in [home, friendly]` 的系统完全停止遍历（不入队）
- home A 扫描直接邻居，如果某侧有 locked home/friendly，则该侧的非 home 邻居方向翻转
- 各集群独立排列，各自向远离其他集群的方向扩展

---

## 关键设计决策

1. **软隐藏而非删除**: 系统标记 `visible: false`，连接从缓存移除但保留在 DB，支持恢复
2. **过期清理**: 隐藏 1 天后自动从 DB 删除，防止数据无限堆积
3. **确定性布局**: 重排时预计算所有位置再批量更新，不依赖 R-tree 顺序
4. **分支区域隔离**: 每个 home 的直接子节点独占纵向区域，子树内所有系统集中排列
5. **多 home/friendly 互不干扰**: locked home/friendly 作为 BFS 硬边界，方向自动远离

---

## 验证要点

1. 删除连接 → 孤立系统自动隐藏 → 重连 → 系统恢复，连接恢复，位置调整到附近
2. 刷新页面后隐藏系统不出现
3. 隐藏超过 1 天 → 系统和连接从 DB 清理
4. 右键 home → Re-arrange → 多次点击结果一致，连线尽量水平
5. 两个 locked home/friendly 共存 → 各自独立排列，互不干扰
6. 角色移动到新星系 → 新系统按层级布局放置
7. Save 无修改值 → 不产生审计记录
8. System Settings 显示最后修改者
