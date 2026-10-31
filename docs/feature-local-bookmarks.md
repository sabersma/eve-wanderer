# 本地位标挂件（信号 / 位标对比）

地图新增 `本地位标` 挂件：用户把当前星系的游戏内位标列表粘贴进来，挂件把它与 Wanderer 里该星系的
信号列表做对比，标出**哪些信号还没有位标**、**哪些位标看起来是信号点但信号列表里已经没有了**。

同样的小窗口也作为桌面客户端的一个独立窗口（`bookmarks`），菜单顺序为
`信号 / J空间 / 位标 / KM / 成员`。

本文件记录需求边界、匹配规则和两端改动。

## 1. 需求边界（已确认）

| 项目 | 决定 |
|---|---|
| 数据来源 | 用户手动粘贴游戏内「人物与地点」的位标文本 |
| 为什么粘贴 | ESI 的位标接口已于 2025-02 下线，没有替代接口，无法直接读取 |
| 解析范围 | **只解析位标名称**；文件夹名不参与匹配（用户自定义、不可靠），仅作展示 |
| 弱匹配 | 始终开启：名称里的纯字母（3 位）和纯数字（3 位）都参与匹配 |
| 存储 | 浏览器 localStorage，按星系保存；不落库、不写服务端、不涉及 ACL |
| 星系范围 | 只能看当前地图里的星系（`get_signatures` 对图外星系返回空） |
| 删除/新增星系 | 与 web 端一致，桌面端不放开 |

不读取 EVE 客户端的日志和文件；粘贴内容完全由用户提供。

## 2. 数据流

```
用户粘贴（tab 分隔：名称 / 文件夹 / 时间）
   ▼
parseBookmarks        → ParsedBookmark[]
   │
   │  OutCommand.getSignatures { system_id }   ← 与「信号」挂件同一事件，返回全部 group
   ▼
MapLive → get_signatures → { signatures }
   │
   ▼
compareBookmarks(signatures, parsedBookmarks)
   ├─ buildIndex     全 ID / 字母 / 数字 / 站点名
   ├─ matchBookmark  逐条位标定级
   └─ compareSignatures 反查每个信号是否被位标覆盖
```

信号刷新：挂件监听 `Commands.signaturesUpdated`，星系匹配时自动重新拉取；标题栏的刷新按钮
也可以手动重拉。

## 3. 匹配规则

按顺序尝试，命中即停：

| 顺序 | 证据 | 指令 | 位标状态 |
|---|---|---|---|
| 1 | 完整信号 ID（`ABC-123`） | 命中 1 个 / 多个 / 0 个 | `matched` / `ambiguous` / `stale` |
| 2 | 纯字母 token（`ABC`） | 命中 1 个 / 多个 / 0 个 | `matched` / `ambiguous` / `suspected` |
| 3 | 站点名（信号的 `name`/`temporary_name` 包含在名称里） | 命中 1 个 / 多个 | `matched` / `ambiguous` |
| 4 | 纯数字 token（`123`） | 命中 1 个 / 多个 / 0 个 | `matched` / `ambiguous` / `suspected` |
| 5 | 以上都没有 | — | `custom` |

补充规则：

- 名称先做 NFKC + 大写 + trim，所以大小写、全角不影响匹配。
- 位标里出现完整 ID 但没有对应信号 → 直接判 `stale`，即使名称里还有别的弱 token
  （那些 token 属于别的信号，不能用来救回过期位标）。
- `Unknown`、`Wormhole`、`Gas Site` 这类未扫描信号的占位名不参与站点名匹配，避免噪音。
- 多个候选时判 `ambiguous`，不猜测、不判过期，交由用户判断。

### 状态与颜色

位标：

| 状态 | 含义 | 颜色 |
|---|---|---|
| `matched` | 已匹配到当前信号 | 绿 |
| `stale` | 完整 ID 已不在信号列表（确实过期） | 红 |
| `suspected` | 只有字母/数字线索但已经不在了（可能过期） | 橙 |
| `ambiguous` | 命中多个信号 | 蓝 |
| `custom` | 不像信号（战术点、仓库等自定义位标） | 灰 |

信号：`matched` 已标记（绿）/ `unmatched` 未标记（黄）/ `ambiguous` 疑似（蓝）。

挂件有两个标签页：「信号」看哪些信号缺位标，「位标」看哪些位标失效；「只看差异」会隐藏已匹配
和自定义项。

## 4. 粘贴格式

从游戏内位标列表复制后直接粘贴即可，tab 分隔，三列（列数不足也能用）：

```
HZM 5-k4c	黑海岸5-5 / .虫洞口	-
XCR-433 5-5	黑海岸5-5 / .虫洞口	2026.10.31 15:35
0 挂靠点	黑海岸5-5 / .战术点	-
```

第一列是名称（匹配只用这一列），第二列是文件夹路径（只展示最后一级），第三列是时间，`-` 视为空。
空行和表头行会被跳过。粘贴时自动保存并直接显示对比结果；标题栏「粘贴」和「重新粘贴」可重新编辑。

## 5. 存储

- key：`wanderer:local-bookmarks:v1`
- 结构：`{ [systemId]: { text, updatedAt } }`，单条上限 200,000 字符
- 读写都在 `try/catch` 里，localStorage 不可用时页面照常工作（只是不保存）
- 监听 `storage` 事件，桌面端多个窗口之间保持同步
- 「清空」只清当前星系

## 6. 改动文件

前端：

- `assets/js/hooks/Mapper/components/mapInterface/widgets/LocalBookmarks/`
  - `LocalBookmarks.tsx`：挂件主体（星系选择、提示、标签页、计数）
  - `helpers/parseBookmarks.ts`、`helpers/matchBookmarks.ts`
  - `hooks/useLocalBookmarks.ts`、`hooks/useComparedSignatures.ts`
  - `components/PasteBox.tsx`、`components/SignatureCompareList.tsx`、`components/BookmarkCompareList.tsx`、`components/StatusBadge.tsx`
- `components/mapInterface/constants.tsx`：`WidgetsIds.bookmarks`、默认描述、勾选项（默认隐藏）
- `components/mapInterface/widgets/index.ts`：导出
- `mapRootProvider/migrations/list/to_5.ts` + `version.ts`：`STORED_SETTINGS_VERSION = 5`，给老用户补上新挂件的描述
- `desktop/types.ts`、`desktop/DesktopWidgetBar.tsx`、`desktop/DesktopMainBar.tsx`、`components/mapRootContent/MapRootContent.tsx`

桌面端：

- `desktop/src-tauri/src/windows.rs`：`"bookmarks" => (440.0, 560.0)`
- `lib/wanderer_app_web/live/map/map_live.ex`：`@desktop_widgets ~w(signatures jspace bookmarks kills characters)`

## 7. 测试

`assets/js/hooks/Mapper/components/mapInterface/widgets/LocalBookmarks/helpers/*.test.ts`（Jest）：

```
cd assets && npx jest --env=node js/hooks/Mapper/components/mapInterface/widgets/LocalBookmarks
```

覆盖：真实 15 行位标样本的整体计数、站点名匹配、弱匹配（字母/数字）、完整 ID 优先级、唯一与多候选、
大小写、纯自定义位标。

## 8. 手动验证

1. web 端打开地图，从挂件菜单勾选「Local Bookmarks」。
2. 选中一个已记录信号的星系，粘贴位标文本，确认两个标签页的状态与计数正确。
3. 先在「信号」窗口删掉一个信号，再刷新本挂件，确认对应位标变成红色（过期）。
4. 切换到另一个星系，确认显示的是那个星系自己的粘贴内容（不会串）。
5. 桌面端打开「位标」窗口，确认尺寸与跟随逻辑（EVE 客户端 / 主图选中）正常，两个窗口保存后同步。
