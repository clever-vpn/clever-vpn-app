# shells/windows

WinUI 3 + WebView2 薄壳。窗口里只有一个 WebView2，承载 `dist/web`；14 个 bridge 方法由
`CleverVpn.Core` 的 dispatcher 校验，能力来自闭源 kit（`CleverVpn.App/Kit/KitBackend.cs`）。

```
src/CleverVpn.Core/     纯逻辑（bridge dispatcher + 错误映射 + manifest 读取；macOS/Linux 也能编译/跑测试）
src/CleverVpn.App/      WinUI 3 应用（窗口、WebView2、kit 接线、服务模式）
tests/CleverVpn.Core.Tests/  xUnit（不依赖 WinUI / kit）
installer/              WiX 6 MSI
ci/build.ps1            构建入口：dist → 单测 → publish → 签名 → MSI → ci/out/
ci/make-icon.ps1        dist/icon.png → app.ico
```

本地（Windows）：

```powershell
node scripts/build.mjs                              # 先生成 dist/
pwsh -File shells/windows/ci/build.ps1              # 未签名 MSI → shells/windows/ci/out/
```

- kit 版本：`shells/versions.json` 的 `windows`（ci 读，项目文件不写死）。
- 产物：`shells/windows/ci/out/clever-vpn-app-windows-<tag>.msi`；安装目录固定 `%ProgramFiles%\CleverVpn`，
  exe 固定 `CleverVpn.exe`（kit 把它注册成 `CleverVpnBrokerService`）。
- 签名：`WINDOWS_PFX_BASE64` / `WINDOWS_PFX_PASSWORD`；没有就出未签名包（只用于功能验收）。
- CI：`.github/workflows/_shell-windows.yml`（`app-release.yml` 调用，也可单独 dispatch）。
