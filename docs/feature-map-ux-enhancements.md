# Feature: 地图交互增强（聚焦选中 / 锁定框 / 手动添加信号）

> **分支**: `feature/sfi`
> **日期**: 2026-08-14
> **作者**: zhouting
>
> 本文档记录地图交互与信号录入的若干增强，便于后续合并上游仓库时解决冲突。

---

## 功能清单

| # | 功能 | 说明 |
|---|------|------|
| 1 | 聚焦时自动选中 | 聚焦某星系（下拉框聚焦按钮、菜单搜索）时，同时将其设为选中状态 |
| 2 | 选中锁定框 | 选中星系显示四角金色锁定框（区别于聚焦的蓝色脉冲框） |
| 3 | home 编号显示 | home 下拉选项显示「别名 (编号)」，如 `主基地 (J144038)` |
| 4 | home 聚焦按钮 | home 下拉旁新增 `⌖` 按钮，点击重置视角到当前 home |
| 5 | 手动添加信号 | 新增手动录入信号入口：信号窗口 `+` 按钮 + 右键星系「Add Signature」 |

---

## 修改文件清单

| 文件 | 功能 |
|------|------|
| `assets/js/hooks/Mapper/components/map/hooks/api/useCenterSystem.ts` | 1 | 聚焦时 `rf.setNodes` 设 `selected`；顺带修正 `highlightTimeout` 类型 |
| `assets/js/hooks/Mapper/components/map/components/SolarSystemNode/SolarSystemNodeDefault.tsx` | 2 | 选中时渲染金色四角边框 |
| `assets/js/hooks/Mapper/components/map/components/SolarSystemNode/SolarSystemNodeTheme.tsx` | 2 | 同上（另一主题） |
| `assets/js/hooks/Mapper/components/mapRootContent/components/ViewModeSelector/ViewModeSelector.tsx` | 1/3/4 | label 加编号、聚焦按钮、选择时聚焦 |
| `assets/js/hooks/Mapper/components/mapRootContent/components/ViewModeSelector/ViewModeSelector.module.scss` | 4 | `.CenterButton` 样式 |
| `assets/js/hooks/Mapper/components/mapRootContent/components/SignatureSettings/SignatureSettings.tsx` | 5 | 支持「添加」模式（`signatureData` 为空时） |
| `assets/js/hooks/Mapper/components/mapInterface/widgets/SystemSignatures/SystemSignatures.tsx` | 5 | 信号窗口 `+` 按钮 + 渲染添加对话框 |
| `assets/js/hooks/Mapper/components/mapInterface/widgets/SystemSignatures/SystemSignatureHeader/SystemSignatureHeader.tsx` | 5 | 头部 `+` 按钮 |
| `assets/js/hooks/Mapper/components/mapWrapper/MapWrapper.tsx` | 5 | 处理 `addSignature`、`handleAddSignature`、渲染添加对话框 |
| `assets/js/hooks/Mapper/components/contexts/ContextMenuSystem/ContextMenuSystem.tsx` | 5 | `ContextMenuSystemProps` 加 `onAddSignature` |
| `assets/js/hooks/Mapper/components/contexts/ContextMenuSystem/useContextMenuSystemHandlers.ts` | 5 | 新增 `onAddSignature` |
| `assets/js/hooks/Mapper/components/contexts/ContextMenuSystem/useContextMenuSystemItems.tsx` | 5 | 菜单项「Add Signature」 |
| `assets/js/hooks/Mapper/types/mapHandlers.ts` | 5 | `OutCommand` 加 UI 命令 `addSignature` |

---

## 详细设计

### 1. 聚焦时自动选中（useCenterSystem）

`useCenterSystem` 原本只做 `setCenter` + 临时高亮（`systemHighlighted`）。本次在 `setCenter` 后增加：

```ts
rf.setNodes(nds => nds.map(node => ({ ...node, selected: node.id === systemId })));
```

使聚焦（下拉聚焦按钮 / 菜单搜索）的目标星系同时被选中，选中状态由 ReactFlow 的 `onSelectionChange` 同步到 `MapRootData.selectedSystems`。

### 2. 选中锁定框（四角边框）

在两个节点主题组件（Default / Theme）里，`selected` 时渲染一个四角 L 形边框：

- **聚焦框**（已有）：`systemHighlighted === solarSystemId` → 天蓝 `border-sky-300` + `animate-pulse`
- **选中框**（新增）：`selected` → 金色 `border-amber-300`，固定不闪烁，`pointer-events-none`

### 3/4. home 编号显示 + 聚焦按钮（ViewModeSelector）

- 下拉选项 label：`别名 && 别名 !== 编号 ? \`${别名} (${编号})\` : 编号`
- 选择 home 后触发 `emitMapEvent(centerSystem)` 自动聚焦
- 下拉旁新增 `pi-bullseye` 按钮，点击聚焦当前 home

### 5. 手动添加信号

复用 `SignatureSettings` 编辑对话框，`signatureData` 为空时进入「添加」模式：

- 表单顶部新增「Signal ID」输入框（校验 `^[A-Z]{3}-\d{3}$`）
- `handleSave` 分两条分支：添加走 `added: [newSig]`（`kind` 默认 `CosmicSignature`），编辑走 `updated: [out]`
- Wormhole 且选了 leads-to 时，保存后追加 `linkSignatureToSystem`

两个入口：
- 信号窗口 `+` 按钮（`SystemSignatures` 内部状态）
- 右键菜单「Add Signature」（`MapWrapper.handleAddSignature` 直接 `setOpenAddSignature`，**不走 `outCommand` 后端** —— 这是关键，`addSignature` 是纯 UI 命令）

---

## 关键设计决策

1. **聚焦即选中**：聚焦和选中统一，用户无需再手动点选目标星系。
2. **选中/聚焦视觉区分**：选中用金色固定四角框，聚焦用天蓝脉冲框，语义清晰。
3. **addSignature 走 UI 回调而非后端**：`addSignature` 是纯 UI 命令，通过 `handleAddSignature` 直接 `setOpenAddSignature`（参考 `openSettings` 的 `handleOpenSettings` 模式），避免被 `wrappedOutCommand` 转发到后端导致无响应。
4. **复用编辑表单**：手动添加复用 `SignatureSettings` 的全部字段（group/type/leads-to/description），`kind` 默认 `CosmicSignature`（与粘贴解析一致）。

---

## 验证要点

1. 聚焦某星系（下拉聚焦按钮 / 菜单搜索）→ 目标星系居中且被选中（金色锁定框）。
2. 点击选中星系 → 显示金色四角框，明显区别于聚焦的蓝色脉冲框。
3. home 下拉显示「别名 (编号)」，选择后自动聚焦，`⌖` 按钮可重置视角。
4. 信号窗口点 `+` → 弹 `Signature Add` → 填信号 ID + group → Save → 信号出现。
5. 右键星系 → `Add Signature` → 打开添加对话框（**不再无响应**）。
6. 编辑已有信号（铅笔）仍走 `Signature Edit [eve_id]`，行为不变。
