---
name: white-label-app
description: **WORKFLOW SKILL** — 把 clever-vpn-app 变成自有品牌应用并由 GitHub Actions 出包。USE FOR: 改应用名/副标题/图标/标记/配色、`app/app.json` 校验失败、图标被拒（尺寸/alpha）、`node scripts/build.mjs` 报错、改登录/套餐/购买/连接页、`web-contract` 或 `web-smoke` 红了、不知道怎么在 CI 出包、不确定 `app/web/` 里能改什么。DO NOT USE FOR: 改原生壳 `shells/` 或 bridge 契约（那是修改项目本身，要同步 `docs/BRIDGE.md` 并三端一起改）、改钉死的 `app.lock.json`（包名）、改闭源核心 `kit/`、部署 CRM（用 `white-label-crm`）。INVOKES: 读 `app/app.json`/`app/assets/`/`app/web/`、`node scripts/build.mjs --check`、`node scripts/check-web.mjs`、分支 + PR。
---

# 白标 App 定制（租户视角）

目标：**只改配置和页面，不碰原生代码，发布交给 GitHub Actions。**

## 0. 保证边界（先读这一条）

我们只保证**缺省状态**（只改 `app/app.json`、`app/assets/` 与我们指定的页面文件）下的构建与发布正确性。
你当然可以改任何代码（MIT 开源），但一旦改了 `shells/`、`scripts/`，
构建与发布就由你自己负责，上游更新时也可能冲突。

**fork 成 public 还是 private 由你决定**（只影响 Actions 分钟数计费：public 免费，
private 消耗你的配额；macOS runner 计费倍率 ×10）。

> ⚠️ **但有一个例外**：fork 成 private 且用**免费账户** ⇒ **分支保护不可用**（需 Pro/Team）。
> 那样下面的门禁只能显示红叉，拦不住合并。想“零成本 + 门禁生效”，就保持 public。

### 0.1 fork 之后第一件事：把门禁打开

**fork 不继承分支保护设置。** 不做这一步，`validate` / `web-contract` 红了也能合并。

1. `Settings → Rules → Rulesets → New branch ruleset`
2. Name 填 `protect-main`，Enforcement 选 **Active**，Target 选 **Include default branch**
3. 勾 **Require status checks to pass** → 添加 `validate`、`web-contract`、`web-smoke`、`path-whitelist`
4. 勾 **Block force pushes** → Create

> 检查名要**先跑过一次**才会出现在搜索框里；搜不到就先提一个 PR。
> 以后改了 job 名称，要同步更新 required 列表，否则 PR 永远卡在
> `Expected — Waiting for status to be reported`。

## 1. 你不需要向平台索取任何配置

**一个配置、两张图、十页界面 —— 其余都是机器的事。**

| 参数 | 在哪 | 谁来改 |
|---|---|---|
| cf-api 地址 | kit 内嵌 | —— |
| 闭源核心版本 | `shells/versions.json`（平台维护） | **你不要动** |
| `bundle_id` | `app.lock.json` | 机器生成（Studio 首次发布时，**bundle_id 必须你确认**）；上架后不可改 |

你只需要：① 自己的 CRM 地址与 `crm.id`（从 CRM 后台复制）② 应用名 / 副标题 / 颜色 / 链接
③ 一张图标（+ 可选单色标记）。

## 2. 改 `app/app.json`（租户信息）

```json
{
  "name": "星辰加速",
  "short_name": "星辰",
  "tagline": "一键连接，全球畅行。",
  "color": "#3b82f6",
  "icon": "assets/icon.png",
  "logo": "assets/logo.svg",
  "crm": { "base": "https://crm.example.com", "id": "8f3a1c2e-…" },
  "links": { "terms": "", "privacy": "", "support": "", "website": "" }
}
```

| 字段 | 必填 | 校验规则 |
|---|:--:|---|
| `name` | ✓ | 非空字符串（应用名 / 窗口标题 / 欢迎页） |
| `short_name` | ✓ | 非空字符串（桌面快捷方式、任务栏） |
| `tagline` | ✗ | 字符串、无换行；空 ⇒ 欢迎页不留空洞 |
| `color` | ✓ | `#rrggbb` |
| `icon` | ✗ | 默认 `assets/icon.png`；相对 `app/`，位于 `assets/` 或 `web/` |
| `logo` | ✗ | 界面标记，PNG/SVG、≤256KB；不填回落到 `icon` |
| `links.{terms,privacy,support,website}` | ✗ | `https://` 或留空 |
| `crm.base` | ✗ | `https://` 开头且无尾斜杠，或留空（留空 = 不提供登录/购买） |
| `crm.id` | ✗ | UUID，或留空（构建时拉 `/meta` 比对） |

**白名单**：`app/app.json` 不接受其它字段（`bundle_id`、`kit_version`、`brand_color` 都会直接构建失败）。

### 2.1 图标与界面标记

| | `app/assets/icon.png`（应用图标） | `app/assets/logo.svg`（界面标记） |
|---|---|---|
| 尺寸 | 1024×1024 | 任意正方形 viewBox |
| 格式 | PNG | SVG（单色矢量）或 PNG |
| alpha | **必须无**（App Store / Play 规则） | 可以有 |
| 大小 | ≤ 1 MB | ≤ 256 KB |
| 路径 | 默认 `assets/icon.png`（可用 `icon` 改，仍在 `assets/` 或 `web/` 下，相对 `app/`） | 用 `logo` 指过去 |

```bash
# macOS 自查（约 1 秒）
sips -g pixelWidth -g pixelHeight -g hasAlpha app/assets/icon.png
```

各平台尺寸（Android 自适应图标 / iOS / macOS / Windows `.ico` / 托盘 / 商店）**由 CI 生成**，
你不用准备。仓库自带的是**占位图**：本地构建只警告，正式出包会失败。
`logo` 用 SVG 时暗色自动反白；彩色 PNG 原样显示。

改完立刻校验：

```bash
node scripts/build.mjs --check
```

## 3. 改界面（可选，`app/web/`）

十页：`welcome / login / index / lines / plans / account / settings / split / region / redeem`，
共享 `app.css` + `ui.js`（品牌/主题/弹窗/toast）+ `api.js`（CRM）+ `bridge.js`（壳/mock）+ `icons.js`。

| 可以改 ✓ | 不要改 ✗ |
|---|---|
| 页面结构、文案、图片、图标 | `bridge` 的方法名/参数结构（见 `docs/BRIDGE.md`） |
| 新增页面、动画、组件 | 直接调用原生 API（UI 没有这个能力） |
| 请求 CRM 的**已定义端点**（`clients` 契约 17 个） | 自己发明端点/字段 |
| 8 个 CSS 变量（`app.css` 顶部） | 变量区外硬编码颜色（换品牌会失效） |

`app/web/index.html` **不允许引用外部 CDN 脚本/样式**（离线必须可用）。

### 改完 `app/web/` 必须过契约校验

```bash
node scripts/build.mjs --check     # app.json / icon / logo / app.lock.json
node scripts/check-web.mjs        # 14 条静态约束，退出码非 0 = 有违规
node --test                 # 闸门与构建脚本自检
npx playwright test               # 10 页 × 视口 × 主题 + 品牌替换 + 购买/兑换流程
```

CI 里是 `validate` / `web-contract` / `web-smoke` / `path-whitelist`。规则来自
`clever-vpn-docs` 的 `contracts/shared/app-studio-app.md` §4：

| 检查 ID | 规则 |
|---|---|
| `app.config` / `app.icon` / `app.logo` | 配置白名单与格式、图标 1024² 无 alpha、logo PNG/SVG |
| `web.limits` / `web.index` / `web.paths` | 1MB/8MB/200 文件/深度 3；必须 `index.html`；后缀白名单 |
| `assets.no-external` | 不得引用任何外部 URL 资源 |
| `bridge.methods` | 只用 `bridge@2` 的 13 个方法；不得直接碰 `chrome.webview` / `webkit.messageHandlers` / `Bridge.postMessage` |
| `bridge.state-on-load` | 加载后必须调一次 `state()`（事件不会重放） |
| `bridge.error-copy` / `bridge.frozen-neutral` | 5 个错误码都有文案；`FROZEN` 中性 |
| `brand.from-window-brand` / `brand.vars` | 品牌值只从 `window.BRAND` 读；`app.css` 定义 8 个变量 |
| `a11y.basic` | 每页有 `lang`、`viewport`、`img alt` |

本地预览（不需要真壳）：

```bash
node scripts/build.mjs          # 生成 app/web/_brand.js（不入库，必须先生成）
cd web && python3 -m http.server 8000
# http://localhost:8000/welcome.html
```

浏览器里 `bridge` 自动走 `app/web/bridge.js` 的最小 fallback；登录/购买需要真 CRM
（`crm.base` 指向你的实例，改完重新 build）。

## 4. 发布：只用 GitHub Actions

**不要**在本地 build 后手工上传作为正式发布。

1. 改完走分支 + PR（四个 required check 会拦）；
2. 合并后 → Actions → **release** → **Run workflow**：
   - `platform` 选 `web` / `android` / `apple` / `windows`，或 `all`；
     显式选了还没实现的平台会直接失败，只告诉你缺什么，**不会**建出没有资产的 release；
   - `tag` 留空 = 自动在上个 release 上 patch+1（首次 `v0.1.0`）；
   - 也可指定 `1.2.3` 或 `v1.2.3`（统一按 `v` 前缀发布）。
3. 产物：`clever-vpn-app-web-vX.Y.Z.zip`（`dist/web` + `manifest.json`）；原生包
   `apk`/`aab`、`dmg`、`msi` 由 `shells/<platform>/ci/build.*` 产出。

原生安装包由各端壳的 workflow 产出（Windows MSI / macOS 公证 DMG / Android apk+aab）。
需要的 Secrets 与壳的构建入口契约见 `docs/RELEASE.md`。

## 5. 常见失败

| 现象 | 原因 / 处理 |
|---|---|
| `app.json 不接受字段 "xxx"` | 把构建参数写进了 `app/app.json`：`bundle_id` 属于 `app.lock.json`，核心版本由平台维护 |
| `color 必须是 #rrggbb` | 主色要 6 位十六进制，不能写 `#3b82f6ff` 或 `rgb(...)` |
| `crm.base 必须是 https:// 开头且无尾斜杠` | 删掉尾部的 `/`；没有 CRM 就整段留空 |
| `crm.id 与 CRM 实例不一致` | `app/app.json` 的 `crm.id` 与 `GET {crm.base}/api/app/v1/meta` 的 `crm_id` 不同；到 CRM 后台「设置 → 实例 ID」复制正确的值 |
| `CRM 不可达（…/meta）` | 开发构建是警告，`RELEASE` 构建失败；检查 `crm.base` 拼写与实例是否在线 |
| `app.lock.json: bundle_id.x 必须是反向域名格式` | 用了 `NextVPN`、`com.acme`（只有两段）等；该文件手改无效，要让 Studio 重新生成 |
| `⚠ bundle_id 还是示例值` | 仍是 `com.example.*`，上架前必须改 |
| `icon 必须是 1024×1024` | 报错信息会给实际尺寸；重导一张方形图 |
| `icon 必须无透明通道` | 用 `sips -s format png` 导出前先去掉 alpha，或把背景铺满 |
| `logo 指向的文件不存在` | `logo` 是相对 `app/` 的路径（如 `assets/logo.svg`），不能写 `../` 或绝对路径 |
| `缺少 app/assets/icon.png`（正式出包时） | 占位图不允许上架，必须换自己的图标 |
| `app/web/index.html 引用了外部资源` | 删掉 CDN `<script src="https://…">` / `<link href="https://…">` |
| `bridge.xxx() 不在 bridge@2 白名单内` | 13 个方法见 `docs/BRIDGE.md`；自己封装的方法请改名 |
| `页面加载后必须调用一次 state()` | 页面脚本开头调 `bridge.state()`（见 `app/web/index.html`） |
| `缺少错误码文案` / `FROZEN 文案必须中性` | `app/web/ui.js` 的 `ERROR_COPY` 表，5 个 code 都要有 |
| `brand.vars`：变量区外出现 `#rrggbb` | 把颜色挪进 `app.css` 顶部的变量声明，页面里用 `var(...)` / `color-mix(...)` |
| `validate` 通过但页面没变色 | 用了硬编码颜色，没走 CSS 变量；或没重新 `build.mjs`（`_brand.js` 是生成物） |
| `path-whitelist` 红：越界 | `studio/design/*` 不得改 `crm.*`；`studio/config/*` 只能改 `app.json`；任何 PR 不得改 `scripts/`、`.github/`、`shells/` |

## 6. 交付核对

- [ ] `node scripts/build.mjs --check` 通过
- [ ] `node scripts/check-web.mjs` 通过
- [ ] `app/assets/icon.png` 是自己的 1024×1024 无 alpha 图（不是占位图）
- [ ] `bundle_id` 四端都是自己的反域名、非 `com.example.*`
- [ ] `links` 指向真实条款/隐私/客服页
- [ ] Actions `release` 成功，Release 里有 zip 资产
- [ ] 未修改 `shells/`、`scripts/`、`app.lock.json`（改了就要自己维护）
