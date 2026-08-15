# Feature: Home 视图实时同步修复 + 标签建议

> **分支**: `feature/sfi`
> **日期**: 2026-08-14
> **作者**: zhouting
>
> 本文档记录两个改动：① 修复 home 视图下角色移动产生的星系需 F5 刷新才可见；② 右键 Labels 菜单从固定预设标签改为按星系类型生成的 custom label 建议。

---

## 功能清单

| # | 功能 | 说明 |
|---|------|------|
| 1 | 修复 home 视图实时同步 | 角色移动产生的星系/连接，在 home 视图下实时归位，无需 F5 刷新 |
| 2 | 标签建议 | Labels 菜单不再展示固定预设值，改为按星系类型生成 custom label 建议（如 `1B/1C/1D/K1/K1B/K1C/K1D`） |

---

## 修改文件清单

| 文件 | 功能 |
|------|------|
| `assets/js/hooks/Mapper/components/mapWrapper/hooks/useViewLayout.ts` | 1 | 增量布局新增"从孤立变连通"重算 |
| `assets/js/hooks/Mapper/components/contexts/ContextMenuSystem/hooks/useLabelsMenu/useLabelsMenu.ts` | 2 | 移除预设标签，生成建议标签 |

> 注：`constants.ts` 曾短暂改为 `b/c/d/kb/kc/kd` 预设标签，本次已用 `git checkout` 恢复原样，不在提交中。

---

## 详细设计

### 1. 修复 home 视图实时同步（从孤立变连通重算）

**问题**：角色移动时，后端顺序广播 `add_system`（新星系）和 `add_connection`（连接），落在不同渲染帧。新星系在 `add_system` 帧被当作"孤立"（无连接），`computeNewNodePosition` 用全局数据坐标给它算位置（远离 home 树布局的视口）；`add_connection` 后它进入连通分量，但已不在 `missingIds` 里，位置不再重算，导致被视口裁剪隐藏，需 F5 刷新重算才可见。

**修复**：在 `useViewLayout` 的增量布局里，先给新星系（`missingIds`）定位、锚定已布局的邻居，再对"之前孤立、现在才连上"的星系（`relayoutIds`）删除旧位置并重新锚定。两个关键点：

1. **relayout 只针对「之前孤立」的端点**：用上一帧连接集 `prevConnectedIds` 判断。角色移动时源星系本就已连接，若被误纳入 relayout 并先删除，新星系就失去锚点。
2. **先定位新星系、再删 relayoutIds**：保证新星系唯一邻居（源星系）仍在 `merged` 里可被锚定，否则 `computeNewNodePosition` 会回退到全局数据坐标（远离 home 树、被视口裁掉）。

```ts
// 上一帧已连接的星系，用于识别"之前孤立"的端点
const prevConnectedIds = new Set<string>();
prevConnections?.forEach(c => {
  prevConnectedIds.add(c.source);
  prevConnectedIds.add(c.target);
});

const relayoutSet = new Set<string>();
for (const c of newConnections) {
  for (const endpoint of [c.source, c.target]) {
    if (
      endpoint !== selectedHomeSystemId &&
      !prevConnectedIds.has(endpoint) &&
      stored[endpoint] !== undefined
    ) {
      relayoutSet.add(endpoint);
    }
  }
}

// 先给新星系定位（锚定仍在 merged 里的邻居），再删+重排 relayoutIds
const merged = { ...stored };
deletedIds.forEach(id => delete merged[id]);
missingIds.forEach(id => {
  merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections, effectiveLockedIds);
});
relayoutIds.forEach(id => delete merged[id]);
relayoutIds.forEach(id => {
  merged[id] = computeNewNodePosition(id, merged, filteredSystems, filteredConnections, effectiveLockedIds);
});
```

- 角色移动的星系：新星系实时锚定源星系，归位到 home 树附近，无需 F5。
- 手动添加的星系：孤立时仍用数据坐标（右键位置），手动连线后自动归位（合理）。

> **历史坑**：最初用"位置等于数据坐标"判断孤立；`69b6832c` 改用"新连接端点"避免误判，却把已连接的源星系也纳入 relayout 并先删除，导致新星系失去锚点回退到数据坐标（即本次修复的 bug）。本版本用 `prevConnectedIds` + 先定位新星系，同时避免误判和锚点丢失。

### 2. 标签建议（按星系类型生成 custom label）

**背景**：游戏里存路径文件（bookmark）时，`K` 开头表示 K162 信号链接，`B/C/D` 区分多个相同类型的链接。地图上打对应标记可与游戏对应。

**实现**：`useLabelsMenu` 移除预设固定标签展示，改为按星系类型生成建议：

- `getSystemClassCode(systemClass)` 根据 `system_class` 返回 code：

| 星系类型 | system_class | code |
|---------|-------------|------|
| C1~C6 | 1~6 | `1`~`6` |
| C13 | 13 | `13` |
| HS（高安） | 7 | `7` |
| LS（低安） | 8 | `8` |
| null（0安） | 9 | `9` |
| 三神裔 | 25（pochven） | `三神` |
| 流浪洞 | 14~18（drifter） | `流浪` |
| 席拉 | 12（thera） | `席拉` |

- 生成 7 个建议：`<code>B / <code>C / <code>D / K<code> / K<code>B / K<code>C / K<code>D`
- 点击建议 → 作为 **custom label** 存储（`labels.updateCustomLabel(value)`），节点显示该标记

---

## 关键设计决策

1. **从孤立变连通重算**：用"上一帧是否已连接"（`prevConnectedIds`）判断星系是否在孤立时被布局，连接到达后重新锚定邻居；新星系先定位、relayout 端点后删，避免失去锚点回退到数据坐标。
2. **建议标签存为 custom label**：预设标签（labels 数组）保留原机制但不再展示，建议标签走 `customLabel` 单个字符串，节点直接显示。
3. **code 映射集中在一个函数**：`getSystemClassCode` 统一处理数字类（C1~C6/HS/LS/null/C13）和特殊类（三神裔/流浪洞/席拉）。

---

## 验证要点

1. home 视图下，另一角色移动到与 home 联通的新星系 → 星系实时出现在 home 树附近（无需 F5）。
2. 手动添加星系 → 显示在右键位置；手动连线后 → 自动归位到连接布局。
3. 右键星系 → Labels 菜单展示按类型生成的建议（如 C1 → `1B/1C/1D/K1/K1B/K1C/K1D`）。
4. 点击建议 → 节点显示对应 custom label；再次点击或选其他建议 → 覆盖。
5. 三神裔/流浪洞/席拉星系 → 生成 `三神B/…/K三神`、`流浪B/…/K流浪`、`席拉B/…/K席拉`。
