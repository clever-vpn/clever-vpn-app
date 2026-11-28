# Next-VPN

> 白标 VPN 客户端 · 开源外壳 + 私有核心

给租户（VPN 服务商）用的**可品牌化客户端**：一份 Web UI，三个平台的薄外壳，核心逻辑在闭源 `kit` 里。

- **本仓库开源**：外壳 + UI。租户 fork 后只改 `app/`（里面是 `app.json`、`assets/`、`web/`）
- **核心闭源**：`clever-vpn-*-kit`（Go），以 Maven / SPM / NuGet 分发（版本由平台维护）

## 结构

```
app/                租户面（Studio 唯一可写）——fork 后只改这里
  app.json            这个 App 是什么：名称 / 副标题 / 主色 / 图标与标记 / CRM / 链接
  assets/             图标源图（icon，1024×1024 PNG 无 alpha）与界面标记（logo，PNG/SVG）
  web/                界面：10 页 HTML + app.css + ui/api/bridge/icons.js
app.lock.json       包名 + 血缘（机器生成，手改无效）
app/web/bridge.js   无壳时的最小 fallback（真实壳在 shells/）
scripts/build.mjs   构建：校验 → 注入 window.BRAND → 生成 dist/
scripts/lib/web-check.mjs  闸门纯函数（CI 与 Studio 共用同一份判决，bridge 版本号在这里）
scripts/check-web.mjs      闸门 CLI
scripts/check-paths.mjs    分支前缀 ↔ 允许路径
shells/mock/bridge.js      模拟壳（Studio 预览与 CI 冒烟共用的那份「壳」）
shells/windows/     WinUI 3 + WebView2
shells/macos/       SwiftUI + WKWebView + NetworkExtension 系统扩展
shells/android/     Kotlin + WebView + VpnService
shells/versions.json  kit 版本矩阵（平台维护）
docs/               架构、bridge 契约、UI 原则、租户指南
```

## 租户三步

1. 改 `app/app.json`（名称 / 副标题 / 主色 / CRM 地址 / 链接）
2. 换 `app/assets/icon.png`（1024×1024、无透明通道），要单色标记就放 `app/assets/logo.svg`
3. 改 `app/web/` 里的文字与配色（或者交给 `clever-vpn-app-studio` 用对话改）

> 包名**不在**你改的文件里：它在 `app.lock.json`（机器生成）；核心版本由平台维护。
> 不需要安装 Xcode / Android Studio / Visual Studio —— 构建在 GitHub Actions 上完成。

## 十个页面

| 文件 | 屏 |
|---|---|
| `app/web/welcome.html` | 欢迎（品牌标记 / 名称 / 副标题 / 开始使用） |
| `app/web/login.html` | 邮箱验证码（发码 → 验证码 → 重发冷却 → 换邮箱） |
| `app/web/index.html` | 连接主界面（大圆钮 / 状态 / 计时 / 流量 / 当前线路） |
| `app/web/lines.html` | 线路（搜索 / 流量系数 / 选中即生效） |
| `app/web/plans.html` | 套餐（服务端视图模型驱动 / 网页收银台） |
| `app/web/account.html` | 账户（订阅 / 订单 / 退出） |
| `app/web/settings.html` | 设置（协议 / 分流入口 / 连接信息 / 主题 / 关于） |
| `app/web/split.html` | 分流（区域 / IP / 域名 / 正则） |
| `app/web/region.html` | 地区（可搜索 + 选中即生效） |
| `app/web/redeem.html` | 兑换 / 礼包 / 奖励卡 |

多页是刻意的：一屏一文件、每屏不会长到 AI 改不动；代价是导航会重载，所以每屏都有骨架/稳定布局。

## Bridge 契约（壳与 UI 的唯一接口）

```js
await bridge.activate(code)        // 激活（code 来自 /subscription，不展示）
await bridge.lines()               // 线路列表
await bridge.setLine(id)           // 选线路
await bridge.connect()             // 连接（无参数：线路由 setLine 决定）
await bridge.disconnect()
const s = await bridge.state()     // 状态快照（页面刷新后必调）
bridge.on('state', s => {})        // 状态变化事件
```

`bridge@3` 共 14 个方法（含 `capabilities` / `settings` / `setProtocol` / `setSplit` / 可选的 `open`，以及 CRM 的 `crmRequest`）。
登录 / 注册 / 计费也走 `bridge.crmRequest`：WebView 不直接请求 CRM，由壳 → kit → libbox 完成（无壳时回退 `fetch`）。

> 详细定义见 [`docs/BRIDGE.md`](docs/BRIDGE.md)。模拟壳在 [`shells/mock/bridge.js`](shells/mock/bridge.js)。

## 门禁（build ref 上四个 required check）

| job | 跑什么 |
|---|---|
| `validate` | `node scripts/build.mjs --check`（app.json / 图标 / logo / app.lock.json） |
| `web-contract` | `node scripts/check-web.mjs`（14 条静态约束，与 Studio 的 `check_draft` 同一份实现） |
| `web-smoke` | Playwright：10 页 × 视口 × 主题截图、点击流、错误码、品牌替换、无 console error |
| `path-whitelist` | 按 ref 判允许路径（`studio/app` 设计、`studio/build/*` 构建），越界即失败 |

本地跑同一套：`npm ci && node scripts/build.mjs && node --test && npx playwright test`。

## 开发协作规则

- **禁止直接推 `main`**：先建 feature 分支 → PR → 合并。启用本地钩子：
  ```bash
  git config core.hooksPath .githooks
  ```
- 提交信息用 Conventional Commits（中文描述），例如：
  `feat(web): 线路列表支持搜索` / `fix(bridge): 连接超时重试`
- 发布走 Actions → `app-release`（`workflow_dispatch`，只接受 `studio/build/*`）：先选 `platform`
  （`all` / `web` / `android` / `apple` / `windows`），`tag` 留空则自动 `patch+1`，统一 `v` 前缀。
  细节见 [`docs/RELEASE.md`](docs/RELEASE.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 分层、为什么用 Web UI、壳如何隔离 |
| [`docs/BRIDGE.md`](docs/BRIDGE.md) | `bridge@3` 方法、状态结构、错误码、安全约束 |
| [`docs/UI-PRINCIPLES.md`](docs/UI-PRINCIPLES.md) | 界面原则（M1–M14）与产品级验收清单 |
| [`docs/TENANT-GUIDE.md`](docs/TENANT-GUIDE.md) | 租户改造清单（改哪些、别改哪些、怎么验收） |
| [`docs/UI-REFERENCE.md`](docs/UI-REFERENCE.md) | 竞品与平台实测（素材参考，不是规范） |
| [`docs/RELEASE.md`](docs/RELEASE.md) | 出包：平台选择、各端构建入口契约、需要的 Secrets |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 分支 / 提交 / 发布流程 |

## 许可

代码以 [MIT](LICENSE) 提供。**「Clever VPN」名称与标识不随代码授权**，白标客户请使用自己的品牌。
