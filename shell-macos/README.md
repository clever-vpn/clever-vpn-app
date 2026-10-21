# shell-macos

macOS 薄壳：**SwiftUI + WKWebView** + **NetworkExtension 系统扩展**。

## 三层结构

```
SwiftUI（窗口/托盘）  ──WKScriptMessageHandler──▶  WKWebView（dist/web）
        │
        └── NETunnelProviderManager.sendProviderMessage ──▶ System Extension（Swift）
                                                                 │
                                                                 └─▶ apple-kit（Go xcframework）
```

## 计划接入

| 项 | 说明 |
|---|---|
| 窗口 | 无边框标题栏、可拖拽区、迷你模式（360×200）|
| 托盘 | 菜单栏常驻 + 菜单项 |
| 隧道 | NetworkExtension **system extension**（macOS 10.15+，非商店分发需用户批准）|
| App ↔ 扩展 | `sendProviderMessage`（控制）；扩展 → App **无推送** ⇒ 用 App Group + Darwin 通知 |
| bridge | `WKScriptMessageHandler` ↔ `evaluateJavaScript`（主线程），3 个方法白名单 |
| 分发 | DMG（Developer ID 签名 + 公证）|

## 注意事项

- `sendProviderMessage` 的回调可能**永不返回** ⇒ 必须加超时
- messageHandler 会造成循环引用 ⇒ 用 `weak` 或页面销毁时移除
- 扩展未启动时消息会失败 ⇒ 先 `loadFromPreferences` 确认 manager 状态

## 落地方式

复制现有 Apple 客户端工程（已含 system extension、extensionkit-extension、DMG 打包），将 SwiftUI 页面替换为全屏 `WKWebView`，注入 bridge。
