# 租户改造指南

> **用 App Studio 的租户不需要读本文。** Studio 会替你做这里的所有事（fork、提交、PR、
> 合并、构建、同步上游），你只在设计器里操作。
> 本文面向**自己维护仓库**的人（开源用户 / 没有接 studio 的部署）。

目标：**只改 `app/`，不碰原生代码。**

> 🤖 **用 agent 自动实施**：本仓库内置 skill `.github/skills/white-label-app/SKILL.md`。
> 在 fork 里直接对 Copilot 说「按 white-label-app skill 改品牌」，它会按步骤改
> `app/app.json` / `app/assets/` / `app/web/` 并跑 `node scripts/build.mjs --check` 验收。
>
> **保证边界**：我们只保证缺省配置（只改 `app/` 下本文允许的文件）下的构建与
> 发布正确；改 `shells/`、`scripts/` 就要自己维护。
> **发布只走 GitHub Actions**，不要在本地 build 后手工上传当正式发布。

## 零、拿到仓库之后第一件事：把门禁打开

> **GitHub 的 fork 不继承任何分支保护设置。** 你拿到的仓库，`main` 默认是完全
> 无保护的：CI 红了照样能合并，甚至能直接 `git push origin main`。
> （自动检查由 Studio 打开；**分支保护只能你自己设** —— GitHub 不允许我们改仓库设置。）

1. 仓库页 → **Settings** → **Rules** → **Rulesets** → **New branch ruleset**
2. Name 填 `protect-main`，Enforcement 选 **Active**，Target 选 **Include default branch**
3. 勾下面两项后 **Create**：
   - **Require status checks to pass** → 添加 `validate`、`web-contract`、`web-smoke`、`path-whitelist`
   - **Block force pushes**

说明：

- 检查名要**先跑过一次**才会出现在搜索框里；搜不到就先提一个 PR 让它跑一遍。
- 建议同时勾 **Require a pull request before merging**，`Required approvals` 填 `0`：
  它能拦住"直接 push 到 main"，又不会卡住你自己。
- 以后若改了 job 名称，记得同步这里的 required 列表，否则 PR 会一直卡在
  `Expected — Waiting for status to be reported`。

### 0.1 public 还是 private？这次有实质差别

| fork 可见性 | 分支保护 | Actions 分钟数 | 建议 |
|---|---|---|---|
| **public** | ✅ 免费可用 | **不限** | 推荐，零成本就能有门禁 |
| private + Pro/Team | ✅ 可用 | 计入自己的配额 | 想保守时选 |
| private + 免费账户 | ❌ **不可用** | 2000 分钟/月 | 慎选：门禁降级为"提示" |

### 0.2 绑定到 Studio（可选，但推荐）

不想手改 `app/web/` 的，把仓库绑定到设计器：

1. CRM 后台 → **应用** → 〔连接仓库〕→ 授权 GitHub App。
   **不用先自己 Fork**：Studio 会先找有没有本模板的 fork，有就复用，没有就替你建一个
   （建在你刚授权的账号下），并替你打开自动检查。
2. 回 CRM → **应用** → 〔打开设计器〕→ 进入 `/edit/<draft>`
3. 在设计器里改完 → **发布**：Studio 只负责开 PR（`studio/design|config|onboard/*`），
   合并在你自己的仓库里点

约束（Studio 的围栏，也是 `path-whitelist` job 判的）：

| 分支前缀 | 可以改 |
|---|---|
| `studio/design/*` | `app/web/**`、`app/assets/**`、`app/app.json`（**`crm.*` 不可改**） |
| `studio/config/*` | 仅 `app/app.json`（可以改 `crm.*`） |
| `studio/onboard/*` | 以上 + `app.lock.json`（首次接入） |
| 任何 PR | ❌ `shells/`、`scripts/`、`.github/`、`docs/` |

> Studio 会确保仓库存在（复用你的 fork，或建一个新的），发布在四道检查全绿后由它合并并打版本；
> 它**不会删除或转移**你的仓库，也不会碰 `shells/`、`scripts/`。仓库始终是你的。
> **人机校验（Turnstile）与 App 无关**：模板永远不加载第三方脚本。

## 一、三步上线

```bash
# 1. 改配置（10 分钟）
vi app/app.json

# 2. 换图标（可选换界面标记）
cp ~/my-icon.png app/assets/icon.png          # 1024×1024、无透明、≤ 1MB
cp ~/my-mark.svg app/assets/logo.svg          # 单色矢量，可选

# 3. 改界面（可选）
vi app/web/welcome.html
```

改完提交 → CI 四道门禁全绿 → 合并 → 出包。**不需要安装 Xcode / Visual Studio / Android Studio。**

> 一句话记住：**一个目录、一个配置、两张图、十页界面 —— 其余都是机器的事。**

## 二、你只需要改 `app/app.json`

`icon` / `logo` 是**相对 `app/`** 的路径（所以模板里一直写 `assets/…`，不用带 `app/` 前缀）。

```json
{
  "name": "星辰加速",
  "short_name": "星辰",
  "tagline": "一键连接，全球畅行。",
  "color": "#3b82f6",
  "icon": "assets/icon.png",
  "logo": "assets/logo.svg",
  "crm": { "base": "https://crm.example.com", "id": "8f3a1c2e-…" },
  "links": {
    "terms": "https://example.com/terms",
    "privacy": "https://example.com/privacy",
    "support": "https://t.me/your_support",
    "website": "https://example.com"
  }
}
```

| 字段 | 必填 | 说明 |
|---|:--:|---|
| `name` | ✓ | 应用显示名（App 名称 / 窗口标题 / 欢迎页主标题）|
| `short_name` | ✓ | 桌面快捷方式、任务栏 |
| `tagline` | ✗ | 欢迎页副标题；空 ⇒ 不留空洞 |
| `color` | ✓ | 主色 `#rrggbb`；界面只通过 CSS 变量消费 |
| `icon` | ✗ | 默认 `assets/icon.png`；可指向 `assets/` 或 `web/` 下的 PNG（相对 `app/`） |
| `logo` | ✗ | 界面里的品牌标记（PNG/SVG）；不填回落到 `icon` |
| `crm.base` | ✗ | 你的 CRM 地址（`https://`，无尾斜杠）；**留空 = 不提供登录/购买入口** |
| `crm.id` | ✗ | CRM 后台的实例 ID（UUID）；构建时拉 `/meta` 比对，防止用户在你的 App 里登进别人的 CRM |
| `links.terms` / `.privacy` | ✗ | 条款 / 隐私；**上架任何商店都要求隐私政策** |
| `links.support` | ✗ | 客服入口（本地可得，登录不进去时也能用）；空 ⇒ 欢迎页 `?` 不出现 |
| `links.website` | ✗ | 官网；欢迎页页脚显示域名（纯文本） |

> 字段语义以 `clever-vpn-docs` 的 `contracts/shared/app-json.md` 为准；本表只是操作索引。
> **白名单**：`app.json` 不接受上表之外的任何字段，写错会直接构建失败。

### 不在 `app.json` 里的东西

| 参数 | 在哪 | 谁来改 |
|---|---|---|
| `bundle_id.{android,ios,macos,windows}` | `app.lock.json` | 机器生成（Studio 首次发布时，**bundle_id 必须你确认**）；上架后不可改 |
| 闭源核心版本 | 平台维护（不在你改的文件里） | **你不要动** |
| cf-api 地址 | kit 内嵌 | —— |
| bridge 版本 | `scripts/lib/web-check.mjs`（闸门） | 平台维护，不要动 |

### 2.1 图标与界面标记

| | `app/assets/icon.png`（应用图标） | `app/assets/logo.svg`（界面标记） |
|---|---|---|
| 用在哪 | 桌面 / 启动器 / 商店 | 欢迎页、登录页、顶栏 |
| 规格 | 1024×1024、PNG、**无透明通道**、≤ 1MB | 单色矢量（SVG），≤ 256KB |
| 为什么 | App Store 拒绝带 alpha 的图标；Play 自适应图标前景会被裁 | 单色才能跟着主题染色；暗色下自动反白 |
| 各平台尺寸 | **CI 自动生成**，你只需要这一张 | 不需要多尺寸 |

仓库自带的 `app/assets/icon.png` 是占位图：本地构建只警告，**正式出包会失败**。
`logo` 不填就回落到 `icon`（只准备一张 PNG 也能跑）；彩色 PNG 也可以当 logo，但暗色下不会被反白。

## 三、`app/web/` 里可以改什么

| 可以改 ✓ | 不要改 ✗ |
|---|---|
| 页面结构、文案、图片、图标 | `bridge` 的方法名与参数结构 |
| 新增页面、动画、组件 | 直接调用原生 API（没有这个能力）|
| 请求你自己的后端的**已定义端点** | 自己发明端点/字段（`clients` 契约只加不改）|
| 8 个 CSS 变量（`app.css` 顶部）| 变量区外硬编码颜色（换品牌会失效）|

### 3.1 提交前先自己跑一遍（CI 会拦）

```bash
node scripts/build.mjs --check     # app.json / 图标 / logo / app.lock.json
node scripts/check-web.mjs         # 14 条静态约束，逐条打印
node --test "test/*.test.mjs"      # 闸门与构建脚本自检
npx playwright test                # 10 页点击流 + 三档视口 × 深浅主题截图
```

CI 的 `validate` / `web-contract` / `web-smoke` / `path-whitelist` 必须全绿。规则来自
`clever-vpn-docs` 的 `contracts/shared/app-studio-app.md` §4：

| 检查 ID | 规则 |
|---|---|
| `app.config` | `app.json` 字段白名单、必填、`color #rrggbb`、`crm.*` 格式 |
| `app.icon` | 图标 1024² PNG、无 alpha、≤1MB |
| `app.logo` | logo 存在、PNG/SVG、≤256KB；PNG 正方形 |
| `web.limits` | 单文件 ≤1MB、总量 ≤8MB、≤200 文件、深度 ≤3、无 `.DS_Store` |
| `web.index` | `web/index.html` 存在 |
| `web.paths` | 相对路径、无 `..`、后缀在白名单 |
| `assets.no-external` | 不得引用任何外部 URL（CDN / 字体 / 图片 / import） |
| `bridge.methods` | 只调用 `bridge@3` 的 14 个方法；不得直接碰原生注入点 |
| `bridge.state-on-load` | 加载后必须调一次 `state()`（事件不会重放） |
| `bridge.error-copy` | 5 个错误码都有用户可见文案 |
| `bridge.frozen-neutral` | `FROZEN` 必须中性（不得出现违规/封禁） |
| `brand.from-window-brand` | 品牌值只从 `window.BRAND` 读 |
| `brand.vars` | `app.css` 定义 8 个品牌变量，变量区外无 `#rrggbb` |
| `a11y.basic` | 每页有 `lang`、`viewport`、`img alt` |

> 静态检查只拦「一眼能看出的错」。点击流、console、三档视口截图由 `web-smoke` 判定；
> 失败时去 Actions 下载 `web-smoke-report`（截图在 `test-results/`）。

## 四、本地开发（不需要真壳）

```bash
node scripts/build.mjs          # 生成 app/web/_brand.js（不入库，必须先生成）
cd app/web && python3 -m http.server 8000
# 打开 http://localhost:8000/welcome.html
```

- 浏览器里没有壳 ⇒ `app/web/bridge.js` 自动启用**最小 fallback**（线路、连接状态、协议、分流都可用）。
- 想看「过期 / 冻结 / 慢网 / 断网 / 空线路」这些边缘态，注入仓库里的模拟壳
  `shells/mock/bridge.js`（Studio 预览与 `web-smoke` 用的就是它）。
- 登录/购买需要真 CRM：把 `app/app.json` 的 `crm.base` 指向你的实例，再跑一次
  `node scripts/build.mjs`（`window.BRAND` 是构建期常量，改完必须重建）。
- 测试用模拟壳 + 假 CRM（`test/harness.mjs`）；`scripts/*.mjs` 仍然零依赖。

## 五、不要做的事

| ✗ | 原因 |
|---|---|
| 在 UI 里判断"能不能连" | 授权在服务端；UI 判断只会出错 |
| 把服务端状态缓存并长期信任 | 以 `state()` 为准，UI 只是呈现 |
| 修改 `bridge` 契约 | 会破坏其它租户的模板兼容性 |
| 在 `app/web/` 引用外部 CDN 脚本 | `web-contract` 会拦下（离线必须可用） |
| 把 `code`（激活码）展示/写日志/拼进 URL | `clients` §5：它不是秘密，但永远不该被看见 |
| 自己拼套餐规格 / 算价 / 算可买性 | 卡片只渲染 `/plans` 给的 `specs/cta/buyable/reason` |

## 六、构建产物

```
dist/
├── web/            UI（含注入的 _brand.js 与 _brand-logo.<ext>）
├── icon.png        唯一的图标输入（各壳的 ci 从它生成平台图标）
└── manifest.json   品牌 / 版本 / CRM 地址 / bundle_id / 构建时间（壳读 base 与包名）
```

平台安装包由 `shells/` 的构建产出（Windows `msi`、macOS `dmg`、Android `apk`/`aab`），
**由 GitHub Actions 生成并在 Release 里提供下载**：Actions → `release` → Run workflow，
`platform` 选 `android` / `apple` / `windows`（`all` = 所有已实现的平台）。
壳落地前选这三项会**直接失败并告诉你缺什么**（不会建出没有资产的 release），
现阶段只有 `web` 能出包。细节见 [`RELEASE.md`](RELEASE.md)。

## 七、发布前清单（上架商店那一次）

- [ ] `links.privacy` 已填（Apple / Google 都要求）
- [ ] `links.terms` 已填（有自动续订内购时必须）
- [ ] `links.support` 已填（审核会点"需要帮助"）
- [ ] `app/assets/icon.png` 是最终图标（无 alpha、1024²）
- [ ] `app.lock.json` 的 `bundle_id` 是**你拥有的域名**，四端一致
- [ ] `crm.base` / `crm.id` 指向你的 CRM，且 `GET /meta` 能返回同一个 `crm_id`
- [ ] 跑一遍 `node scripts/build.mjs --check`（`RELEASE_TAG=v1.0.0 node scripts/build.mjs --check` 会按出包口径卡）
