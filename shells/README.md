# shells/ —— 三端薄壳

壳只做四件事：窗口/托盘、WebView 承载、bridge 注入、打包。隧道、线路、协议、分流都在闭源 kit 里。

```
shells/
  versions.json      kit 版本矩阵（平台维护；每个壳的 ci 脚本读自己那一项）
  mock/bridge.js     模拟壳：Studio 预览 + web-smoke 共用（不随安装包发布）
  windows/           WinUI 3 + WebView2            ci/build.ps1
  macos/             SwiftUI + WKWebView + NE 扩展  ci/build.sh
  android/           Kotlin + WebView + VpnService  ci/build.sh
```

- **契约**：`docs/BRIDGE.md`（`bridge@3` 14 个方法 + `crmRequest`）。壳不定义接口，只实现接口。
- **桥的版本**只有一个：`scripts/lib/web-check.mjs` 的 `BRIDGE_VERSION`（模拟壳的方法表由
  `test/mock-shell.test.mjs` 对账）。
- **构建入口**：`shells/<platform>/ci/build.*`，输入是仓库根的 `dist/`（`web/` + `manifest.json`
  + `icon.png`）。本地先跑 `node scripts/build.mjs`。
- **kit 版本**：改 `shells/versions.json`，不需要动 workflow。
