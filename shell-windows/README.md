# shell-windows

Windows 薄壳：**WinUI 3 + WebView2**，把 `dist/web` 全屏承载，并向页面注入 `bridge@1`。

## 计划接入

| 项 | 说明 |
|---|---|
| 窗口 | 无边框 / 可拖拽标题栏（`app-region: drag`），支持迷你模式（360×200，`?mini=1`）|
| 托盘 | 托盘图标 + 右键菜单（显示 / 连接 / 断开 / 退出）|
| 自启 | 跟随系统启动（可选，租户可在设置里开）|
| 隧道 | 调用闭源 `windows-kit.dll`（`kit/fetch-kit.sh` 获取）|
| bridge | `CoreWebView2.WebMessageReceived` ↔ `PostWebMessageAsJson`，方法白名单 3 个 |
| 资源 | 只加载内置 `dist/web`（禁止外部导航）|
| 打包 | `msix`（商店）与 `exe`（自签/直发）两种 |

## 落地方式

复制现有客户端工程（已包含托盘、自启、kit 接线、打包签名），将其中的 XAML 页面替换为全屏 `WebView2`，再注入 bridge 三个方法。

> 现有通用客户端在独立仓库，未迁移；本目录只放**新品牌 App** 的壳。

## 验收

1. 启动后看到的是 `web/` 页面（而非原生界面）
2. 页面上点「连接」→ 隧道真的起来（可上外网）
3. 关闭重开 → 状态正确恢复
4. 改 `web/` 一行文字 → 重新构建 → 界面随之变化
5. Windows 125% / 150% 缩放显示正常
