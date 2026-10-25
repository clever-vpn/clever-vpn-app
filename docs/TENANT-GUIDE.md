# 租户改造指南

目标：**只改配置和页面，不碰原生代码。**

> 🤖 **用 agent 自动实施**：本仓库内置 skill `.github/skills/white-label-app/SKILL.md`。
> 在 fork 里直接对 Copilot 说「按 white-label-app skill 改品牌」，它会按步骤改
> `app.json` / `assets/icon.png` / `web/` 并跑 `node scripts/build.mjs --check` 验收。
>
> **保证边界**：我们只保证缺省配置（只改 `app.json`、`assets/icon.png` 与本文允许的文件）下的构建与
> 发布正确；改 `shell-*/`、`kit/`、`scripts/` 就要自己维护。
> **发布只走 GitHub Actions**，不要在本地 build 后手工上传当正式发布。

## 零、fork 之后第一件事：把门禁打开

> **GitHub 的 fork 不继承任何分支保护设置。** 你 fork 出来的仓库，`main` 默认是完全
> 无保护的：CI 红了照样能合并，甚至能直接 `git push origin main`。

三步打开（约 1 分钟）：

1. 仓库页 → **Settings** → **Rules** → **Rulesets** → **New branch ruleset**
2. Name 填 `protect-main`，Enforcement 选 **Active**，Target 选 **Include default branch**
3. 勾下面两项后 **Create**：
   - **Require status checks to pass** → 搜索并添加 `validate`、`web-contract` 与 `web-smoke`
   - **Block force pushes**

说明：

- 两个检查名要**先跑过一次**才会出现在搜索框里；搜不到就先提一个 PR 让它跑一遍。
- 建议同时勾 **Require a pull request before merging**，并把 `Required approvals` 填 `0`：
  它能拦住"直接 push 到 main"，又因为不要求人工批准，不会卡住你自己。
- 以后若改了 job 名称，记得同步更新这里的 required 列表，否则 PR 会一直卡在
  `Expected — Waiting for status to be reported`，永远合不了。

### 0.1 public 还是 private？这次有实质差别

| fork 可见性 | 分支保护 | Actions 分钟数 | 建议 |
|---|---|---|---|
| **public** | ✅ 免费可用 | **不限** | 推荐，零成本就能有门禁 |
| private + Pro/Team | ✅ 可用 | 计入自己的配额 | 想保守时选 |
| private + 免费账户 | ❌ **不可用** | 2000 分钟/月 | 慎选：门禁降级为"提示" |

> 换句话说：**private 免费账户下，下面的 CI 只能给你看红色，拦不住你合并。**

## 一、三步上线

```bash
# 1. 改配置（10 分钟）
vi app.json

# 2. 换图标
cp ~/my-icon.png assets/icon.png      # 1024×1024、无透明、≤ 1MB

# 3. 改界面（可选）
vi web/index.html
```

改完提交 → CI 跑完三道门禁 → 合并 → 出包。**不需要安装 Xcode / Visual Studio / Android Studio。**

> 一句话记住：**一个配置、一张图、一个页面 —— 其余都是机器的事。**

## 二、你只需要改 `app.json`

`app.json` 是你的**基本信息**：让界面能看出这是谁家的 App，并让注册/购买导向你的 CRM。
**App 侧不需要向平台索取任何值。**

```json
{
  "name": "星辰加速",
  "short_name": "星辰",
  "color": "#3b82f6",
  "crm": { "base": "https://crm.example.com", "id": "8f3a1c2e-…" },
  "links": { "terms": "", "privacy": "", "support": "" }
}
```

| 字段 | 必填 | 说明 |
|---|:--:|---|
| `name` | ✓ | 应用显示名（App 名称 / 窗口标题）|
| `short_name` | ✓ | 桌面快捷方式、任务栏用 |
| `color` | ✓ | 主色，`#rrggbb` |
| `links.{terms,privacy,support}` | ✗ | 条款 / 隐私 / 客服链接 |
| `crm.base` | ✗ | 你的 CRM 地址（`https://`，无尾斜杠）；**留空 = 不提供登录/购买入口** ⬜ 待实现 |
| `crm.id` | ✗ | 从 CRM 后台复制的实例标识（UUID），用于出包前校验地址对不对 ⬜ 待实现 |

> 字段语义以 `clever-vpn-docs` 的 `docs/contracts/app-json.md` 为准；本表只是操作索引。
> **白名单**：`app.json` 不接受上表之外的任何字段，写错会直接构建失败。

### 不在 `app.json` 里的东西

| 参数 | 在哪 | 谁来改 |
|---|---|---|
| `bundle_id.{android,ios,macos,windows}` | `app.lock.json` | 机器生成（Studio 接入时）；**上架后不可改** |
| 闭源核心版本 | `kit/kit.version` | **平台发布时更新，你不要动** |
| cf-api 地址 | kit 内嵌 | —— |
| 图标路径 | 固定 `assets/icon.png` | 不要改路径，换文件就行 |

### 2.1 图标

| 项 | 规定 |
|---|---|
| 路径 | 固定 `assets/icon.png` |
| 规格 | 1024×1024、PNG、**无透明通道**、≤ 1 MB |
| 为什么不能透明 | App Store 会直接拒包；Android 自适应图标前景也会被裁 |
| 各平台尺寸 | **CI 自动生成**，你只需要这一张图 |

仓库自带的 `assets/icon.png` 是占位图：本地构建只警告，**正式出包会失败**。

## 三、`web/` 里可以改什么

| 可以改 ✓ | 不要改 ✗ |
|---|---|
| 页面结构、文案、图片、图标 | `bridge` 的方法名与参数结构 |
| 新增页面、路由、动画 | 直接调用原生 API（没有这个能力）|
| 请求你自己的后端（登录、套餐、支付）| 把密钥、支付私钥写进前端代码 |
| 8 个 CSS 变量（配色、圆角、间距）| 硬编码颜色（会导致换品牌失效）|

### 3.1 提交前先自己跑一遍（CI 会拦）

```bash
node scripts/check-web.mjs        # 逐条打印，退出码非 0 = 有违规
```

CI 的 `validate` 与 `web-contract` 两个 job 必须全绿才能合并。规则来自
`clever-vpn-docs` 仓库的 `docs/contracts/studio-app.md`，要点：

| 检查 ID | 规则 |
|---|---|
| `bridge.methods` | 只允许 `connect` / `disconnect` / `state` / `on`；不得直接碰各端原生注入点 |
| `bridge.state-on-load` | 页面加载后必须调一次 `state()`（事件不会重放） |
| `bridge.error-copy` | `EXPIRED` / `FROZEN` / `DEVICE_LIMIT` / `NETWORK` / `INTERNAL` 都要有文案 |
| `bridge.frozen-neutral` | `FROZEN` 必须是中性文案（不得对用户做定性） |
| `brand.from-window-brand` | 品牌值只允许出现在 `index.html` 的兜底默认值里 |
| `assets.no-external` | 不得引用任何外部 URL 资源（CDN / 字体 / 图片 / import） |
| `web.limits` | 单文件 ≤ 1 MB、总量 ≤ 8 MB、≤ 200 个文件、目录深度 ≤ 3 |

> 静态检查只拦「一眼能看出的错」。能不能真的跑起来（加载、点击流、console 是否干净）
> 由 `web-smoke` job 判定：它用**假壳 + 真实 Chromium** 跑一遍（连接/断开、5 个错误码、
> 三档视口截图），失败时去 Actions 下载 `web-smoke-report` 看截图。
>
> 本地想跑同一个测试：`npm ci && npx playwright install chromium && npx playwright test`
> （只有测试用 Playwright；`scripts/*.mjs` 仍然零依赖，不装也能构建与校验）。

## 四、本地开发（不需要真壳）

```bash
cd web && python3 -m http.server 8000
# 打开 http://localhost:8000/?dev=1
```

`?dev=1` 会显示调试按钮：连接成功 / 已过期 / 已冻结 / 设备超限 / 迷你模式 / 换品牌色。
`?mini=1` 模拟桌面迷你窗（360×200）。

`bridge` 在浏览器里自动使用 `createMock()`，行为与真壳一致。

## 五、不要做的事

| ✗ | 原因 |
|---|---|
| 在 UI 里判断"能不能连" | 授权在服务端；UI 判断只会出错 |
| 把服务端返回的状态缓存并长期信任 | 以 `state()` 为准，UI 只是呈现 |
| 修改 `bridge` 契约 | 会破坏其它租户的模板兼容性 |
| 在 `web/` 引用外部 CDN 脚本 | `validate` 会拦下（离线环境必须可用）|

## 六、构建产物

```
dist/
├── web/            UI（含注入的 _brand.js）
└── manifest.json   品牌 / 版本 / kit 版本 / 构建时间
```

平台安装包由 `shell-*/` 的构建产出（Windows `msix`/`exe`、macOS `dmg`、Android `apk`），
**由 GitHub Actions 生成并在 Release 里提供下载**：Actions → `release` → Run workflow，
`platform` 选 `android` / `apple` / `windows`（`all` = 所有已实现的平台）。
壳落地前选这三项会**直接失败并告诉你缺什么**（不会建出没有资产的 release），
现阶段只有 `web` 能出包。细节见 [`RELEASE.md`](RELEASE.md)。
