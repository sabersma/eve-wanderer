# Feature: Home 根节点视图模式 (Home Root View Mode)

> **分支**: `feature/sfi`
> **日期**: 2026-08-13
> **作者**: zhouting
>
> 本文档记录"按 home 星系作为根节点查看地图"功能的实现与后续修复，便于合并上游仓库时解决冲突。

---

## 背景

当前地图基于权限组（ACL），同一权限组所有角色的位置变化都体现在同一张画布上，星系状态可设置 home / friendly 等标注。

**痛点**：多人各自以不同星系作为 home 时，大部分时候只想关注自己 home 星系的连接图，偶尔才需要看"所有星系"或其他 home 为根的星系图。现有实现不支持这种"按根节点过滤视图"的需求。

**目标**：
- 可查看所有星系（原行为），也可按某个 home 星系为根节点，只看与其直接/间接相连的星系。
- 锁定（locked）星系无论切到哪个根节点或"查看所有"，都始终展示。
- 不同视图（所有 / 每个 home）使用**独立布局**，避免多人共享同一画布导致的布局互相干扰。

---

## 功能清单

| # | 功能 | 说明 |
|---|------|------|
| 1 | 视图模式切换 | Topbar 增加「全部 / 按 Home」切换，选择 home 后以该星系为根展示连通图 |
| 2 | 连通分量过滤 | home 视图 BFS 过滤，只显示与 home 直接/间接相连的星系 |
| 3 | home/locked 语义 | `effectiveLocked = locked && status !== home`；home+locked 在别的 home 视图当普通节点 |
| 4 | per-view 独立布局 | all 视图用全局共享坐标；home 视图用本地布局（localStorage），拖拽只改本地 |
| 5 | BFS 自动布局 | home 视图首次进入自动 BFS 树状布局，之后增量维护（新增节点算位置、删除清理） |
| 6 | viewMode 隔离存储 | viewMode 独立 localStorage + 禁跨标签页同步，多标签页互不覆盖 |
| 7 | 孤立星系可见 | home 视图下孤立星系（无连接）也显示，便于手动添加后连线 |

---

## 修改文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `assets/js/hooks/Mapper/components/map/helpers/layout.ts` | BFS 布局算法 `computeBfsLayout` + 增量 `computeNewNodePosition` |
| `assets/js/hooks/Mapper/components/mapRootContent/components/ViewModeSelector/` | 视图切换 UI 组件（按钮 + home 下拉） |
| `assets/js/hooks/Mapper/components/mapWrapper/hooks/useFilteredMapData.ts` | 连通分量过滤 + effectiveLocked 计算 |
| `assets/js/hooks/Mapper/components/mapWrapper/hooks/useViewLayout.ts` | per-view 本地布局存储、增量维护、rearrangeLayout |
| `assets/js/hooks/Mapper/mapRootProvider/hooks/useViewModeSettings.ts` | viewMode 独立 localStorage（storageSync: false） |

### 修改

| 文件 | 说明 |
|------|------|
| `assets/js/hooks/Mapper/mapRootProvider/MapRootProvider.tsx` | `MapRootData` 新增 `viewMode`/`selectedHomeSystemId`，接 useViewModeSettings |
| `assets/js/hooks/Mapper/components/map/Map.tsx` | 接收 `layoutPositions`/`viewMode`，应用布局与 hidden |
| `assets/js/hooks/Mapper/components/map/hooks/api/useMapInit.ts` | init 重推时在 `rf.setNodes` 后覆盖回 home 布局 |
| `assets/js/hooks/Mapper/components/map/hooks/useMapHandlers.ts` | 传递 layoutPositions/viewMode |
| `assets/js/hooks/Mapper/components/mapRootContent/MapRootContent.tsx` | 集成 ViewModeSelector（菜单展开/收起两种布局） |
| `assets/js/hooks/Mapper/components/mapWrapper/MapWrapper.tsx` | 过滤接线、拖拽路由（home 写本地 / all 广播）、rearrange 本地化 |
| `config/dev.exs` | 禁用 tzdata 自动更新（修复 WSL 启动崩溃，非本功能核心） |

> 注：`types.ts`/`constants.ts`/`useMapUserSettings.ts`/`OldSettingsDialog.tsx` 曾临时加入 viewMode 字段，后因 viewMode 拆分为独立 hook 而移除，最终净变化为 0，不在提交中。

---

## 详细设计

### 1. 视图模式状态

- `MapRootData` 新增 `viewMode: 'all' | 'home'`、`selectedHomeSystemId: string | null`。
- `useViewModeSettings` 用独立 localStorage key `wanderer_view_mode_v1` 存储，`storageSync: false` 禁跨标签页同步（每个标签页 = 一个用户视角，互不覆盖）。

### 2. 连通分量过滤（useFilteredMapData）

home 视图下：
- 邻接表 BFS，从 `selectedHomeSystemId` + 所有 `effectiveLockedIds` 出发。
- 可见 = BFS 可达 ∪ effectiveLocked ∪ 孤立星系（无连接）。
- `effectiveLocked = locked && status !== STATUSES.home`（home 优先级更高，home+locked 当普通节点）。

### 3. per-view 布局（useViewLayout）

- all 视图：`layoutPositions` 返回全局数据坐标。
- home 视图：`layoutPositions` 来自本地缓存 `wanderer_view_layouts_v1`（`storageSync: false`）。
- 首次进入：`computeBfsLayout` 生成完整 BFS 布局并写入缓存。
- 增量：`useEffect` 检测 missing（新增节点用 `computeNewNodePosition` 算位置）和 deleted（删除清理）。
- 拖拽：`savePosition` 只写本地缓存，不广播。

### 4. 布局应用时机（防闪烁关键点）

- `useMapInit` 的 `rf.setNodes`（数据坐标）被 `useEventBuffer` 用 debounce 延迟 10ms。
- 因此在 `useMapInit.updateSystems` 内部、`rf.setNodes` 之后**同一回调**里再 `rf.setNodes` 覆盖回 home 布局，React 批处理，无中间帧闪烁。
- `useMapWrapper` 的 `useMapEventListener` 对 `updateSystems`（同步）也做同样的覆盖。

### 5. rearrange 本地化

- all 视图：`rearrange_systems` 走后端全局（BFS + 广播），行为不变。
- home 视图：`MapWrapper` 用 `wrappedOutCommand` 拦截 `rearrangeSystems`，改调本地 `rearrangeLayout()`（前端 `computeBfsLayout` 重算 + 写本地缓存，不广播）。

### 6. 方向判断统一

`computeBfsLayout` 的左右方向（direction）判断改用**当前视图布局坐标**（`currentLayout` 参数），而非全局数据坐标：
- home 视图拖拽只改本地布局，若用全局数据坐标判断方向会与用户看到的位置脱节（出现"一左一右"、"参考其他 home 为根"等问题）。
- 首次进入（无缓存）时 fallback 到全局数据坐标。

---

## 关键设计决策

1. **纯前端过滤**：后端数据不变，过滤/布局都在前端，增量更新自动适配。
2. **坐标解耦**：布局从"共享数据"解耦为"视图状态"，all 共享、home 本地。
3. **effectiveLocked**：`locked && status !== home`，home 语义优先级高于 locked。
4. **增量布局**：已有节点坐标永不重算（避免远端数据变化导致闪烁），只在首次/新增/删除时更新。
5. **跨标签页隔离**：viewMode 与布局缓存都用 `storageSync: false`，多标签页（多用户视角）互不影响。
6. **布局覆盖放在 debounce 回调内**：避免 init 重推的数据坐标覆盖 home 布局造成回弹。

---

## 验证要点

1. 选 home:x1 → 只显示与 x1 相连的星系，自动 BFS 树状布局。
2. 切到 all → 恢复全局共享布局。
3. home 视图拖拽星系 → 只改本地，其他标签页（用户）不受影响。
4. all 视图拖拽星系 → 广播，但 home 视图布局不被数据坐标覆盖。
5. 浏览器最小化→重新打开 → home 视图布局保持（不回弹到 all）。
6. home 视图右键 rearrange → 只重排本地，保持相对左右方向，不影响其他用户。
7. 纯 locked 星系 → 任何视图都显示、坐标固定；home+locked → 在别的 home 视图当普通节点。
8. home 视图右键添加孤立星系 → 立即可见（在右键位置），可手动连线。
9. 刷新页面 → viewMode 与本地布局恢复。
