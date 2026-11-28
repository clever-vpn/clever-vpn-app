# Bridge 契约 `bridge@3`

壳（原生）与 UI（`web/`）之间**唯一**的接口。UI 不直接接触核心库，核心也不认识 UI。

> 版本：`3`。**首版壳尚未发布 ⇒ 不保留 @1/@2 兼容**。一旦有壳发布，破坏性变更按
> “旧版至少保留一个 App 发布周期”处理。
>
> @3 在 @2 上新增 `crmRequest`：CRM 请求改由 shell → kit → libbox 完成（libbox 复用
> cf-api 的“优选 IP → A 记录 → 域名”拨号），WebView 不再直连 CRM。
>
> @1 的 `connect(configJson)` 已作废：它让页面自己攒节点，与
> `clever-vpn-docs` 的 `clients` 契约 §8「CRM 不得下发 server/line/wg」矛盾。
> @2 里线路是**壳的一等概念**，页面只说“选哪条线路”，不碰节点。

## 1. 方法与类型（14 个，全部返回 Promise）

```ts
interface Line {
  id: number;
  label: string;                 // 线路名（租户起的，名字本身就是承诺）
  factor: number;                // 流量系数（x2 = 按 2 倍计费）
  icon?: string | null;          // 国旗两位码 / 功能图标名
  iconKind?: string | null;      // 'flag' | 'service'
  isDefault?: boolean | null;
  hasRelay?: boolean;            // 有中继（排障用，不在选择列表里展示）
  hasUpstream?: boolean;         // 有下游代理（同上）
}

type Protocol = 'auto' | 'udpTunnel' | 'udpFast' | 'udpStable' | 'tcpFast' | 'tcpStable';

interface Split {
  region: { enable: boolean; code: string };
  ip: { enable: boolean; ip_cidr: string[] };
  domain: {
    enable: boolean;
    domain: string[];
    domain_suffix: string[];
    domain_regex: string[];
  };
}

interface State {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: null | { code: 'EXPIRED' | 'FROZEN' | 'DEVICE_LIMIT' | 'NETWORK' | 'INTERNAL'; message: string };
  since: number | null;
  line: null | { id: number; label: string };
  bytesIn: number;
  bytesOut: number;
  activated: boolean;            // 激活码是否已经交给壳（不等于“已订阅”）
}

type CrmMethod = 'GET' | 'POST';

interface CrmRequest {
  method: CrmMethod;
  path: string;                       // /plans、/orders?limit=20；壳自己拼 /api/app/v1
  headers?: { [k: string]: string };  // 只允许 authorization / accept / content-type
  body?: string;                      // JSON 文本
  timeoutMs?: number;                 // 13000..30000（必须覆盖 libbox 的拨号预算）
}

interface CrmResponse {
  status: number;                     // HTTP 状态原样（4xx/5xx 也是结果，不是传输错误）
  body: string;                       // 原始响应体
}

interface Bridge {
  capabilities(): Promise<{ bridge: '3'; platform: 'windows' | 'macos' | 'android' | 'ios'; store: 'apple' | 'google' | null }>;
  activate(key: string): Promise<void>;   // key = GET /subscription 的 code；**不得展示 / 记录 / 进 URL**
  deactivate(): Promise<void>;
  lines(opts?: { refresh?: boolean }): Promise<{ lines: Line[] }>;
  setLine(id: number): Promise<void>;
  connect(): Promise<void>;               // 无参数：线路由 setLine 决定，激活由 activate 决定
  disconnect(): Promise<void>;
  state(): Promise<State>;
  settings(): Promise<{ protocol: Protocol; split: Split; systemProxy?: boolean }>;
  setProtocol(p: Protocol): Promise<void>;
  setSplit(s: Split): Promise<void>;
  open?(url: string): Promise<void>;      // 可选能力；只收 https，交给系统浏览器
  crmRequest(req: CrmRequest): Promise<CrmResponse>; // CRM 的唯一网络出口（见下）
  on(evt: 'state', cb: (s: State) => void): void;
}
```

- 全部 Promise。失败 reject `{ code, message }`，`code` 只取五个错误码（§3）。
- `connect()` 无参数：壳把它翻成 kit 的 `updateLine(selected)` + `start()`。
- `settings()` 一次给全“协议 + 分流”；`setProtocol` / `setSplit` 就地生效并落盘。
- `open` 是**可选能力**：页面必须写成
  `bridge.open ? bridge.open(url) : window.open(url, '_blank', 'noopener')`。
- 页面每个文件加载后必须调一次 `state()`：事件不会重放（§2）。
- `crmRequest` 是 **CRM 唯一的网络出口**：有它就不要再 `fetch(BRAND.crm.base)`。
  参数里**没有 base/host**：壳用自己构建产物里的 `crm.base`（`dist/manifest.json`），
  libbox 再校验一遍（https、path、方法、头、体、超时）。没有 `crmRequest`
  （浏览器 / Studio 预览 / Site / 旧壳）时才回退 `fetch`——`web/api.js` 做特性检测。
- **不再是“登录/注册/计费不走 bridge”**：这三类都是 CRM 请求，默认走 `crmRequest`。

## 2. 事件（1 个）

```js
bridge.on('state', (snapshot) => { /* 与 state() 结构一致 */ });
```

- 壳在**任何状态变化**时推送（连接、断开、失败、重连）。
- 回调**必须在主线程**（壳负责切线程）。
- 事件是「通知」，不是「真相」；真相永远以 `state()` 为准。

## 3. 错误码（UI 据此显示文案，不要自己判断业务）

| code | 含义 | UI 出口 |
|---|---|---|
| `EXPIRED` | 账号到期 / 本周期流量用完 | 套餐页（续费 / 流量包） |
| `FROZEN` | 账号被暂停 | **中性文案** + 客服（不提违规） |
| `DEVICE_LIMIT` | 设备数超限 | 中性文案 + 客服（契约没有设备列表端点） |
| `NETWORK` | 网络不可达 | 重试 |
| `INTERNAL` | 其它 | 重试 |

- 错误文案属于**页面**（`bridge.error-copy` 闸门会检查 5 个码都有用户可见文案）；
  壳只给 `code` + 一句 `message`（排障用，不保证适合用户读）。
- ⚠️ 授权判定在服务端。UI 里的任何状态显示都只是“呈现”，不可作为访问控制。

## 4. 各端实现方式

| 平台 | JS → 原生 | 原生 → JS |
|---|---|---|
| Windows（WebView2） | `window.chrome.webview.postMessage(obj)` | `CoreWebView2.PostWebMessageAsJson`（**切 UI 线程**） |
| macOS（WKWebView） | `window.webkit.messageHandlers.bridge.postMessage(obj)` | `evaluateJavaScript`（主线程） |
| Android（`androidx.webkit`） | `Bridge.postMessage(json)` | `JavaScriptReplyProxy.postMessage` |

### 外壳侧的封包格式（三端一致）

```jsonc
// 请求
{ "id": "17", "method": "setLine", "args": { "id": 3 } }
// 响应
{ "id": "17", "ok": true,  "result": null }
{ "id": "17", "ok": false, "error": { "code": "NETWORK", "message": "…" } }
// 事件
{ "event": "state", "payload": { "status": "connected", "since": 1700000000000 } }
```

- `id` 必须回显（WebView 的消息无序且异步）。
- 只传 JSON 可序列化数据；不要传函数、二进制。
- `args` 是**单值**还是对象由方法签名定：`setLine` 传 `{id}`，`activate` 传 `{key}`，
  `open` 传 `{url}`，`crmRequest` 传 `{method,path,headers,body,timeoutMs}`，无参数方法传 `null`。

### 到 kit 的映射（壳内部，不进契约）

| bridge@3 | kit |
|---|---|
| `capabilities` | 平台常量 + 安装来源（StoreKit / Play Billing / 直装） |
| `activate` / `deactivate` | `VpnClient.activate` / `deactivate` |
| `lines` | `refreshLines` + `getCachedLines` |
| `setLine` | `updateLine` |
| `connect` / `disconnect` | `start` / `stop` |
| `state` | 本地状态机 + `ConnInfo` |
| `setProtocol` | `updateProtocolType` |
| `setSplit` | `updateSplitInfo` |
| `crmRequest` | `crmRequest(base, method, path, headers, body, timeoutMs)` |

## 5. 安全约束（壳侧强制）

| 必须 | 说明 |
|---|---|
| **方法白名单** | 仅本文件 §1 的 14 个字符串；下划线开头的数据字段不是方法 |
| **资源目录白名单** | 只允许加载内置资源目录 + `kit://line-icon/…` |
| **内部导航锁** | 页面之间只允许相对路径；`window.open` / 外部跳转一律拦下 |
| **外链只走系统浏览器** | 客服 / 官网 / 条款 / 收银台只能由 `open()` 打开（页面有降级分支） |
| **禁止危险能力** | 不暴露 `readFile` / `exec` / 任意 URL 打开 / 任意网络请求代理。`crmRequest` 是**唯一例外**：只服务 CRM（base 归壳、path/方法/头/体/超时受限、不跟随重定向、TLS 校验），不是通用代理 |
| **不得记录激活码** | UI 不打印、不落盘、不拼进 URL；壳也不写日志 |

## 6. 线路图标

- 页面只写 `line.icon` 与 `line.iconKind`，**不自己画图标集**。
- 资源 scheme：`kit://line-icon/<kind>/<name>`，`kind = flag | service`。
- 壳在页面脚本之前注入 `window.KIT_ICON_BASE`；缺失时页面用内置占位（单色 SVG + 两位国家码）。
- 图标文件属于 kit（三端各自打包）；租户改线路时不需要、也不应该改图标。

## 7. 参考实现

`web/bridge.js` 在没有壳时提供一个同形 mock：

- **浏览器里没有壳时**（本地开发、Studio 预览、Playwright 假壳缺席）自动启用；
- 行为与真壳同形（含 `state()`、`on('state')`、连接耗时、线路列表、协议/分流落盘）；
- 不是第二份真相：真壳注入的 `window.bridge` 存在时，mock 一个字段都不覆盖；
- mock **不实现** `crmRequest` ⇒ 浏览器/预览自动回退 `fetch`（与真壳同形的特性检测）。

假壳（`test/fake-shell.mjs`）是测试用的第三个实现，只用于 CI 断言“UI 真的按契约走”。
