# 发布（出包）

Last updated: 2026-10-25

> 唯一路径是 **GitHub Actions → `release` → Run workflow**。
> 本地 `node scripts/build.mjs` 只用于预览与排障，产出的包不算发布。
> 品牌配置见 [`TENANT-GUIDE.md`](TENANT-GUIDE.md)，壳与 UI 的接口见 [`BRIDGE.md`](BRIDGE.md)。

## 1. 两个输入

| 输入 | 说明 |
|---|---|
| `platform` | `all` / `web` / `android` / `apple` / `windows`。见 §2 |
| `tag` | 留空 = 在最新 release 上 `patch+1`（首次 `v0.1.0`）；也可写 `1.2.3` 或 `v1.2.3`。统一按 `v` 前缀发布 |

## 2. 平台语义

| `platform` | 构建什么 | 现状 |
|---|---|---|
| `web` | 只出 web 包（`dist/web` + `manifest.json`）| ✅ 可用 |
| `android` | `apk` / `aab` | ⛔ 待 `shell-android` 落地 |
| `apple` | `dmg` / `pkg` | ⛔ 待 `shell-macos` 落地 |
| `windows` | `msix` / `exe` | ⛔ 待 `shell-windows` 落地 |
| `all` | 所有**已实现**的平台；未实现的打 warning 跳过 | ✅ 可用 |

三条口径：

1. **`web` 永远先构建。** 原生包内嵌同一份 `dist/web`，所以任何一次 release 里都有 web zip。
2. **显式选未实现的平台 ⇒ 直接失败**（`plan` job 报 `::error::`），**不建 release**。
   已出现过「tag 建了、资产是 0」的不一致状态，不要再来一次。
3. 「已实现」= `kit/kit.version` 不是 `0.0.0` **且** 该平台的 ci 入口脚本存在（见 §3）。
   两者缺一即视为未实现 —— 这是判断依据，不看目录里有没有 README。

## 3. 壳的构建入口契约

工作流不写死各端的工具链，只调用一个入口脚本。壳落地时补上即可，workflow 不用改：

| 平台 | 入口 | runner | 产物目录 |
|---|---|---|---|
| android | `shell-android/ci/build.sh` | `ubuntu-latest`（预装 JDK + Android SDK）| `shell-android/ci/out/` |
| apple | `shell-macos/ci/build.sh` | `macos-latest`（预装 Xcode）| `shell-macos/ci/out/` |
| windows | `shell-windows/ci/build.ps1` | `windows-latest`（预装 .NET）| `shell-windows/ci/out/` |

脚本必须满足：

1. **输入已就绪**：仓库根有 `dist/`（`web/` + `manifest.json`），`kit/` 里有 `kit/fetch-kit.sh`
   按 `PLATFORM` 拉好的二进制。脚本自己不要再跑 `build.mjs`。
2. **环境变量**：`RELEASE_TAG`（含 `v` 前缀）、`KIT_VERSION`、以及 §4 的签名材料。
3. **非交互**：不弹任何提示；失败以非 0 退出（CI 会因此不建 release）。
4. **产物落 `ci/out/`**，文件名带 `RELEASE_TAG`，后缀限定在
   `apk` `aab`（android）/ `dmg` `pkg`（apple）/ `msix` `msixbundle` `msi` `exe`（windows）。
   后缀不对的资产不会被收进 release。
5. **品牌与包名不重复计算**：品牌已注入 `dist/web/_brand.js`，包名在 `dist/manifest.json` 的
   `bundle_id` —— 脚本不要自己解析 `app.json`（租户改的是那个文件，但它不是包的输入）。
6. **可复现**：同一 tag + 同一 secrets ⇒ 同样的产物；版本号从 `RELEASE_TAG` 派生，不手填。

## 4. 需要的 Secrets（按平台，未启用的平台不用配）

在仓库 Settings → Secrets and variables → Actions 添加。名字已被工作流透传，脚本直接读环境变量。

| 平台 | Secrets |
|---|---|
| android | `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| apple | `APPLE_CERT_P12_BASE64`、`APPLE_CERT_PASSWORD`、`APPLE_APP_PASSWORD`、`APPLE_ID`、`APPLE_TEAM_ID` |
| windows | `WINDOWS_PFX_BASE64`、`WINDOWS_PFX_PASSWORD` |

- 签名材料**只**放 Secrets，不进仓库（本仓库是 public）。
- 免费账户的 fork：公开仓库的 Actions 分钟数免费，macOS runner 按 10 倍计（`apple` 平台最贵）。
- 商店上传（Play / App Store Connect）不在这条工作流里；`release` 只产可下载的安装包。

## 5. Release 里有什么

```
clever-vpn-app-web-vX.Y.Z.zip          始终存在
clever-vpn-app-android-vX.Y.Z.apk      platform=android 或 all 且壳已落地时
clever-vpn-app-android-vX.Y.Z.aab
clever-vpn-app-apple-vX.Y.Z.dmg
clever-vpn-app-windows-vX.Y.Z.msix|exe
```

- 只有当**所有被选中的平台都成功**才建 tag + release；
- `all` 里被跳过的平台属于「没做」而不是「做坏了」：run 里有 `::warning::`，release 里也**没有**对应资产。

## 6. 自检

```bash
# 配置与 UI 契约（与 CI 同一套脚本）
node scripts/build.mjs --check && node scripts/check-web.mjs

# 改过 .github/workflows/ 时
actionlint .github/workflows/*.yml
```

发布后核对：Release 里资产齐全 → 下载安装 → 页面上点「连接」真的能上外网
→ 关闭重开状态正确恢复。**CI 绿不等于能装**，真机验收是 T2（见 `clever-vpn-docs` 的 `design/app-studio.md` §4）。
