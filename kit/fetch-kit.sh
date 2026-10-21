#!/usr/bin/env bash
# 下载闭源核心（预编译二进制），并校验 sha256。
#
# 用法：
#   ./kit/fetch-kit.sh            # 用 kit/kit.version 里的版本
#   ./kit/fetch-kit.sh 2.1.4      # 指定版本
#
# 产物（按平台，仅下载需要的那个）：
#   kit/android-kit.aar
#   kit/CleverVpnKit.xcframework
#   kit/windows-kit.dll
set -euo pipefail

cd "$(dirname "$0")"
VERSION="${1:-$(cat kit.version 2>/dev/null || echo '')}"
[ -n "$VERSION" ] || { echo "✗ 未指定版本，且没有 kit/kit.version"; exit 1; }

# TODO(发布前填真实地址)：核心库的发布仓库
BASE="${KIT_BASE_URL:-https://github.com/clever-vpn/clever-vpn-kit/releases/download/v${VERSION}}"
PLATFORM="${PLATFORM:-all}"     # all | android | apple | windows

echo "→ 版本 ${VERSION}  来源 ${BASE}"

fetch() {
  local name="$1" out="$2"
  if [ -f "$out" ]; then echo "  = 已存在 ${out}"; return; fi
  echo "  ↓ ${name}"
  curl -fsSL --retry 3 -o "$out" "${BASE}/${name}"
}

want() { [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "$1" ]; }

want android && fetch "android-kit.aar"              "android-kit.aar"
want apple   && fetch "CleverVpnKit.xcframework.zip" "CleverVpnKit.xcframework.zip"
want apple   && { [ -d CleverVpnKit.xcframework ] || unzip -q CleverVpnKit.xcframework.zip; }
want windows && fetch "windows-kit.zip"              "windows-kit.zip"
want windows && { [ -f windows-kit.dll ] || unzip -q windows-kit.zip; }

# 校验
if [ -f kit.sha256 ]; then
  echo "→ 校验 sha256"
  shasum -a 256 -c kit.sha256 || { echo "✗ 校验失败"; exit 1; }
else
  echo "  ⚠ 缺少 kit/kit.sha256，跳过校验（不建议）"
fi

echo "✓ 完成"
