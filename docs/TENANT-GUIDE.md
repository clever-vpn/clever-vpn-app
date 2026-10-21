# 租户改造指南

目标：**只改配置和页面，不碰原生代码。**

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

平台安装包由 `shell-*/` 的构建产出（Windows `msix`/`exe`、macOS `dmg`、Android `apk`）。
