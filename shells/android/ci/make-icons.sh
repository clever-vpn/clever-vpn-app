#!/usr/bin/env bash
# dist/icon.png（1024×1024）→ 各密度 mipmap。ImageMagick（Linux runner）优先，其次 macOS 的 sips。
set -euo pipefail
SRC="$1"
DEST_DIR="$2"
[ -f "$SRC" ] || { echo "✗ 找不到图标源文件：$SRC" >&2; exit 1; }

declare -a DENSITIES=("mdpi:48" "hdpi:72" "xhdpi:96" "xxhdpi:144" "xxxhdpi:192")

if command -v convert >/dev/null 2>&1; then
  for pair in "${DENSITIES[@]}"; do
    density="${pair%%:*}"; size="${pair##*:}"
    mkdir -p "$DEST_DIR/mipmap-$density"
    convert "$SRC" -resize "${size}x${size}" "$DEST_DIR/mipmap-$density/ic_launcher.png"
  done
elif command -v sips >/dev/null 2>&1; then
  for pair in "${DENSITIES[@]}"; do
    density="${pair%%:*}"; size="${pair##*:}"
    mkdir -p "$DEST_DIR/mipmap-$density"
    sips -z "$size" "$size" "$SRC" --out "$DEST_DIR/mipmap-$density/ic_launcher.png" >/dev/null
  done
else
  echo "✗ 需要 ImageMagick（convert）或 macOS 的 sips" >&2
  exit 1
fi
echo "✓ 图标 $SRC → $DEST_DIR/mipmap-*"
