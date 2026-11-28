#!/usr/bin/env bash
# Android 壳的构建入口：dist → 单测 → 图标 → assembleRelease / bundleRelease → 签名 → ci/out/
#
# 输入：仓库根的 dist/（web/ + manifest.json + icon.png）
# 环境变量：RELEASE_TAG；可选签名材料 ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD /
#           ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD（没有就出未签名包）
# 产物：shells/android/ci/out/clever-vpn-app-android-<tag>.apk|aab
set -euo pipefail

CI_DIR="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(cd "$CI_DIR/.." && pwd)"
ROOT="$(cd "$ANDROID_DIR/../.." && pwd)"
DIST="$ROOT/dist"
OUT="$CI_DIR/out"

log() { echo "→ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

[ -f "$DIST/manifest.json" ] || die "缺少 dist/manifest.json —— 先跑 node scripts/build.mjs"
[ -f "$DIST/icon.png" ] || die "缺少 dist/icon.png —— 先跑 node scripts/build.mjs"
[ -d "$DIST/web" ] || die "缺少 dist/web —— 先跑 node scripts/build.mjs"

META="$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write([m.name || "", m.version || "v0.0.0", (((m.bundle_id || {}).android) || "")].join("\n"));
' "$DIST/manifest.json")"
APP_NAME="$(printf '%s' "$META" | sed -n '1p')"
VERSION="$(printf '%s' "$META" | sed -n '2p' | sed 's/^v//' | sed 's/-.*$//')"
# 本地未设 RELEASE_TAG 时 dist 里可能是 "dev"：退回 0.0.0，别让数字解析炸掉
case "$VERSION" in ''|*[!0-9.]*) VERSION=0.0.0 ;; esac
APP_ID="$(printf '%s' "$META" | sed -n '3p')"
[ -n "$APP_ID" ] || die "dist/manifest.json 里没有 bundle_id.android"

KIT_VERSION="$(node "$ROOT/scripts/kit-version.mjs" --platform android)"
RELEASE_TAG="${RELEASE_TAG:-v$VERSION}"

IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
VERSION_CODE="$((10#$MAJOR * 10000 + 10#$MINOR * 100 + 10#$PATCH))"
[ "$VERSION_CODE" -ge 1 ] || VERSION_CODE=1   # 0.0.0-dev 这类开发 tag 也要能装

log "版本 ${RELEASE_TAG}（${VERSION} / code ${VERSION_CODE}）· kit ${KIT_VERSION} · ${APP_NAME} (${APP_ID})"

# 图标（生成到 res/mipmap-*，不入库）
"$CI_DIR/make-icons.sh" "$DIST/icon.png" "$ANDROID_DIR/app/src/main/res"

# 签名材料（没有就出未签名包）
SIGN_ARGS=()
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${ANDROID_KEY_ALIAS:-}" ] && [ -n "${ANDROID_KEY_PASSWORD:-}" ] \
    || die "有 ANDROID_KEYSTORE_BASE64 但缺少其它三项签名 secrets"
  KEYSTORE="$RUNNER_TEMP/android-release.keystore"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | openssl base64 -d -A > "$KEYSTORE"
  SIGN_ARGS=(
    "-PandroidReleaseStoreFile=$KEYSTORE"
    "-PandroidReleaseStorePassword=$ANDROID_KEYSTORE_PASSWORD"
    "-PandroidReleaseKeyAlias=$ANDROID_KEY_ALIAS"
    "-PandroidReleaseKeyPassword=$ANDROID_KEY_PASSWORD"
  )
  log "签名材料就绪"
else
  log "⚠ 没有 ANDROID_KEYSTORE_BASE64：出未签名包（只用于构建/功能验收）"
fi

GRADLE="${GRADLE_CMD:-gradle}"
command -v "$GRADLE" >/dev/null 2>&1 || die "缺少 gradle（CI 用 gradle/actions/setup-gradle 安装）"

log "单测 + 出包"
(cd "$ANDROID_DIR" && "$GRADLE" --no-daemon \
  -PkitVersion="$KIT_VERSION" \
  -PappId="$APP_ID" \
  -PappName="$APP_NAME" \
  -PappVersionName="$VERSION" \
  -PappVersionCode="$VERSION_CODE" \
  "${SIGN_ARGS[@]}" \
  :app:testDebugUnitTest :app:assembleRelease :app:bundleRelease)

mkdir -p "$OUT"
APK="$(ls "$ANDROID_DIR"/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1 || true)"
AAB="$(ls "$ANDROID_DIR"/app/build/outputs/bundle/release/*.aab 2>/dev/null | head -1 || true)"
[ -n "$APK" ] || die "没有找到 release apk"
[ -n "$AAB" ] || die "没有找到 release aab"

cp "$APK" "$OUT/clever-vpn-app-android-$RELEASE_TAG.apk"
cp "$AAB" "$OUT/clever-vpn-app-android-$RELEASE_TAG.aab"

# 签名自检（只有签名时才需要）
if [ ${#SIGN_ARGS[@]} -gt 0 ]; then
  APKSIGNER="$(ls "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$APKSIGNER" ] || die "找不到 apksigner"
  "$APKSIGNER" verify --print-certs "$OUT/clever-vpn-app-android-$RELEASE_TAG.apk" >/dev/null
  log "apksigner verify 通过"
fi

log "✓ 产物："
ls -lh "$OUT"
