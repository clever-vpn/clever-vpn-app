---
name: white-label-app
description: **WORKFLOW SKILL** — 把 clever-vpn-app 变成自有品牌应用并由 GitHub Actions 出包。USE FOR: 改应用名/图标/配色、`app.json` 校验失败、图标被拒（尺寸/alpha）、`node scripts/build.mjs` 报错、改登录/套餐/购买页、不知道怎么在 CI 出包、不确定 `web/` 里能改什么。DO NOT USE FOR: 改原生壳 `shell-*/` 或 bridge 契约（那是修改项目本身，要同步 `docs/BRIDGE.md` 并三端一起改）、改钉死的 `app.lock.json`（包名）、改闭源核心 `kit/`、部署 CRM（用 `white-label-crm`）。INVOKES: 读 `app.json`/`assets/icon.png`/`web/`、`node scripts/build.mjs --check`、分支 + PR。
---

# 白标 App 定制（租户视角）

目标：**只改配置和页面，不碰原生代码，发布交给 GitHub Actions。**

## 0. 保证边界（先读这一条）

我们只保证**缺省状态**（只改 `app.json`、`assets/icon.png` 与我们指定的配置/页面文件）下的构建与发
布正确性。你当然可以改任何代码（AGPL 开源），但一旦改了 `shell-*/`、`kit/`、
`scripts/`，构建与发布就由你自己负责，上游更新时也可能冲突。

**fork 成 public 还是 private 由你决定**（只影响 Actions 分钟数计费：public 免费，
private 消耗你的配额；macOS runner 计费倍率 ×10）。

> ⚠️ **但有一个例外**：fork 成 private 且用**免费账户** ⇒ **分支保护不可用**（需 Pro/Team）。
> 那样下面的门禁只能显示红叉，拦不住合并。想“零成本 + 门禁生效”，就保持 public。

### 0.1 fork 之后第一件事：把门禁打开

**fork 不继承分支保护设置。** 不做这一步，`validate` / `web-contract` 红了也能合并。

1. `Settings → Rules → Rulesets → New branch ruleset`
2. Name 填 `protect-main`，Enforcement 选 **Active**，Target 选 **Include default branch**
3. 勾 **Require status checks to pass** → 添加 `validate`、`web-contract` 与 `web-smoke`
4. 勾 **Block force pushes** → Create

> 检查名要**先跑过一次**才会出现在搜索框里；搜不到就先提一个 PR。
> 以后改了 job 名称，要同步更新 required 列表，否则 PR 永远卡在
> `Expected — Waiting for status to be reported`。

## 1. 你不需要向平台索取任何配置

**一个配置、一张图、一个页面 —— 其余都是机器的事。**

| 参数 | 在哪 | 谁来改 |
|---|---|---|
| cf-api 地址 | kit 内嵌 | —— |
| 闭源核心版本 | `kit/kit.version` | **平台发布时更新，你不要动** |
| `bundle_id` | `app.lock.json` | 机器生成（Studio 接入时）；上架后不可改 |

你只需要：① 自己的 CRM 地址与 `crm.id`（从 CRM 后台复制）② 应用名 / 颜色 / 链接 ③ 一张图标。

> `crm.base` / `crm.id` 契约已定但**尚未实现**（⬜）：现在写入会通过校验，但 App 还不会用它登录/购买。

## 2. 改 `app.json`（租户信息）

```bash
$EDITOR app.json
```

```json
{
  "name": "星辰加速",
  "short_name": "星辰",
  "color": "#3b82f6",
  "crm": { "base": "https://crm.example.com", "id": "8f3a1c2e-…" },
  "links": { "terms": "", "privacy": "", "support": "" }
}
```

| 字段 | 必填 | 校验规则 |
|---|:--:|---|
| `name` | ✓ | 非空字符串（应用名 / 窗口标题） |
| `short_name` | ✓ | 非空字符串（桌面快捷方式、任务栏） |
| `color` | ✓ | `#rrggbb` |
| `links.{terms,privacy,support}` | ✗ | `https://` 或留空 |
| `crm.base` | ✗ | `https://` 开头且无尾斜杠，或留空 ⬜ |
| `crm.id` | ✗ | UUID，或留空 ⬜ |

**白名单**：`app.json` 不接受其它字段（`bundle_id`、`kit_version`、`brand_color` 都会直接构建失败）。

### 2.1 换图标 `assets/icon.png`

| 项 | 规定 | 失败后果 |
|---|---|---|
| 尺寸 | 1024×1024 | 构建报错并给出实际尺寸 |
| 格式 | PNG | 报错 |
| 透明通道 | **必须无 alpha**（RGB） | 报错；带 alpha 的图过了构建也会被 App Store 拒 |
| 大小 | ≤ 1 MB | 报错 |
| 路径 | 固定 `assets/icon.png` | 不要改路径，换文件就行 |

```bash
# macOS 自查（约 1 秒）
sips -g pixelWidth -g pixelHeight -g hasAlpha assets/icon.png
```

各平台尺寸（Android 自适应图标 / iOS / macOS / Windows `.ico` / 托盘 / 商店）**由 CI 生成**，
你不用准备。仓库自带的是**占位图**：本地构建只警告，正式出包会失败。

改完立刻校验：

```bash
node scripts/build.mjs --check
```

## 3. 改界面（可选，`web/`）

| 可以改 ✓ | 不要改 ✗ |
|---|---|
| 页面结构、文案、图片、图标 | `bridge` 的方法名/参数结构（见 `docs/BRIDGE.md`） |
| 新增页面、路由、动画 | 直接调用原生 API（UI 没有这个能力） |
| 请求你自己的后端（登录、套餐、支付） | 把密钥/支付私钥写进前端 |
| CSS 设计 token（`--bg` `--surface` `--brand` `--text` `--dim` `--ok` `--warn` `--bad` `--radius` `--gap` `--font`） | 硬编码颜色（换品牌会失效） |

`web/index.html` **不允许引用外部 CDN 脚本/样式**（离线必须可用，`validate` 会拦）。

### 改完 `web/` 必须过契约校验

```bash
node scripts/check-web.mjs        # 退出码非 0 = 有违规，逐条给出 file:line
```

CI 里是 `web-contract` job。规则来自 `clever-vpn-docs` 的 `docs/contracts/studio-app.md`：

| 检查 ID | 规则 |
|---|---|
| `bridge.methods` | 只用 `connect` / `disconnect` / `state` / `on`；不得直接碰 `chrome.webview` / `webkit.messageHandlers` / `Bridge.postMessage` |
| `bridge.state-on-load` | 加载后必须调一次 `state()`（事件不会重放） |
| `bridge.error-copy` | `EXPIRED` / `FROZEN` / `DEVICE_LIMIT` / `NETWORK` / `INTERNAL` 都要有文案 |
| `bridge.frozen-neutral` | `FROZEN` 必须中性文案（不得对用户定性） |
| `brand.from-window-brand` | 品牌值只允许出现在 `index.html` 的兜底默认值里 |
| `assets.no-external` | 不得引用任何外部 URL 资源 |
| `web.limits` | 单文件 ≤ 1 MB、总量 ≤ 8 MB、≤ 200 文件、目录 ≤ 3 层 |

还有一个**行为冒烟** job `web-smoke`：假壳 + 真实 Chromium，跑连接/断开、5 个错误码文案、
三档视口截图、console 无 error。本地跑：`npm ci && npx playwright install chromium && npx playwright test`
（只有测试用 Playwright，`scripts/*.mjs` 仍零依赖）。

本地预览（不需要真壳）：

```bash
cd web && python3 -m http.server 8000
# http://localhost:8000/?dev=1   调试工具条（连接成功/过期/冻结/设备超限/迷你窗）
# http://localhost:8000/?mini=1  模拟桌面迷你窗 360×200
```

浏览器里 `bridge` 自动走 `createMock()`，行为与真壳一致。

## 4. 发布：只用 GitHub Actions

**不要**在本地 build 后手工上传作为正式发布。

1. 改完走分支 + PR（`validate` + `web-contract` + `web-smoke` 三个 required check 会拦）；
2. 合并后 → Actions → **release** → **Run workflow**：
   - `platform` 选 `web` / `android` / `apple` / `windows`，或 `all`（构建所有已实现的平台）；
     显式选了还没实现的平台会直接失败，只告诉你缺什么，**不会**建出没有资产的 release；
   - `tag` 留空 = 自动在上个 release 上 patch+1（首次 `v0.1.0`）；
   - 也可指定 `1.2.3` 或 `v1.2.3`（统一按 `v` 前缀发布）。
3. 产物：`clever-vpn-app-web-vX.Y.Z.zip`（`dist/web` + `manifest.json`）；原生包
   `apk`/`aab`、`dmg`、`msix`/`exe` 由各端 `shell-*/ci/build.*` 产出。

原生安装包**目前还没有**（壳未实现、`kit/kit.version` 仍是 `0.0.0`）。
需要的 Secrets 与壳的构建入口契约见 `docs/RELEASE.md`。

## 5. 常见失败

| 现象 | 原因 / 处理 |
|---|---|
| `app.json 不接受字段 "xxx"` | 把构建参数写进了 `app.json`：`bundle_id` 属于 `app.lock.json`，`kit_version` 属于 `kit/kit.version` |
| `app.json: color 必须是 #rrggbb` | 主色要 6 位十六进制，不能写 `#3b82f6ff` 或 `rgb(...)` |
| `app.json: crm.base 必须是 https:// 开头且无尾斜杠` | 删掉尾部的 `/`；没有 CRM 就整段留空 |
| `app.lock.json: bundle_id.x 必须是反向域名格式` | 用了 `NextVPN`、`com.acme`（只有两段）等；该文件手改无效，要让 Studio 重新生成 |
| `⚠ bundle_id 还是示例值` | 仍是 `com.example.*`，上架前必须改 |
| `assets/icon.png 必须是 1024×1024` | 报错信息会给实际尺寸；重导一张方形图 |
| `assets/icon.png 必须无透明通道` | 用 `sips -s format png` 导出前先去掉 alpha，或把背景铺满 |
| `缺少 assets/icon.png`（正式出包时） | 占位图不允许上架，必须换自己的图标 |
| `web/index.html 引用了外部资源` | 删掉 CDN `<script src="https://…">` / `<link href="https://…">` |
| `bridge.xxx() 不在 bridge@1 白名单内` | 只允许 `connect` / `disconnect` / `state` / `on`；自己封装的方法请改名 |
| `页面加载后必须调用一次 state()` | 在 `<script>` 末尾加 `BRIDGE.state().then(render)` |
| `缺少错误码文案` / `FROZEN 文案必须中性` | 建一张 `ERROR_COPY` 表，5 个 code 都要有 |
| `validate` 通过但页面没变色 | 用了硬编码颜色，没走 CSS 变量；或没重新 `build.mjs`（`_brand.js` 是生成物） |

## 6. 交付核对

- [ ] `node scripts/build.mjs --check` 通过
- [ ] `node scripts/check-web.mjs` 通过（CI 的 `web-contract` job）
- [ ] `assets/icon.png` 是自己的 1024×1024 无 alpha 图（不是占位图）
- [ ] `bundle_id` 四端都是自己的反域名、非 `com.example.*`
- [ ] `links` 指向真实条款/隐私/客服页
- [ ] Actions `release` 成功，Release 里有 zip 资产
- [ ] 未修改 `shell-*/`、`kit/`、`scripts/`、`app.lock.json`（改了就要自己维护）
