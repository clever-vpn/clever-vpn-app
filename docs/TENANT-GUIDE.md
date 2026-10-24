# 租户改造指南

目标：**只改配置和页面，不碰原生代码。**

> 🤖 **用 agent 自动实施**：本仓库内置 skill `.github/skills/white-label-app/SKILL.md`。
> 在 fork 里直接对 Copilot 说「按 white-label-app skill 改品牌」，它会按步骤改
> `brand.json` / `web/` 并跑 `node scripts/build.mjs --check` 验收。
>
> **保证边界**：我们只保证缺省配置（只改 `brand.json` 与本文允许的文件）下的构建与
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
vi brand.json

# 2. 改界面（可选）
vi web/index.html

# 3. 出包
node scripts/build.mjs          # 产物在 dist/
```

或直接在 GitHub Actions 里跑 **Build / release** —— **不需要安装 Xcode / Visual Studio / Android Studio**。

## 二、`brand.json` 字段

| 字段 | 必填 | 说明 |
|---|:--:|---|
| `tenant_id` | ✓ | 平台分配给你的租户 ID（UUID），**不要自己编** |
| `name` | ✓ | 应用显示名（App 名称 / 窗口标题）|
| `short_name` | ✓ | 桌面快捷方式、任务栏用 |
| `bundle_id` | ✓ | 四个平台各自的包名，反向域名格式，**上架后不可更改** |
| `brand_color` | ✓ | 主色，`#rrggbb` |
| `api_base` | ✓ | 你的后端地址，必须 `https://` |
| `kit_version` | ✓ | 使用的闭源核心版本（由平台告知）|
| `links` | ✗ | 条款 / 隐私 / 客服链接 |

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
| `archive.limits` | 单文件 ≤ 1 MB、总量 ≤ 8 MB、≤ 200 个文件、目录深度 ≤ 3 |

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
**由 GitHub Actions 生成并在 Release 里提供下载**；壳尚未实现前，CI 只产上面这份
web 包。
