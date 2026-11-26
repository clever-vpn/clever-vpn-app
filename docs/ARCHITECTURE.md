# 架构

## 分层

```
┌───────────── web/（开源，租户改这里）─────────────┐
│  10 页：欢迎 / 登录 / 连接 / 线路 / 套餐 / 账户   │
│        / 设置 / 分流 / 地区 / 兑换                │
│  纯 HTML/CSS/JS，单一来源，三端共用               │
│  依赖只有三个：window.BRAND、bridge@2、CRM 契约   │
└───────────────┬──────────────────────────────────┘
                │  bridge@2（13 方法 + 1 事件，见 BRIDGE.md）
┌───────────────┴──────────────────────────────────┐
│  shell-*（开源，薄）                              │
│  Windows WinUI3+WebView2 / macOS SwiftUI+WKWebView │
│  Android Kotlin+VpnService                        │
│  职责：窗口、托盘、自启、WebView 承载、bridge 注入  │
└───────────────┬──────────────────────────────────┘
                │  直接函数调用 / 动态库
┌───────────────┴──────────────────────────────────┐
│  clever-vpn-*-kit（**闭源**，Go，预编译二进制）    │
│  隧道、协议、内核交互                              │
└──────────────────────────────────────────────────┘
                │
        服务端（闸门在这里）
```

## 页面为什么是多页

| 选择 | 原因 |
|---|---|
| 一屏一文件（`web/*.html`） | 每屏足够小，AI 与租户都能只改一屏；改坏了也只坏一屏 |
| 共享 `app.css` + 4 个 JS | 品牌、会话、壳调用、图标各有一条唯一入口 |
| 每次导航重载 | 没有客户端路由器；代价由"每屏骨架 + 首屏稳定高度"补上 |

约束：`web/index.html` 必须存在、`app.css` 必须定义 8 个品牌变量、页面里不得出现硬编码 `#rrggbb`。
机器判定见 `scripts/lib/web-check.mjs`。

## 为什么 UI 用 Web 技术

| 原因 | 说明 |
|---|---|
| 租户改动量最小 | 改 HTML/CSS/JS 即可，不必学 Dart / Swift / Kotlin |
| 一套界面覆盖三端 | 换品牌 = 改 `app.json` + `window.BRAND` 驱动 |
| 迭代快 | 改完重新构建即可；Studio 用 PR 交付 |
| 界面里没有可被破解的授权逻辑 | 授权在服务端，UI 只"呈现" |

## 为什么壳能做到很薄

| 能力 | 在哪 |
|---|---|
| 隧道启停、线路、协议、分流 | kit |
| 授权判定 | 服务端 |
| 界面 | web/ |
| 壳只剩下 | 窗口、托盘、自启、WebView 承载、bridge 注入、打包 |

## 为什么壳可替换

`web/` 只依赖 `bridge@2`，不依赖任何壳的特性。因此：

- 现在：手搓壳（复用既有客户端经验，成本最低）
- 以后若需支持更多桌面平台或统一升级/托盘：可整体换成 Tauri 等，**租户代码一行不改**

这是本架构最重要的性质：**壳是消耗品，契约是资产。**

## 唯一判决与单一实现

```
clever-vpn-app/scripts/lib/web-check.mjs    ← 真源（纯函数，无 fs / node:*）
clever-vpn-app/scripts/check-web.mjs        ← CI 的 CLI 包装（读盘 / --report）
clever-vpn-app-studio/src/gate/web-check.mjs ← 逐字节副本（check_draft 用）
```

Studio 与 CI 必须对同一份草稿给出**同一组 check id/status**；副本由 `npm run webcheck:sync` 同步，
sha 不一致即失败。`template.json` 是"这条流水线期望的模板包版本"，版本不符 ⇒ 503，不静默降级。

## 已知边界

| 项 | 说明 |
|---|---|
| macOS NetworkExtension | 系统扩展必须原生 Swift，任何跨端框架都替代不了 |
| Windows 隧道提权 | 需要服务 / Wintun 驱动，属壳与 kit 的职责 |
| Android | 不建议用 WebView 做主界面（状态栏、动画、电量），可用 Compose 原生，但契约不变 |
| 商店内购 / 设备管理 / 系统代理 / 多语言 | v1 不做，契约留口（见 `clever-vpn-docs` 的 `app-studio-app` §4 与 `clients`） |
| 人机校验（Turnstile） | **永久不做**：App 不加载第三方脚本，CRM 若启用则自行拒绝 |
