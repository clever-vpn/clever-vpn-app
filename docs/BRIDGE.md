# Bridge 契约 `bridge@2`

壳（原生）与 UI（`web/`）之间**唯一**的接口。UI 不直接接触核心库，核心也不认识 UI。

> 版本：`2`。任何破坏性变更必须升版本并保留旧版兼容，因为**租户的 UI 代码依赖它**。
> `2` 新增 `capabilities()`（**必选**）。目前还没有对外发布过壳，所以不保留 `1` 的兼容分支；
> `open()` 仍是**可选能力**（旧壳可能没有），UI 必须 feature-detect。

## 1. 方法（5 个，全部返回 Promise）

### `capabilities()`

壳的**静态能力清单**。UI 在启动时调一次，用来决定"钱在哪里付"这类**不可逆**的选择。

```js
await bridge.capabilities();
// → {
//   store: 'apple' | 'google' | null,   // 这个安装是从哪个商店来的
//   version: '2',                       // bridge 版本（与本文档对齐）
//   platform: 'ios' | 'macos' | 'android' | 'windows'
// }
```

- **`store` 是"这个 App 是怎么被装进来的"，不是操作系统**：
  | 平台 | 判定 | `store` |
  |---|---|---|
  | Android | `PackageManager.getInstallSourceInfo(pkg).installingPackageName == "com.android.vending"` | `google` |
  | Android | 其它（浏览器下载的 apk、adb、企业分发） | `null` |
  | iOS | StoreKit 2 `AppTransaction.shared` 成功（含 TestFlight 沙盒环境） | `apple` |
  | iOS | 失败/不可用（企业签名、越狱环境、模拟器） | `null` |
  | macOS | `AppTransaction.shared` 成功（App Store 版） | `apple` |
  | macOS | 失败/不可用（dmg 直接下载） | `null` |
  | Windows | 恒为 `null`（没有商店） | `null` |
- **UI 只读不猜**：`store` 为 `null` 就走网页收银台（`plans[].payment_methods`），
  非 `null` 就走商店内购（`plans[].store_product_id[store]`）。见 `app-crm.md` §2.4.0。
- **不得用其它信号替代**：`navigator.userAgent`、安装包文件名、`window.location`、
  CRM 里的标记都不算数。判错了在 iOS 上就是**审核拒稿**（反引导），在 Android 上就是
  **用户点不出去**。
- 调用失败时按 `store: null` 处理（宁可让侧载用户看到网页支付，也不要让商店用户看到外链）。
- 结果可缓存到进程结束：安装来源在运行期不会变。

### `connect(configJson)`

启动隧道。`configJson` 由 `web/` 自己从租户后端取得，壳**不解析业务含义**，原样交给核心。

```js
await bridge.connect({
  // 建议字段（具体以核心为准，壳透传）
  nodes: [ { host: '1.2.3.4', port: 443, key: '...', proto: 'vless' } ],
  dns: '1.1.1.1'
});
```

- 成功 ⇒ resolve；失败 ⇒ reject(`Error`)，并在 `state()` 里反映 `status:"error"`
- **重复调用**：若已连接，壳应先停止再启动，或直接 reject（需固定一种，本版采用「先停后启」）

### `disconnect()`

停止隧道。已断开时也应 resolve（幂等）。

### `state()`

返回状态快照。**页面每次加载/刷新后必须调用一次**（事件不会重放）。

```js
await bridge.state();
// → {
//   status: 'disconnected' | 'connecting' | 'connected' | 'error',
//   error: null | { code: 'EXPIRED'|'FROZEN'|'DEVICE_LIMIT'|'NETWORK'|'INTERNAL', message: string },
//   since: null | 1700000000000,     // 连上的时间戳（ms）
//   serverName: null | '香港 01',
//   bytesIn: 0, bytesOut: 0          // 可选，壳支持时才返回
// }
```

### `open(url)`【可选能力】

用**系统浏览器**打开一个外部页面：客服、官网、条款，以及购买时跳转的**第三方支付页**。

```js
if (typeof bridge.open === 'function') await bridge.open('https://example.com/help');
else location.href = 'https://example.com/help';   // 退化：交给壳的外链拦截（见 §5）
```

- 只接受 `https:`；其它 scheme（`javascript:` / `file:` / `data:` / `http:`）一律 reject(`{code:'INTERNAL'}`)
- **不改变 WebView 自身的 URL**：壳把 URL 交给系统打开，自己停在原地
- 壳不支持时该字段为 `undefined`（不要抛、不要占位）
- 没有业务含义，壳不解析、不缓存、不改写 URL

## 2. 事件（1 个）

```js
bridge.on('state', (snapshot) => { /* 与 state() 结构一致 */ });
```

- 壳在**任何状态变化**时推送（连接、断开、失败、重连）
- 回调**必须在主线程**（壳负责切线程）
- 事件是「通知」，不是「真相」；真相永远以 `state()` 为准

## 3. 错误码（UI 据此显示文案，不要自己判断业务）

| code | 含义 | UI 建议 |
|---|---|---|
| `EXPIRED` | 账号到期 | 明确提示 + 续费入口 |
| `FROZEN` | 被服务商冻结 | **中性文案**（不提违规）+ 客服入口 |
| `DEVICE_LIMIT` | 设备数超限 | 展示设备列表 + 移除 |
| `NETWORK` | 网络不可达 | 区分「你的网络」与「节点问题」 |
| `INTERNAL` | 其它 | 展示「重试」 |

> ⚠️ 授权判定在**服务端**。UI 里的任何状态显示都只是"呈现"，不可作为访问控制。

## 4. 各端实现方式

| 平台 | JS → 原生 | 原生 → JS |
|---|---|---|
| Windows（WebView2） | `window.chrome.webview.postMessage(obj)` | `CoreWebView2.PostWebMessageAsJson`（**切 UI 线程**）|
| macOS（WKWebView） | `window.webkit.messageHandlers.bridge.postMessage(obj)` | `evaluateJavaScript`（主线程）|
| Android（`androidx.webkit`） | `Bridge.postMessage(json)` | `JavaScriptReplyProxy.postMessage` |

### 外壳侧的封包格式（三端一致）

```jsonc
// 请求
{ "id": "17", "method": "connect", "args": { } }
// 响应
{ "id": "17", "ok": true,  "result": { } }
{ "id": "17", "ok": false, "error": { "code": "NETWORK", "message": "…" } }
// 事件
{ "event": "state", "payload": { "status": "connected", "since": 1700000000000 } }
```

- `id` 必须回显（WebView 的消息无序且异步）
- 只传 JSON 可序列化数据；不要传函数、二进制

## 5. 安全约束（壳侧强制）

原则：**内部 UI 只活在本地资源里，一切外部 URL 交给系统浏览器。**
要禁止的是「WebView 自己跑掉」，不是「打开外部页面」—— 客服、官网、支付全在外面。

| 必须 | 说明 |
|---|---|
| **方法白名单** | 仅 `connect` / `disconnect` / `state` / `open` / `capabilities` 五个字符串 |
| **内部导航锁** | WebView 只能加载内置资源目录。任何非内部 URL 的**页面导航**（`window.location` / 表单提交 / 重定向 / `window.open`）必须拦下来，改交系统浏览器打开，**不得在 WebView 内加载** |
| **外链只走系统浏览器** | `open(url)` 与拦下来的外链都用系统浏览器（或平台受信任的 in-app browser）打开。**地址栏可见** = 用户能自己判断这是不是钓鱼 |
| **只允许 https** | 拒绝 `javascript:` / `file:` / `data:` / `http:` 及未列出的 scheme |
| **禁止危险能力** | 不暴露 `readFile` / `exec` / 任意协议处理器 |

> **为什么不再要求域名白名单**：支付会跳到第三方（Stripe / 支付宝 / 微信），域名不可预知，也不可能静态写进 `app.json`。
> 白名单只能挡住「自己写错域名」，挡不住真正的攻击面（CRM 被接管后下发任意 URL）。
> 真正的防线是「外部页面一律在系统浏览器里、带地址栏打开」：WebView 永远只跑我们自己的 UI，
> 用户看到真实域名。

## 6. 包内资源：线路图标

`line.icon` / `line.iconKind` 只是**名字**；图形在 kit 里 —— 三端都把同一套 SVG 打进了包里
（Android `LineIcon`、Apple `LineIconResolver`、Windows `LineIconResolver`）。
页面通过**壳拦截的 URL scheme** 取图：

```
kit://line-icon/<kind>/<name>        kind = service | flag
```

| 条件 | 取哪个文件 |
|---|---|
| `kind=service` | `line_icons/services/<name>.svg`；缺失 → `default.svg` |
| 其它（含未给 kind） | `line_icons/countries/<两位国家码小写>.svg`；缺失 → 占位 |

壳的职责：

| 必须 | 说明 |
|---|---|
| Content-Type | `image/svg+xml` |
| 缓存 | `Cache-Control: public, max-age=31536000, immutable`（随包固定，不会变）|
| 着色 | 把 SVG 里的颜色统一换成中性色（浅色 `#8A94A6` / 深色 `#C7CDD8`）。`<img>` 里 `currentColor` 不生效，页面也不该给图标调色 |
| 未知名字 | 返回占位图，**不要 404**（否则列表里缺图标）|
| 注入 | 页面脚本执行前设好 `window.KIT_ICON_BASE = 'kit://line-icon'`；没有它 = 无壳环境，页面用自己的占位 |

**为何用 URL scheme 而不是 bridge 方法**：一屏几十条线路，逐条 RPC 会引入 pending 与闪烁；
`<img>` 天然有缓存、能被 CSS 控尺寸、离线可用。

页面侧：

```html
<span class="mono svc"><img src="kit://line-icon/service/ai" alt=""></span>
```

- 名字只能用 kit 里存在的：`ai` / `gaming` / `streaming` / `finance` / `social` / `general` …
- **页面不得自己画线路图标**：换一个 kit 版本，图标集就变了，页面一改就跟不上。

## 7. 参考实现

`web/index.html` 里有一个 `createMock()`，**就是参考实现**：在浏览器里模拟壳，行为与真壳一致（含 900 ms 连接耗时）。租户可直接在浏览器里开发 UI，无需真壳。
