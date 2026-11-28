# shells/android

Kotlin + WebView + VpnService 薄壳。全屏 WebView 用 `WebViewAssetLoader` 以
`https://appassets.androidplatform.net` 加载 assets 里的 `web/`（localStorage 可用），
14 个 bridge 方法由 `BridgeDispatcher` 校验，能力来自闭源 `VpnClient`。

```
app/src/main/java/com/clevervpn/app/
  MainActivity.kt          WebView 承载、bridge 接线、VpnService 授权、外链/返回
  shell/BridgeShim.kt      document-start 注入的 window.bridge
  shell/Manifest.kt        读 assets/manifest.json（crm.base）
  bridge/ShellBackend.kt   数据形状 + 能力接口
  bridge/BridgeDispatcher.kt  14 方法 + 参数校验 + 错误信封
  kit/KitBackend.kt        用 VpnClient 实现能力面
app/src/test/              纯 JVM 单测（不需模拟器）
ci/build.sh                构建入口：dist → 单测 → 图标 → apk/aab → 签名 → ci/out/
ci/make-icons.sh           dist/icon.png → res/mipmap-*
```

本地（需 JDK 17 + Android SDK + Gradle 8.10+）：

```bash
node scripts/build.mjs
cd shells/android
gradle -PkitVersion=2.1.8 -PappId=com.example.nextvpn -PappName="Next VPN" \
  -PappVersionName=0.1.0 -PappVersionCode=100 :app:testDebugUnitTest
```

- kit 版本：`shells/versions.json` 的 `android`（Maven：`net.clever-vpn:clever-vpn-android-kit`）。
- 包名：`dist/manifest.json` 的 `bundle_id.android`。
- 签名 secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、
  `ANDROID_KEY_PASSWORD`；没有就出未签名包（只做构建/功能验收）。
- CI：`.github/workflows/_shell-android.yml`（`release.yml` 调用，也可单独 dispatch）。
