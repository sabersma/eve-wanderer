# Feature: 订阅地图交互与布局治理 (Subscription Map UX & Layout Governance)

> **分支**: `feature/sfi`
> **日期**: 2026-09-20
> **作者**: zhouting
>
> 本文档记录订阅视图（`viewMode === 'home'`）的 10 项交互与布局修正，便于后续合并上游仓库（wanderer-industries/wanderer）时解决冲突。

---

## 背景

订阅视图是本分支为非 admin/manager 用户新做的地图模式：每个用户订阅若干星系，前端只渲染订阅星系族，并维护一份**每用户本地的 BFS 布局**（localStorage，不写回后端）。全局视图（`all`）则仍用后端的 `position_x/position_y` 与后端重排。

这套「前后端两套布局系统」在实战中暴露了 10 个问题，本方案只做**增量的行为修正与增强，不重构既有架构**。

---

## 需求清单与实现对照

| # | 需求 | 实现 | 主要落点 |
|---|------|------|---------|
| 1 | 自动添加的星系不应离它连接的星系太远 | 后端落点改为**锚点相对**；删除深度列公式与 R-tree 回退；无锚点时用簇中心而非 x=0 列 | `layout/placement.ex`、`map_server_systems_impl.ex` |
| 2 | 订阅上限可配置，默认 10 | 两个环境变量 + `Env` 访问器 | `config/runtime.exs`、`env.ex`、`map_core_event_handler.ex` |
| 3 | 可显示/隐藏非订阅星系族 | 每用户布尔设置；隐藏模式下严格 `BFS(订阅星系)`，并拦截右键添加；开关在顶栏订阅栏，仅订阅视图可见生效 | `useFilteredMapData.ts`、`MapWrapper.tsx`、`ViewModeSelector.tsx`、`map_systems_event_handler.ex` |
| 4 | 右键「移动星系」（两阶段） | 系统菜单标记 + 画布菜单落位，吸附最近空位 | `useContextMenuSystemHandlers.ts`、`useContextMenuRootHandlers.ts` |
| 5 | 右键「全选星系族」 | 精确连通分量（非框选），边界只取可见集合；锁定不参与边界（见下） | `helpers/graph.ts`、`useContextMenuSystemHandlers.ts` |
| 6 | 无别名时显示 J code 而非数字 ID | 后端随载荷下发 `subscribed_systems: [{id, name}]` | `map_core_event_handler.ex`、`ViewModeSelector.tsx` |
| 7 | 订阅超 3 个收缩为下拉列表 | PrimeReact `OverlayPanel`；点击聚焦、× 二次确认 | `ViewModeSelector.tsx` |
| 8 | 订阅模式下重排不要求 home | **验证为主**：后端本就不校验 `status == home`；补空结果保护 | `useViewLayout.ts` |
| 9 | 重排不得压到其它星系簇 | 前后端各自的占用表 + 「先打包、再平移、后微调」 | `occupancy.ts`、`layout/occupancy.ex`、`layout.ts` |
| 10 | 重叠时用户必须能察觉 | 矩形相交检测 + 节点角标 + 悬停详情 | `overlap.ts`、`MapOverlapProvider.tsx`、`OverlapBookmark.tsx` |

---

## 修改文件清单

### 后端

| 文件 | 变更 |
|------|------|
| `lib/wanderer_app/map/layout/geometry.ex` | **新增**：节点几何与间距常量（后端唯一来源） |
| `lib/wanderer_app/map/layout/occupancy.ex` | **新增**：3×3 邻域网格占用表、`find_free` / `find_free_x_offset` |
| `lib/wanderer_app/map/layout/placement.ex` | **新增**：纯函数落点决策（`new_position/3`、`keep_position?/4`、`snap_to_free_slot/3`） |
| `lib/wanderer_app/map/map_position_calculator.ex` | **-176 行**：删除全部落点/搜索逻辑，只保留 `get_system_bounding_rect/1` |
| `lib/wanderer_app/map/server/map_server_systems_impl.ex` | 落点与重排重写；跳跃不再覆盖已摆好的星系 |
| `lib/wanderer_app/repositories/map_user_settings_repo.ex` | `@default_form_data` 新增 `hide_unsubscribed_clusters` |
| `lib/wanderer_app_web/live/map/event_handlers/map_core_event_handler.ex` | 限额改读 Env；设置白名单；`subscribed_systems` 下发；落点日志 |
| `lib/wanderer_app_web/live/map/event_handlers/map_systems_event_handler.ex` | 隐藏模式下 `manual_add_system` 拒绝；拒绝范围限定为 `view_mode == "home"`（+ 旧客户端） |
| `lib/wanderer_app/env.ex` | 两个可缓存访问器 |
| `config/runtime.exs`、`.env.example` | `WANDERER_SUBSCRIPTION_LIMIT_MEMBER` / `_VIEWER` |
| `test/unit/map/layout/placement_test.exs` | **新增**：23 个落点用例 |

### 前端

| 文件 | 变更 |
|------|------|
| `components/map/helpers/geometry.ts` | **新增**：几何常量（`layout.ts` 转出，旧引用不变） |
| `components/map/helpers/occupancy.ts` | **新增**：与后端同构的占用内核 |
| `components/map/helpers/overlap.ts` | **新增**：矩形相交重叠检测 |
| `components/map/MapOverlapProvider.tsx` | **新增**：独立 context（不进 rAF store，避免拖动时全量重渲染） |
| `components/map/components/SolarSystemNode/OverlapBookmark.tsx` | **新增**：重叠角标 |
| `helpers/graph.ts` | **新增**：邻接表 / BFS / 连通分量（与 `useFilteredMapData` 共用） |
| `components/map/helpers/layout.ts` | `computeNewNodePosition` 用占用表；`computeMultiBfsLayout` 三段式避让 |
| `components/mapWrapper/hooks/useViewLayout.ts` | 缓存升版 v2；空结果不清空布局 |
| `components/mapWrapper/hooks/useFilteredMapData.ts` | 隐藏模式；图算法改为引用 `helpers/graph.ts` |
| `components/mapWrapper/MapWrapper.tsx` | 隐藏模式守卫与提示；移动中提示条；Esc/切视图取消；`manual_add_system` 带 `view_mode` |
| `components/contexts/ContextMenuSystem/*` | 「移动星系」「全选星系族」菜单项与处理 |
| `components/contexts/ContextMenuSystemInfo/*` | 「添加到地图」带 `view_mode` |
| `components/map/components/ContextMenuRoot/*` | 落位菜单项与吸附逻辑 |
| `components/mapRootContent/components/ViewModeSelector/*` | 非订阅星系族 显示/隐藏 开关（中文，仅订阅视图）；J code 回退；超 3 个收缩为下拉；二次确认 |
| `mapRootProvider/MapRootProvider.tsx`、`types.ts` | `userRemoteSettings`、`subscribedSystems`、`pendingMoveSystemId` |
| `mapRootProvider/hooks/api/*` | `useMapInit` / `useMapUpdated` / `useCommandMapError` |
| `components/mapRootContent/components/MapSettings/*` | 新设置项（写入根 store 而非组件本地 state）；`hide_unsubscribed_clusters` 已移出对话框 |
| `types/mapHandlers.ts` | `CommandMapError`、`map_error`、`subscribed_systems` |

---

## 详细设计

### 需求 1：落点（前后端各一份，规则同构）

现状有三个独立成因，按影响排序：

1. **跳跃会覆盖已摆好的星系**。`do_add_system_from_location` 对已存在于地图的星系无条件 `update_position!`，角色每次跳进一个已摆好的星系，该节点就被重算挪走。
2. **R-tree 命中即退化成深度列**。锚点分支先算理想位置，若 `@ddrt.query` 判定被占（R-tree 批量写后可能残留陈旧条目），回退调用 `get_level_position(home.x, home.y, depth, …)` —— 又变回「home 深度列」公式，可离锚点数屏远。
3. **无锚点时全部塞进 x=0 列**。`find_lower_empty_position/2` 硬编码 `start_x = 0`、`y = max_y + 157`，每次加在「当前最低点」下方 —— **这正是「5 个星系同 X、Y 相差 3 屏」的成因**。

现在的规则（`Placement.new_position/3`）：

- **锚点分支**：`x = anchor.x ± SPACING_X`（先试锚点所在侧），`y` 以 `anchor.position_y` 为理想值做有界纵向扫描（`max_radius = 8`，即 289 个候选位、横向 ≤1440px、纵向 ≤600px，约「1 屏内」）。
- **无锚点分支**：以全图已定位系统的整数均值（按 `solar_system_id` 排序保证确定性）作簇中心，围绕中心做同样的有界环搜索。**彻底消除 x=0 列与无限下移**。
- **跳跃不覆盖**（已确认决策「只在偏得太远时才挪」）：`Placement.keep_position?/4` 在原位置离所有已连接邻居都在 1 屏内时保持原位，仅在「从隐藏恢复」或「偏得太远」时重算。

> **对已批准规则的细化**：原方案写的是「现位置到**锚点**的距离 ≤ 1 屏」。实现时改为检查**每一个已连接的邻居**，而不只是锚点。原因：一个星系可能有多个连接，只测锚点会让「贴着邻居 B、离锚点很远」的星系被反复挪动；它其实并不孤立。同时补了一条例外：**没有任何邻居在地图上的星系是「不受约束」而非「走失」**，必须保持原位 —— `Enum.all?/2` 在空列表上恒为真，不加这条守卫会让一个孤立星系每次跳跃都被重新摆放，正是这条规则本来要消灭的行为。

### 需求 9：占位内核与重排避让

因 `cellW ≥ NODE_W` 且 `cellH ≥ NODE_H`，**任何可能与目标矩形相交的节点必然落在锚点所在单元格的 3×3 邻域内** —— 这是可证明的边界，查询 O(1)。前后端各一份同构实现，用同一套 fixture 写两套测试。

环形偏移表按「`dx=0` 优先（保持列位，布局仍读得懂）→ 曼哈顿距离 → 偏好侧 → `dx/dy` 升序」排序并缓存，**完全确定性**，不依赖对象键序、不用随机数。

> **`:exhausted` 契约（已知边界）**：搜索 289 个候选位后仍无空位时，返回一个**确定性的、但可能被占用的溢出位**，并由调用方记录日志（后端）或提示用户（前端，见需求 4）。这是方案的明确选择：不静默返回被占位，但也不无限扩环。视觉兜底是需求 10 的重叠角标。刻意**未**改成「保证返回空位」，因为前端镜像无法在本机跑测试（见「已知边界」），单边改动会破坏两端同构。

后端的占用检查**只查内存中的系统列表，不查 R-tree**。原因：R-tree 在批量写入后可能陈旧（需求 1 的成因 2 正源于此），把它当作占用判据会把「陈旧条目」变成「凭空出现的障碍」。

> **与前端的一处刻意差异**：后端 `Occupancy` **没有**前端的 `prefer` 选项。重排微调用的是 `prefer_vertical: true`（微调后仍留在自己的 BFS 列里，树形依然读得出），不需要按左右偏好分侧。

### 需求 3：隐藏非订阅星系族

- 设置键 `hide_unsubscribed_clusters`（默认 `false` = 显示 = 现状）。
- `computeVisibleSystemIds` 隐藏模式下 seeds **仅** `subscribedSystemIds`，且不并入「孤立 ∩ 手动添加」—— 即严格 `BFS(订阅星系)`。断了连接的自己角色所在簇也会消失，这是该模式的语义而非缺陷。
- 右键「Add System」在隐藏模式下**保留但禁用**并说明原因（菜单项静默消失会被当成 bug），`MapWrapper.onAddSystem` 同步 toast。
  - 三处文案统一为中文、且是同一句话：禁用菜单项的悬浮提示（`MenuItemWithInfo` 的 `infoTitle` ← `MapWrapper.addSystemBlockedReason`）、`onAddSystem` / `handleSubmitAddSystem` 的 toast 详情、以及后端拒绝经 `map_error` 通道弹出的 toast 详情。用户看到的那句话不因是哪一层拦下而变。toast 标题（`无法添加星系` / 通用通道的 `Action not allowed`）与中文详情并列，这是可接受的：标题是分类，详情才是原因。
- 后端 `manual_add_system` 加一道校验，防止绕过前端。

> **`map_error` 通道**：后端拒绝时推 `map_error`。原本这个事件在前端**没有任何消费者**，拒绝会表现为「点了没反应」。现补齐 `CommandMapError` 类型 + `useCommandMapError` toast hook + `useMapRootHandlers` 的 `case`。

#### 需求 3 补充：开关移到顶栏，并限定在订阅视图内

原实现把这个开关放在地图设置对话框的 Systems 分组里（英文 `Hide clusters not connected to a subscription`），要改它得先打开设置。现在移到顶栏订阅栏、`ViewModeSelector` 内：

- **位置**：`ViewModeSelector` 的 `viewMode !== 'all'` 区块内，与订阅输入框、订阅 chips 同一行。顶部菜单栏的开/关两种布局（`isShowMenu`）都渲染 `ViewModeSelector`，所以两种布局都能直接设置。
- **只在订阅视图可见**：整个区块以 `viewMode !== 'all'` 为条件 —— 全局视图下控件根本不存在。设置对话框里的那一项**已移除**，开关只有这一处；`hide_unsubscribed_clusters` 仍留在 `UserSettingsRemoteList` 里，那才是「这是服务端设置而非本地设置」的判据。
- **中文提示**：`显示` / `隐藏` 两个按钮，`title` 分别是「显示所有可见的星系族，包括未订阅的；可以在任意位置添加星系」与「只显示与订阅星系相连的星系族；与订阅断开时连自己的角色也不显示，且不能在订阅族之外添加星系」。

**「只在订阅视图生效」的两条链路，都要处理：**

1. **渲染**：`computeVisibleSystemIds` 在 `viewMode === 'all'` 时直接返回全部星系，从不读这个设置 —— 本来就不影响全局视图。无需改动。
2. **后端添加校验**（原先漏了）：`manual_add_system` 的拒绝分支只看 `hide_unsubscribed_clusters?`，不看视图。于是「在订阅视图打开开关 → 切到全局视图 → 添加星系」会被后端以「隐藏模式下不能添加」拒绝，而全局视图下这条前提（新星系会看不见）根本不成立。现在前端在 `manual_add_system` 载荷里带 `view_mode`，后端把它拆成两个子句：`view_mode == "home"` 拒绝；**没有** `view_mode` 的（旧客户端）也拒绝 —— 这是安全默认；只有 `view_mode == "all"` 会落到正常添加子句。拒绝逻辑抽成 `refuse_add_system/1`。

  两个发送方都要带：`MapWrapper.handleSubmitAddSystem`（画布右键添加）与 `useContextMenuSystemInfoHandlers.onAddSystem`（航线控件里的「添加到地图」）。

### 需求 4：移动星系

两阶段：系统右键「Move System」把 `pendingMoveSystemId` 写进**根 store**（两个菜单都要读写，只有根 store 覆盖得到）→ 画布右键「Move `<名字>` here」。

- 落位坐标经 `findFreeSlot` **吸附最近空位**；发生吸附或溢出时 toast 说明。
- 写回**直接复用现有 `updateSystemPosition`**：订阅视图下 `MapWrapper.handleCommand` 已把它路由到 `savePosition`（localStorage），全局视图路由到后端。两个视图下占用表都取自 `rf.getNodes()`（用户真正看到的位置）。
- 取消条件：再次点该星系的「Cancel Move」、Esc、切换视图模式、画布菜单「Cancel Move」。待移动星系用顶部提示条显示当前状态。
- 全局视图下菜单项需要 `UPDATE_SYSTEM`（移动对所有人生效）；订阅视图只改本地布局，不做限制。

### 需求 5：全选星系族

`findConnectedComponent(startId, connections, allowedIds)` —— 精确连通分量，**不是矩形框选**。

- `allowedIds` = `visibleSystemIds`（隐藏的星系既不被选中也不被穿过，这是唯一的边界）。
- 结果经已有 `Commands.selectSystems` 复用 ReactFlow 原生多选拖动。

**整簇拖动只有鼠标下那个星系会留在新位置**（实施后发现的第二个 bug）。原以为持久化由 `onSelectionDragStop` 负责，其实那条路径几乎不会触发：ReactFlow 按拖动的**起点**分派 —— 从星系上起拖走 `onNodeDragStop`，只有从选区本身起拖才走 `onSelectionDragStop`（`XYDrag` 的 `const onStop = nodeId ? onNodeDragStop : wrapSelectionDragFunc(onSelectionDragStop)`，`nodeId` 在从节点起拖时才有值）。而 `handleDragStop` 只用第二个参数（鼠标下那个节点）去发 `updateSystemPosition`。

于是拖动过程中所有选中节点都跟着走（`getDragItems` 收集整个选区），松手后只写回一个：500ms 后 `savePosition` 生效 → `layoutPositions` 变成新对象 → `Map.tsx` 的布局 effect 把其余节点按**旧的存储坐标**重置回去。用户看到的就是「整体能拖走，松手后除了鼠标下那个全都闪回原处」——那个 500ms 的 `setTimeout` 正是「闪」的来源。

修法：`handleDragStop` 改用第三个参数（ReactFlow 传入的**全部**被拖动节点，`getEventHandlerParams` 返回的 `dragItems`），多发一条 `updateSystemPositions`（复数命令已存在：订阅视图下逐节点走 `savePosition`，全局视图下走后端 `update_system_positions`）。单节点拖动是这个列表长度为 1 的特例，不再需要单独的分支。

**锁定星系不参与边界**（原方案默认排除，实施后修正）。原设计把锁定当作「不要动我」的选择边界，实施后发现这会让整个菜单项在真实地图上完全失效：

- reactflow 的拖动本来就只拾取 `draggable` 的节点（`getDragItems` 过滤 `n.draggable || (nodesDraggable && typeof n.draggable === 'undefined')`），所以被选中的锁定节点**本来就不会跟着动** —— 用选择边界去实现「不要动我」是重复的，且是错的那一层。订阅视图还刻意把锁定节点改成可拖动（`Map.tsx` 的 `displayNodes`：该视图的拖动只改本地布局，不写回后端），锁在那里本就没有拖动语义。
- 代价却是致命的：起点自身被排除时 `findConnectedComponent` 直接返回空集，`onSelectCluster` 静默返回 —— 表现为「点击之后没效果」。而真实数据里锁定的星系占绝大多数：`map_system_v1.locked` 列在迁移 `20240523202445` 中默认 `true`，`20240613133932` 改成默认 `false` 时**没有回填历史行**。本地开发库实测：全库 58 个系统 7 个锁定；用户主地图 `1e5ed5c2-…` 的 7 个可见系统中 **6 个锁定**（`31000022`/`31000035`/`31000227`/`31000450`/`31000717`/`31001807`，仅 `31000121` 未锁定），且这两者之间仅有一条连接 —— 即几乎每次点击都命中锁定星系，每次都静默无事发生。
- 因此 `excludedIds` 参数一并从 `findConnectedComponent` 删除，避免后人重新引入同一个陷阱；同时把「组件为空」这一分支从静默返回改为 toast 提示 —— 选择不生效与菜单项损坏在用户眼里没有区别，这类失败不该无声。

### 需求 6：J code

订阅了但**尚未成功入图**的星系在地图数据里没有记录，取名字只能退化成数字 ID。后端现在随 `init` / `map_updated` 下发 `subscribed_systems: [{id, name}]`（用 `CachedInfo.get_system_static_info!` 解析 J code，不依赖是否入图）。前端取值顺序：地图自定义别名 → 地图静态信息 J code → 服务端解析名 → 数字 ID。

### 需求 7：订阅超 3 个收缩

`SUBSCRIPTION_CHIP_LIMIT = 3`；超出时换成 `OverlayPanel` 下拉，≤3 时行为不变。每项：点击 → `Commands.centerSystem` 聚焦；× → `ConfirmPopup` 二次确认后取消订阅。

### 需求 8：订阅模式下重排

**调研结论：基本已满足。** 后端 `rearrange_systems/2` 不要求 `status == home`，只按 id 找系统当 BFS 根；前端菜单门槛已含 `subscribedSystemIds.includes(systemId)`；订阅视图下 `MapWrapper` 拦截重排走本地 `rearrangeLayout()`，以全部订阅星系为多根。

补的一处边界：`rearrangeLayout` 原来无条件写入 `computeMultiBfsLayout` 的结果，而后者在「没有可用的订阅根」时返回 `{}`，会把已存的布局**清空**。现改为空结果直接返回，保留现有布局。

### 需求 10：重叠检测

- 判据是**真实矩形相交**（130×34），不是坐标相等、也不是距离阈值 —— 阈值在密集但合法的地图上会误报成噪声。相邻但不重叠不算重叠。
- `detectOverlaps` 双向填充 + 排序，便于用 `sameOverlaps` 做廉价的相等比较；`Map.tsx` 用 `useRef` 缓存上次结果，相等时**返回旧引用**，因此正常拖动产生零额外渲染，只有重叠出现/消失的那一帧才重渲染。
- 角标用独立 CSS 类（不与 `activityDanger` 击杀角标撞色），悬停列出与之重叠的星系名。

### 其它

- **`PositionCalculator` 为何删到只剩 25 行**：它原本混合了三件事 —— 几何常量、占用判定、以及「从 home 出发按 BFS 深度算列」的落点公式。落点公式正是需求 1 要消灭的东西，占用判定被新的 `Occupancy` 取代，只有 `get_system_bounding_rect/1` 仍被 R-tree 索引处使用，所以保留。删除的还包括 `get_level_position/5`、`find_lower_empty_position/2`、`check_system_available_positions/5`（后者是性能悬崖：最坏约 130 万次 R-tree 查询，且 level-100 守卫会返回模块属性 `{0,0}` 而非调用方起点）。
- **地图缓存陈旧**：`WandererApp.Map.add_system/2` 在 `solar_system_id` 键已存在时是 **no-op**，因此「先写库再写缓存」的顺序会让缓存停留在旧坐标。位置与可见性的同步统一走 `update_system_cache_position/4` 与 `update_system_visibility/3`。
- **布局缓存升版到 `wanderer_view_layouts_v2`**：旧 v1 布局带着历史碰撞，升版让所有用户下次进订阅视图得到一份干净的无重叠布局。代价是 v1 下手工拖过的位置会丢失（可以再拖）。

---

## 验证要点

- 后端：`make test`（新增 `test/unit/map/layout/placement_test.exs`，23 个用例全通过）。断言包括：锚点连跳 3 跳且每跳 `distance(new, anchor) ≤ 900`；锚点不在其 BFS 列上时仍落在锚点旁；目标列被占时落到另一侧；50 个星系批量添加无堆叠；确定性；耗尽时记录日志且位置确定。
- 前端：`npx tsc --noEmit` 错误集合与改动前**逐行相同**（93 条均为改动前既有）；`npx vite build` 通过。
- 前端手工验证（**必须先 `make deploy` 再 `make start`**；后端改动先 `make migrate`）：
  1. 订阅一个未连接的星系 → 落在订阅簇附近（1 屏内），不在画面外或地图底部。
  2. 连续订阅多个孤立星系 → 不再出现同 X、Y 递增远离的堆叠。
  3. 角色跳进一个已摆好的星系 → 该节点不被挪走；跳进离邻居 >1 屏的星系 → 才重算。
  4. 全局视图重排 → 订阅簇不压到其它用户的簇上。
  5. 手动把两个星系拖到同一位置 → 两者都出现重叠角标，悬停列出对方名字。
  6. 右键星系「Move System」→ 右键空白处 → 精确落位；目标被占用时吸附最近空位并提示；Esc 取消。
  7. 右键星系「Select Whole Cluster」→ 整个连通簇被选中，可整体拖动；**对锁定星系点击同样生效**（用本地库里锁定的那 6 个星系之一验证，这正是原先静默失效的场景）；簇内的锁定星系也被选中，但拖动时它自己不动。
  8. 顶栏订阅栏把「非订阅星系族」切到「隐藏」→ 与订阅簇断开、含自己角色的簇消失；空白处右键，「Add System」为禁用态，**悬停的提示为中文**「隐藏模式下不可添加星系，请先切换为「显示」」。切回「显示」恢复；切到全局视图时该控件消失，且此时添加星系**不被**后端拒绝。
  7b. 全选之后**整簇拖动** → 松手后所有星系都停在新位置（不只是鼠标下那个），切走再切回订阅视图仍然在新位置；全局视图下整体拖动后刷新页面也在新位置。
  9. 订阅 4 个以上 → 顶部收缩为下拉，可聚焦、可带二次确认地取消订阅。
  10. 订阅一个无别名星系 → 显示 J code 而非数字 ID。
  11. 改 `WANDERER_SUBSCRIPTION_LIMIT_MEMBER=2` 重启 → member 订阅第 3 个被拒。

---

## 已知边界

1. **`findFreeSlot` 耗尽时返回的溢出位可能仍被占用**，只保证确定性。前后端一致；兜底是重叠角标（需求 10）与用户提示（需求 4）。289 个候选位（约 1 屏）在正常使用密度下不会耗尽。
2. **前端单测无法在本机运行**：Jest 环境整体损坏（`cliui` → `string-width` 的 `ERR_REQUIRE_ESM`，与本次改动无关）。`occupancy.test.ts` / `overlap.test.ts` / `layout.test.ts` 已写好但未能执行，因此前端内核的验证依赖后续手工验证。
3. **粘贴路径未在隐藏模式下拦截**：`manual_paste_systems_and_connections` 仍可写入隐藏模式看不到的星系。它与单点添加不同 —— 粘贴是一批星系加连接，无法判断整体是否落在订阅簇内。属已知边界，未处理。
4. **`all` 视图下移动对所有人生效**：需用两个浏览器会话验证「移动 → 服务端回推 → layoutPositions 变化 → 再计算」不形成回路。后端**不应**拒绝重叠写入 —— 拖动不能被服务端对抗，客户端吸附 + 角标才是正确分层。
5. **需求 5 与锁定星系**：已改为不排除（见「需求 5」一节）。副作用是锁定星系会被选中，但 reactflow 不会拖动它，所以「锁定不被移动」依然成立；若将来希望「整簇拖动时锁定星系也一起动」，需要在 `Map.tsx` 的 `displayNodes` 里改变对锁定节点 `draggable` 的强制，而不是在选择侧做手脚。
6. **待验证假设**：通过 `update_visible(%{visible: false})` 隐藏但尚未过期的星系是否仍在 R-tree 中。在则隐藏星系会阻挡落点（符合需求 9）；不在则新节点可能落在隐藏星系上，解隐时角标会暴露它。
