#!/usr/bin/env bash
#
# 把 WSL 里的 desktop/ 同步到 Windows 编译目录。
#
# 只有改动 desktop/（Rust 壳、设置页）时才需要运行；地图页面由 Phoenix
# 提供，改 assets/ 或 lib/ 不需要同步。
#
# 用法：
#   desktop/scripts/sync-to-windows.sh            # 同步
#   desktop/scripts/sync-to-windows.sh --dry-run  # 只显示将要发生的变更
#
# 可用 SYNC_DEST 覆盖目标，例如：
#   SYNC_DEST=/mnt/e/other/desktop/ desktop/scripts/sync-to-windows.sh

set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/"
DEST="${SYNC_DEST:-/mnt/d/work/win/github/sabersma/eve-wanderer/desktop/}"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
  DRY_RUN=1
elif [[ $# -gt 0 ]]; then
  echo "未知参数：$1" >&2
  echo "用法：$(basename "$0") [--dry-run]" >&2
  exit 2
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "未找到 rsync，请先安装：sudo apt install rsync" >&2
  exit 1
fi

# 目标必须落在 WSL 的 Windows 盘挂载点下，避免误同步到 Linux 文件系统。
case "$DEST" in
  /mnt/[a-z]/*) ;;
  *)
    echo "目标必须在 /mnt/<盘符>/ 下：$DEST" >&2
    exit 1
    ;;
esac

DRIVE="/mnt/${DEST#/mnt/}"
DRIVE="/mnt/${DRIVE%%/*}"

if [[ ! -d "$DRIVE" ]]; then
  echo "找不到 $DRIVE，请确认该盘已在 WSL 中挂载。" >&2
  exit 1
fi

if [[ $DRY_RUN -eq 0 ]]; then
  mkdir -p "$DEST"
fi

args=(
  -rlt
  --delete
  # NTFS/DrvFs 不支持 Linux 权限位，保留权限只会制造噪音。
  --no-perms --no-owner --no-group
  # 平台相关 / 体积大，必须保留 Windows 自己的副本。
  --exclude 'node_modules/'
  --exclude 'src-tauri/target/'
  --exclude '.DS_Store'
  --info=progress2
)

if [[ $DRY_RUN -eq 1 ]]; then
  args+=(--dry-run --itemize-changes)
fi

echo "源：  $SOURCE"
echo "目标：$DEST"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "（dry-run，不会写入）"
fi

rsync "${args[@]}" "$SOURCE" "$DEST"

if [[ $DRY_RUN -eq 0 ]]; then
  echo "完成。Windows 端的 tauri dev 正在运行时会自动重编。"
fi
