# shells/macos

SwiftUI + WKWebView + NetworkExtension 系统扩展。窗口里只有一个 WKWebView（自定义 scheme
`clevervpn://` 伺服 bundle 里的 `web/`），14 个 bridge 方法由 SwiftPM 包
`CleverVpnShellCore` 校验，能力来自闭源 `CleverVpnKit`。

```
Core/                 SwiftPM 包：dispatcher + 参数校验 + 错误信封 + manifest（本机可 `swift test`）
CleverVpn/            App 目标：SwiftUI 窗口、WKWebView、bridge shim、kit 接线、系统扩展安装
CleverVpnExtension/   系统扩展目标（主类继承 kit 的 CleverVpnPacketTunnelProvider）
project.yml           XcodeGen 工程定义（ci 先替换 __KIT_VERSION__ 再生成 .xcodeproj）
ci/build.sh           构建入口：dist → swift test → xcodegen → archive → DMG → 公证
ci/make-icon.sh       dist/icon.png → AppIcon.icns
```

本地（macOS，需 Xcode + `brew install xcodegen`）：

```bash
node scripts/build.mjs
bash shells/macos/ci/build.sh          # 没配证书 ⇒ 未签名 DMG（只做构建/功能验收）
```

- kit 版本：`shells/versions.json` 的 `apple`。
- 包名：`dist/manifest.json` 的 `bundle_id.macos`；系统扩展的 bundle id 固定为 `<bundle>.system`
  （kit 的 `AppConfiguration.systemExtensionBundleID` 就是这么拼的），两者要在 Apple Developer
  后台各建一个 App ID + Developer ID provisioning profile。
- 签名/公证 secrets：`APPLE_CERT_P12_BASE64`、`APPLE_CERT_PASSWORD`、`APPLE_TEAM_ID`、
  `APPLE_PROFILE_APP_BASE64`、`APPLE_PROFILE_SYSEXT_BASE64`、`APPLE_ASC_KEY_ID`、
  `APPLE_ASC_ISSUER_ID`、`APPLE_ASC_KEY_P8_BASE64`。
- 首次启动会请求安装系统扩展；用户需在「系统设置 → 隐私与安全性」批准后连接才可用。
- CI：`.github/workflows/_shell-macos.yml`（`release.yml` 调用，也可单独 dispatch）。
