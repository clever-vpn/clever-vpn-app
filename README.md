# Next-VPN

> 白标 VPN 客户端 · 开源外壳 + 私有核心

给租户（VPN 服务商）用的**可品牌化客户端**：一份 Web UI，三个平台的薄外壳，核心逻辑在闭源 `kit` 里。

- **本仓库开源**：外壳 + UI（租户 fork 后只改 `app.json`、`assets/icon.png` 和 `web/`）
- **核心闭源**：`clever-vpn-*-kit`（Go），以预编译二进制分发，见 `kit/fetch-kit.sh`

## 结构

```
app.json            这个 App 是什么：名称 / 主色 / CRM 入口 / 链接（租户改这里）
assets/icon.png     图标源图：1024×1024 PNG、无 alpha、≤ 1MB
web/                界面（纯 HTML/CSS/JS，租户改这里）
app.lock.json       包名 + 血缘（机器生成，手改无效）
kit/kit.version     闭源核心版本（平台维护）
shell-windows/      WinUI 3 + WebView2
shell-macos/        SwiftUI + WKWebView + NetworkExtension 系统扩展
shell-android/      Kotlin + VpnService
scripts/build.mjs   构建：校验 → 注入 window.BRAND → 生成 dist/
docs/               架构、bridge 契约、租户指南
```

## 租户三步

1. 改 `app.json`（名称 / 主色 / CRM 地址）
2. 换 `assets/icon.png`（1024×1024、无透明通道）
3. 改 `web/` 里的文字与配色（或者交给 `clever-vpn-app-studio` 用对话改）

> 包名与核心版本**不在**你改的文件里：包名在 `app.lock.json`（机器生成），
> 核心版本在 `kit/kit.version`（平台发布时更新）。
> 不需要安装 Xcode / Android Studio / Visual Studio —— 构建在 GitHub Actions 上完成。

## Bridge 契约（壳与 UI 的唯一接口）

```js
await bridge.connect(configJson)   // 启动隧道
await bridge.disconnect()          // 停止隧道
await bridge.state()               // 状态快照（页面刷新后必调）
bridge.on('state', s => {})        // 状态变化事件
```

> 登录 / 注册 / 计费**不走 bridge**，由 `web/` 直接请求租户自己的后端。
> 详细定义见 [`docs/BRIDGE.md`](docs/BRIDGE.md)。

## 开发协作规则

- **禁止直接推 `main`**：先建 feature 分支 → PR → 合并。启用本地钩子：
  ```bash
  git config core.hooksPath .githooks
  ```
- 提交信息用 Conventional Commits（中文描述），例如：
  `feat(web): 节点列表支持延迟排序` / `fix(bridge): 连接超时重试`
- 发布走 Actions → `release`（`workflow_dispatch`）：先选 `platform`
  （`all` / `web` / `android` / `apple` / `windows`），`tag` 留空则自动 `patch+1`，统一 `v` 前缀。
  细节见 [`docs/RELEASE.md`](docs/RELEASE.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 分层、为什么用 Web UI、壳如何隔离 |
| [`docs/BRIDGE.md`](docs/BRIDGE.md) | bridge 方法、状态结构、错误码、安全约束 |
| [`docs/TENANT-GUIDE.md`](docs/TENANT-GUIDE.md) | 租户改造清单（改哪些、别改哪些） |
| [`docs/RELEASE.md`](docs/RELEASE.md) | 出包：平台选择、各端构建入口契约、需要的 Secrets |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 分支 / 提交 / 发布流程 |

## 许可

代码以 [MIT](LICENSE) 提供。**「Clever VPN」名称与标识不随代码授权**，白标客户请使用自己的品牌。
