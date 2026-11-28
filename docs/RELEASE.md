# 发布（出包）

Last updated: 2026-11-28

> 唯一路径是 **GitHub Actions → `release` → Run workflow**。
> 本地 `node scripts/build.mjs` 只用于预览与排障，产出的包不算发布。
> 品牌配置见 [`TENANT-GUIDE.md`](TENANT-GUIDE.md)，壳与 UI 的接口见 [`BRIDGE.md`](BRIDGE.md)，
> 壳的目录与构建入口见 [`../shells/README.md`](../shells/README.md)。

## 1. 两个输入

| 输入 | 说明 |
|---|---|
| `platform` | `all` / `web` / `android` / `apple` / `windows`。见 §2 |
| `tag` | 留空 = 在最新 release 上 `patch+1`（首次 `v0.1.0`）；也可写 `1.2.3` 或 `v1.2.3`。统一按 `v` 前缀发布 |

## 2. 平台语义

| `platform` | 构建什么 | 当前 |
|---|---|---|
| `web` | 只出 web 包（`dist/web` + `manifest.json`）| ✅ |
| `android` | `apk` / `aab` | 取决于 `shells/android/ci/build.sh` 是否存在 |
| `apple` | `dmg`（公证） | 取决于 `shells/macos/ci/build.sh` 是否存在 |
| `windows` | `msi`（签名） | 取决于 `shells/windows/ci/build.ps1` 是否存在 |
| `all` | 所有**已实现**的平台；未实现的打 warning 跳过 | ✅ |

三条口径：

1. **`web` 永远先构建。** 原生包内嵌同一份 `dist/`（web + manifest + icon），所以每次 release 都有 web zip。
2. **「已实现」只看一件事**：该平台的 `ci` 入口存在（见 §3）。显式选未实现的平台 ⇒ 直接失败，不建 release。
3. **不建空 release**：所有被选中的平台都成功后才建 tag + release。

## 3. 壳的构建入口契约

工作流不写死各端工具链，只调用一个入口脚本：

| 平台 | 入口 | runner | kit 版本 | 产物目录 |
|---|---|---|---|---|
| android | `shells/android/ci/build.sh` | `ubuntu-latest` | `shells/versions.json` 的 `android` | `shells/android/ci/out/` |
| apple | `shells/macos/ci/build.sh` | `macos-15` | `shells/versions.json` 的 `apple` | `shells/macos/ci/out/` |
| windows | `shells/windows/ci/build.ps1` | `windows-2022`（WinUI 1.7 需要 VS2022 的 PRI/MSIX 任务；`windows-latest` 已是 VS2026） | `shells/versions.json` 的 `windows` | `shells/windows/ci/out/` |

脚本必须满足：

1. **输入已就绪**：仓库根有 `dist/`（`web/` + `manifest.json` + `icon.png`）。脚本自己不要再跑 `build.mjs`。
2. **环境变量**：`RELEASE_TAG`（含 `v` 前缀；版本号本身以 `dist/manifest.json` 的 `version` 为准）、
   以及 §4 的签名材料。**kit 版本由脚本自己从 `shells/versions.json` 读**，工作流不传。
3. **非交互**：不弹提示；失败以非 0 退出。
4. **产物落 `ci/out/`**，文件名带 `RELEASE_TAG`，后缀限定在
   `apk` `aab`（android）/ `dmg`（apple）/ `msi`（windows）。后缀不对的资产不会被收进 release。
5. **品牌与包名不重复计算**：品牌已注入 `dist/web/_brand.js`，包名在 `dist/manifest.json` 的
   `bundle_id` —— 脚本不要自己解析 `app/app.json`。
6. **可复现**：同一 tag + 同一 secrets ⇒ 同样的产物；版本号从 `RELEASE_TAG` 派生，不手填。

## 4. 需要的 Secrets（按平台，未启用的平台不用配）

在仓库 Settings → Secrets and variables → Actions 添加。名字已被工作流透传，脚本直接读环境变量。

| 平台 | Secrets |
|---|---|
| android | `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| apple | `APPLE_CERT_P12_BASE64`、`APPLE_CERT_PASSWORD`、`APPLE_TEAM_ID`、`APPLE_PROFILE_APP_BASE64`、`APPLE_PROFILE_SYSEXT_BASE64`、`APPLE_ASC_KEY_ID`、`APPLE_ASC_ISSUER_ID`、`APPLE_ASC_KEY_P8_BASE64` |
| windows | `WINDOWS_PFX_BASE64`、`WINDOWS_PFX_PASSWORD` |

- 签名材料**只**放 Secrets，不进仓库（本仓库是 public）。
- Apple 的两份 provisioning profile 要对应 `bundle_id.macos` 与 `<bundle_id.macos>.system`（kit 的 `AppConfiguration.systemExtensionBundleID` 固定拼 `.system`），
  能力：Network Extensions、System Extension、App Group。只出 macOS 直发（Developer ID + 公证）时，
  不需要 Mac App Store 那一套证书。
- 免费账户的 fork：公开仓库的 Actions 分钟数免费，macOS runner 按 10 倍计（`apple` 最贵）。
- 商店上传（Play / App Store Connect）不在这条工作流里；`release` 只产可下载的安装包。
- 缺签名材料时脚本应**跳过签名**出未签名包（仅用于功能验收），而不是假装成功。

## 5. kit 版本

| 事项 | 做法 |
|---|---|
| 唯一来源 | `shells/versions.json`（`{android, apple, windows}`，平台维护） |
| 读取 | 各壳的 `ci/build.*` 自己读（`node scripts/kit-version.mjs --platform <p>` 或平台原生工具） |
| 升级 | 改 `shells/versions.json` → PR；不需要动 workflow |
| 校验 | `node scripts/build.mjs --check` 不读它；`test/kit-versions.test.mjs` 拦非法形状 |

## 6. Release 里有什么

```
clever-vpn-app-web-vX.Y.Z.zip          始终存在
clever-vpn-app-android-vX.Y.Z.apk|aab  壳已落地时
clever-vpn-app-macos-vX.Y.Z.dmg
clever-vpn-app-windows-vX.Y.Z.msi
```

- 只有当**所有被选中的平台都成功**才建 tag + release；
- `all` 里被跳过的平台属于「没做」而不是「做坏了」：run 里有 `::warning::`，release 里也**没有**对应资产。

## 7. 自检

```bash
# 配置与 UI 契约（与 CI 同一套脚本）
node scripts/build.mjs --check && node scripts/check-web.mjs
node --test "test/*.test.mjs"
npx playwright test

# 改过 .github/workflows/ 时
actionlint .github/workflows/*.yml
```

发布后核对：Release 里资产齐全 → 下载安装 → 页面上点「连接」真的能上外网
→ 关闭重开状态正确恢复。**CI 绿不等于能装**，真机验收是 T2（见 `clever-vpn-docs` 的 `design/app-studio.md` §4）。
