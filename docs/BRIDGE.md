# Bridge 契约 `bridge@1`

壳（原生）与 UI（`web/`）之间**唯一**的接口。UI 不直接接触核心库，核心也不认识 UI。

> 版本：`1`。任何破坏性变更必须升版本并保留旧版兼容，因为**租户的 UI 代码依赖它**。

## 1. 方法（3 个，全部返回 Promise）

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

| 必须 | 说明 |
|---|---|
| **方法白名单** | 仅 `connect` / `disconnect` / `state` 三个字符串 |
| **资源目录白名单** | 只允许加载内置资源目录（或 `app.json` 的 `crm.base` / `links` 声明的域名）|
| **禁止外部导航** | 拦掉 `window.open` / 非白名单跳转 |
| **禁止危险能力** | 不暴露 `readFile` / `exec` / 任意 URL 打开 |

## 6. 参考实现

`web/index.html` 里有一个 `createMock()`，**就是参考实现**：在浏览器里模拟壳，行为与真壳一致（含 900 ms 连接耗时）。租户可直接在浏览器里开发 UI，无需真壳。
