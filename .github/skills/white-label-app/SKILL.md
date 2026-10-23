---
name: white-label-app
description: **WORKFLOW SKILL** — 把 clever-vpn-app 变成自有品牌应用并由 GitHub Actions 出包。USE FOR: 改应用名/图标/配色/包名、改登录/套餐/购买页、`brand.json` 校验失败、`node scripts/build.mjs` 报错、不知道怎么在 CI 出包、不确定 `web/` 里能改什么。DO NOT USE FOR: 改原生壳 `shell-*/` 或 bridge 契约（那是修改项目本身，要同步 `docs/BRIDGE.md` 并三端一起改）、改闭源核心 `kit/`、部署 CRM（用 `white-label-crm`）。INVOKES: 读 `brand.json`/`web/`、`node scripts/build.mjs --check`、分支 + PR。
---

# 白标 App 定制（租户视角）

目标：**只改配置和页面，不碰原生代码，发布交给 GitHub Actions。**

## 0. 保证边界（先读这一条）

我们只保证**缺省状态**（只改 `brand.json` 与我们指定的配置/页面文件）下的构建与发
布正确性。你当然可以改任何代码（AGPL 开源），但一旦改了 `shell-*/`、`kit/`、
`scripts/`，构建与发布就由你自己负责，上游更新时也可能冲突。

**fork 成 public 还是 private 由你决定**（只影响 Actions 分钟数计费：public 免费，
private 消耗你的配额；macOS runner 计费倍率 ×10）。

## 1. 先向服务方索取 3 个值

| 值 | 用途 | 备注 |
|---|---|---|
| `tenant_id` | `brand.json.tenant_id` | 平台分配，**UUID 格式，不要自己编** |
| `kit_version` | `brand.json.kit_version` | 闭源核心版本，当前未发布时为 `0.0.0` |
| `api_base` | `brand.json.api_base` | cf-api 基址，必须 `https://` |

将来 CRM 上线后还会有一个 `crm_base`（CRM 地址）；**契约落地前不要加进
`brand.json`**（校验会失败）。

## 2. 改 `brand.json`（唯一必改文件）

```bash
$EDITOR brand.json
```

| 字段 | 必填 | 校验规则 |
|---|:--:|---|
| `tenant_id` | ✓ | UUID（`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`） |
| `name` | ✓ | 非空字符串（应用名 / 窗口标题） |
| `short_name` | ✓ | 非空字符串（桌面快捷方式、任务栏） |
| `bundle_id.{android,ios,macos,windows}` | ✓ | 反向域名，如 `com.acme.vpn`；**禁止 `com.example.*`**；上架后不可改 |
| `brand_color` | ✓ | `#rrggbb` |
| `api_base` | ✓ | `https://` 开头 |
| `kit_version` | ✓ | 非空字符串 |
| `links.{terms,privacy,support}` | ✗ | 条款 / 隐私 / 客服链接 |

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
| `archive.limits` | 单文件 ≤ 1 MB、总量 ≤ 8 MB、≤ 200 文件、目录 ≤ 3 层 |

本地预览（不需要真壳）：

```bash
cd web && python3 -m http.server 8000
# http://localhost:8000/?dev=1   调试工具条（连接成功/过期/冻结/设备超限/迷你窗）
# http://localhost:8000/?mini=1  模拟桌面迷你窗 360×200
```

浏览器里 `bridge` 自动走 `createMock()`，行为与真壳一致。

## 4. 发布：只用 GitHub Actions

**不要**在本地 build 后手工上传作为正式发布。

1. 改完走分支 + PR（`validate` + `web-contract` 两个 job 会拦）；
2. 合并后 → Actions → **release** → **Run workflow**：
   - `tag` 留空 = 自动在上个 release 上 patch+1（首次 `v0.1.0`）；
   - 也可指定 `1.2.3` 或 `v1.2.3`（统一按 `v` 前缀发布）。
3. 产物：`clever-vpn-app-web-vX.Y.Z.zip`（`dist/web` + `manifest.json`）。

原生安装包（`exe` / `dmg` / `apk` / `aab`）将来由 `shell-*/` 的 CI job 产出，
**目前还没有**（壳未实现）——届时本文会给出新的 workflow 与需要的 Secrets。

## 5. 常见失败

| 现象 | 原因 / 处理 |
|---|---|
| `tenant_id 必须是 UUID` | 填了自编值或少了段，向服务方确认 |
| `bundle_id.x 必须是反向域名格式` | 用了 `NextVPN`、`com.acme`（只有两段）等 |
| `⚠ bundle_id 还是示例值` | 仍是 `com.example.*`，上架前必须改 |
| `web/index.html 引用了外部资源` | 删掉 CDN `<script src="https://…">` / `<link href="https://…">` |
| `bridge.xxx() 不在 bridge@1 白名单内` | 只允许 `connect` / `disconnect` / `state` / `on`；自己封装的方法请改名 |
| `页面加载后必须调用一次 state()` | 在 `<script>` 末尾加 `BRIDGE.state().then(render)` |
| `缺少错误码文案` / `FROZEN 文案必须中性` | 建一张 `ERROR_COPY` 表，5 个 code 都要有 |
| `validate` 通过但页面没变色 | 用了硬编码颜色，没走 CSS 变量；或没重新 `build.mjs`（`_brand.js` 是生成物） |

## 6. 交付核对

- [ ] `node scripts/build.mjs --check` 通过
- [ ] `node scripts/check-web.mjs` 通过（CI 的 `web-contract` job）
- [ ] `bundle_id` 四端都是自己的反域名、非 `com.example.*`
- [ ] `links` 指向真实条款/隐私/客服页
- [ ] Actions `release` 成功，Release 里有 zip 资产
- [ ] 未修改 `shell-*/`、`kit/`、`scripts/`（改了就要自己维护）
