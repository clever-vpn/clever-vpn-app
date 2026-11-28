#!/usr/bin/env bash
# dist/icon.png（1024×1024）→ AppIcon.icns。只用系统自带的 sips / iconutil。
set -euo pipefail
SRC="$1"
DEST="$2"
[ -f "$SRC" ] || { echo "✗ 找不到图标源文件：$SRC" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"

for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$DEST"
echo "✓ 图标 $SRC → $DEST"
