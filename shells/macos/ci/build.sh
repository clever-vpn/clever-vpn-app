#!/usr/bin/env bash
# macOS 壳的构建入口：dist → SwiftPM 单测 → xcodegen → archive → DMG → 公证。
#
# 输入：仓库根的 dist/（web/ + manifest.json + icon.png）
# 环境变量：RELEASE_TAG；签名/公证材料（可缺省 ⇒ 出未签名包，仅做功能验收）
# 产物：shells/macos/ci/out/clever-vpn-app-macos-<RELEASE_TAG>.dmg
set -euo pipefail

CI_DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS_DIR="$(cd "$CI_DIR/.." && pwd)"
ROOT="$(cd "$MACOS_DIR/../.." && pwd)"
DIST="$ROOT/dist"
OUT="$CI_DIR/out"
WORK="$MACOS_DIR/build"

log() { echo "→ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

[ -f "$DIST/manifest.json" ] || die "缺少 dist/manifest.json —— 先跑 node scripts/build.mjs"
[ -f "$DIST/icon.png" ] || die "缺少 dist/icon.png —— 先跑 node scripts/build.mjs"
[ -d "$DIST/web" ] || die "缺少 dist/web —— 先跑 node scripts/build.mjs"

# ── 1) 读 manifest / kit 版本 ──────────────────────────────
META="$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write([m.name || "", m.version || "v0.0.0", ((m.bundle_id || {}).macos) || ""].join("\n"));
' "$DIST/manifest.json")"
APP_DISPLAY_NAME="$(printf '%s' "$META" | sed -n '1p')"
VERSION="$(printf '%s' "$META" | sed -n '2p' | sed 's/^v//' | sed 's/-.*$//')"
# 本地未设 RELEASE_TAG 时 dist 里可能是 "dev"：退回 0.0.0
case "$VERSION" in ''|*[!0-9.]*) VERSION=0.0.0 ;; esac
APP_BUNDLE_ID="$(printf '%s' "$META" | sed -n '3p')"
[ -n "$APP_BUNDLE_ID" ] || die "dist/manifest.json 里没有 bundle_id.macos"

KIT_VERSION="$(plutil -extract apple raw -o - "$ROOT/shells/versions.json")"
[ -n "$KIT_VERSION" ] || die "shells/versions.json 里没有 apple 版本"
RELEASE_TAG="${RELEASE_TAG:-v$VERSION}"

log "版本 ${RELEASE_TAG} · kit ${KIT_VERSION} · ${APP_DISPLAY_NAME} (${APP_BUNDLE_ID})"

# ── 2) 资源：web / manifest / 图标 ────────────────────────
RES="$MACOS_DIR/CleverVpn/Resources"
rm -rf "$RES/web"
cp -R "$DIST/web" "$RES/web"
cp "$DIST/manifest.json" "$RES/manifest.json"
"$CI_DIR/make-icon.sh" "$DIST/icon.png" "$RES/AppIcon.icns"

# ── 3) 签名材料（没有就出未签名包）───────────────────────
SIGNED=0
APP_PROFILE=""
SYSEXT_PROFILE=""
KEYCHAIN=""
if [ -n "${APPLE_CERT_P12_BASE64:-}" ]; then
  [ -n "${APPLE_TEAM_ID:-}" ] || die "有 APPLE_CERT_P12_BASE64 但没有 APPLE_TEAM_ID"
  [ -n "${APPLE_PROFILE_APP_BASE64:-}" ] || die "缺 APPLE_PROFILE_APP_BASE64（App 的 provisioning profile）"
  [ -n "${APPLE_PROFILE_SYSEXT_BASE64:-}" ] || die "缺 APPLE_PROFILE_SYSEXT_BASE64（系统扩展的 profile）"

  PROFILE_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
  mkdir -p "$PROFILE_DIR"
  decode() { openssl base64 -d -A; }

  APP_PROFILE_FILE="$PROFILE_DIR/clevervpn-app.provisionprofile"
  SYSEXT_PROFILE_FILE="$PROFILE_DIR/clevervpn-sysext.provisionprofile"
  printf '%s' "$APPLE_PROFILE_APP_BASE64" | decode > "$APP_PROFILE_FILE"
  printf '%s' "$APPLE_PROFILE_SYSEXT_BASE64" | decode > "$SYSEXT_PROFILE_FILE"
  APP_PROFILE="$(security cms -D -i "$APP_PROFILE_FILE" | plutil -extract Name raw -o - -)"
  SYSEXT_PROFILE="$(security cms -D -i "$SYSEXT_PROFILE_FILE" | plutil -extract Name raw -o - -)"

  KEYCHAIN="$RUNNER_TEMP/ci-signing.keychain-db"
  KEYCHAIN_PASSWORD="$(uuidgen)"
  CERT_PATH="$RUNNER_TEMP/developer-id.p12"
  printf '%s' "$APPLE_CERT_P12_BASE64" | decode > "$CERT_PATH"
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings -lut 21600 "$KEYCHAIN"
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security import "$CERT_PATH" -k "$KEYCHAIN" -P "${APPLE_CERT_PASSWORD:-}" \
    -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productbuild
  security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
  SIGNED=1
  log "签名材料就绪（profile：${APP_PROFILE} / ${SYSEXT_PROFILE}）"
else
  log "⚠ 没有 APPLE_CERT_P12_BASE64：出未签名包（只用于构建/功能验收，不能分发）"
fi

# ── 4) xcconfig + 工程 ───────────────────────────────────
APP_GROUP_ID="$([ "$SIGNED" = 1 ] && echo "$APPLE_TEAM_ID.group.$APP_BUNDLE_ID" || echo "group.$APP_BUNDLE_ID")"
APP_BUILD="${GITHUB_RUN_NUMBER:-1}"

command -v xcodegen >/dev/null 2>&1 || die "缺少 xcodegen：macOS runner 上 brew install xcodegen"

# 把品牌/证书/版本替换进工程定义（不再用 xcconfig：两个 target 的 bundle id/证书不同，
# 逐 target 的 xcconfig 容易在 archive 时丢变量）。
PROJECT_SRC="$MACOS_DIR/project.yml" PROJECT_OUT="$MACOS_DIR/project.generated.yml" \
KIT_VERSION="$KIT_VERSION" APP_BUNDLE_ID="$APP_BUNDLE_ID" APP_GROUP_ID="$APP_GROUP_ID" \
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}" APP_VERSION="$VERSION" APP_BUILD="$APP_BUILD" \
APP_DISPLAY_NAME="$APP_DISPLAY_NAME" APP_PROFILE="$APP_PROFILE" SYSEXT_PROFILE="$SYSEXT_PROFILE" \
python3 - <<'PY'
import os
src = open(os.environ["PROJECT_SRC"], encoding="utf-8").read()
mapping = {
    "__KIT_VERSION__": os.environ.get("KIT_VERSION", ""),
    "__APP_BUNDLE_ID__": os.environ.get("APP_BUNDLE_ID", ""),
    "__APP_GROUP_ID__": os.environ.get("APP_GROUP_ID", ""),
    "__APPLE_TEAM_ID__": os.environ.get("APPLE_TEAM_ID", ""),
    "__APP_VERSION__": os.environ.get("APP_VERSION", ""),
    "__APP_BUILD__": os.environ.get("APP_BUILD", ""),
    "__APP_DISPLAY_NAME__": os.environ.get("APP_DISPLAY_NAME", ""),
    "__APP_PROFILE__": os.environ.get("APP_PROFILE", ""),
    "__SYSEXT_PROFILE__": os.environ.get("SYSEXT_PROFILE", ""),
}
for key, value in mapping.items():
    src = src.replace(key, value.replace('"', '\\"').replace("\n", " "))
open(os.environ["PROJECT_OUT"], "w", encoding="utf-8").write(src)
PY

log "SwiftPM 单测（Core）"
swift test --package-path "$MACOS_DIR/Core"

log "生成 Xcode 工程"
(cd "$MACOS_DIR" && xcodegen generate --spec project.generated.yml)

# ── 5) archive ───────────────────────────────────────────
ARCH="$WORK/CleverVpn.xcarchive"
rm -rf "$WORK"
mkdir -p "$WORK"
SIGN_FLAGS=(CODE_SIGN_STYLE=Manual)
if [ "$SIGNED" != 1 ]; then
  SIGN_FLAGS=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=)
fi

log "xcodebuild archive"
xcodebuild \
  -project "$MACOS_DIR/CleverVpn.xcodeproj" \
  -scheme CleverVpn \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath "$ARCH" \
  "${SIGN_FLAGS[@]}" \
  archive

APP="$ARCH/Products/Applications/CleverVpn.app"
[ -d "$APP" ] || die "archive 里没有 CleverVpn.app"

# ── 6) DMG +（可选）公证 ─────────────────────────────────
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/CleverVpn.app"
ln -s /Applications "$STAGE/Applications"

mkdir -p "$OUT"
DMG="$OUT/clever-vpn-app-macos-$RELEASE_TAG.dmg"
rm -f "$DMG"
hdiutil create -volname "$APP_DISPLAY_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
log "DMG：$DMG"

if [ "$SIGNED" = 1 ]; then
  [ -n "${APPLE_ASC_KEY_ID:-}" ] && [ -n "${APPLE_ASC_ISSUER_ID:-}" ] && [ -n "${APPLE_ASC_KEY_P8_BASE64:-}" ] \
    || die "签名时还需要 APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID / APPLE_ASC_KEY_P8_BASE64（notarytool）"

  KEY_DIR="$HOME/.appstoreconnect/private_keys"
  mkdir -p "$KEY_DIR"
  KEY_PATH="$KEY_DIR/AuthKey_${APPLE_ASC_KEY_ID}.p8"
  printf '%s' "$APPLE_ASC_KEY_P8_BASE64" | openssl base64 -d -A > "$KEY_PATH"
  chmod 600 "$KEY_PATH"

  codesign --verify --deep --strict "$APP" || die "App 签名校验失败"
  log "notarytool submit"
  xcrun notarytool submit "$DMG" --key "$KEY_PATH" --key-id "$APPLE_ASC_KEY_ID" --issuer "$APPLE_ASC_ISSUER_ID" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  log "公证完成"
fi

log "✓ 产物：$DMG"
ls -lh "$OUT"
