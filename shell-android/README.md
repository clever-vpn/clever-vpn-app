# shell-android

Android 薄壳：**Kotlin + VpnService**。

## 一个刻意的差异

> ⚠️ Android **不用 WebView 作主界面**。

原因：移动端 WebView 在 VPN 场景下体验差（动画掉帧、状态栏、电量、返回手势），
且安卓上「应用就是网页」很容易被认为是低质量应用。

⇒ **UI 用 Compose 原生**，但与 `web/` **共用同一套设计变量**（同样的 8 个 token），
只改配色/文案/接口地址这类配置。**bridge 契约完全一致**，因此将来若确需统一，可无痛替换。

## 计划接入

| 项 | 说明 |
|---|---|
| 隧道 | `VpnService` + 前台服务（通知栏常驻）|
| 权限 | 首次连接请求 `VpnService.prepare` 授权 |
| 核心 | `android-kit.aar`（`kit/fetch-kit.sh` 获取）|
| bridge | `WebViewCompat.addWebMessageListener`（若启用 WebView）或 Compose 直接调用 |
| 打包 | `apk`（直发）/ `aab`（商店）|

## 选型留白

MVP 阶段先做 **Windows + macOS**；Android 上线前再定：

- 方案 A：Compose 原生（推荐）
- 方案 B：WebView + 同一份 `web/`（需额外验证状态栏/返回手势/耗电）

两者契约相同，切换成本低。
