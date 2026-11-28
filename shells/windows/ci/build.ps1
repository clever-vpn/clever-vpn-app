<#
  Windows 壳的构建入口（app-release.yml / _shell-windows.yml 调用；本地也可直接跑）。

  输入：
    - 仓库根的 dist/（web/ + manifest.json + icon.png）—— 先跑 node scripts/build.mjs
    - 环境变量 RELEASE_TAG（含 v 前缀）
    - 可选签名材料：WINDOWS_PFX_BASE64 / WINDOWS_PFX_PASSWORD（没有就出未签名包）
  输出：
    shells/windows/ci/out/clever-vpn-app-windows-<RELEASE_TAG>.msi
#>
param(
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$CiDir = $PSScriptRoot
$WindowsDir = Split-Path -Parent $CiDir
$RepoRoot = Split-Path -Parent (Split-Path -Parent $WindowsDir)
$DistDir = Join-Path $RepoRoot 'dist'
$AppProject = Join-Path $WindowsDir 'src/CleverVpn.App/CleverVpn.App.csproj'
$InstallerProject = Join-Path $WindowsDir 'installer/MsiInstaller.wixproj'
$OutDir = Join-Path $CiDir 'out'

$ManifestPath = Join-Path $DistDir 'manifest.json'
if (-not (Test-Path $ManifestPath)) {
  throw "缺少 $ManifestPath —— 先跑 node scripts/build.mjs（dist/ 是壳的唯一输入）"
}
if (-not (Test-Path (Join-Path $DistDir 'icon.png'))) {
  throw "缺少 dist/icon.png —— 先跑 node scripts/build.mjs"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$appName = if ($manifest.name) { [string]$manifest.name } else { 'Clever VPN' }
$version = if ($manifest.version) { [string]$manifest.version -replace '^v', '' } else { '0.0.0' }
$version = ($version -split '-')[0]
if ($version -notmatch '^\d+\.\d+\.\d+$') { $version = '0.0.0' }
$tag = if ($env:RELEASE_TAG) { [string]$env:RELEASE_TAG } else { "v$version" }

# kit 版本：只从 shells/versions.json 读（node 已由 workflow 装好；没有 node 时退回 PowerShell 解析）
$versionsPath = Join-Path $RepoRoot 'shells/versions.json'
$kitVersion = $null
if (Get-Command node -ErrorAction SilentlyContinue) {
  $kitVersion = (& node (Join-Path $RepoRoot 'scripts/kit-version.mjs') --platform windows).Trim()
  if ($LASTEXITCODE -ne 0) { throw "读取 kit 版本失败（node scripts/kit-version.mjs --platform windows）" }
} else {
  $versions = Get-Content $versionsPath -Raw | ConvertFrom-Json
  $kitVersion = [string]$versions.windows
}
if ([string]::IsNullOrWhiteSpace($kitVersion)) { throw 'shells/versions.json 里没有 windows 版本' }

Write-Host "→ 版本 $tag · kit $kitVersion · 应用名 $appName"

# 1) 图标：dist/icon.png → app.ico（csproj 的 ApplicationIcon + WiX 的 Icon 都用它）
$ico = Join-Path $WindowsDir 'src/CleverVpn.App/app.ico'
& pwsh -NoProfile -File (Join-Path $CiDir 'make-icon.ps1') -Source (Join-Path $DistDir 'icon.png') -Dest $ico

# 2) 单元测试（纯 Core，不碰 WinUI）
& dotnet test (Join-Path $WindowsDir 'tests/CleverVpn.Core.Tests/CleverVpn.Core.Tests.csproj') -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) { throw '单元测试失败' }

# 3) publish（Windows App SDK self-contained；输出目录同时给 WiX 用）
$publishDir = Join-Path $WindowsDir 'src/CleverVpn.App/bin/publish'
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }

# WinUI 的 PRI 生成任务（ExpandPriContent）由 EnableMsixTooling 解析；如果机器上有 VS，
# 顺手把它的 AppxPackage 目录显式指过去（dotnet SDK 8.0.4xx 起不再自带这个任务）。
$vsRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
$appxTasks = @(foreach ($root in $vsRoots) {
  $vs = Join-Path $root 'Microsoft Visual Studio'
  if (Test-Path $vs) {
    Get-ChildItem $vs -Recurse -Filter 'Microsoft.Build.Packaging.Pri.Tasks.dll' -ErrorAction SilentlyContinue
  }
}) | Select-Object -First 1

$extra = @()
if ($appxTasks) {
  Write-Host "→ PRI 任务：$($appxTasks.DirectoryName)"
  $extra += "-p:AppxMSBuildToolsPath=$($appxTasks.DirectoryName)"
} else {
  Write-Host "⚠ 没找到 VS 的 PRI 任务，交给 EnableMsixTooling 自己解析"
}

$publishArgs = @(
  'publish', $AppProject,
  '-c', $Configuration,
  '-r', 'win-x64',
  '--self-contained', 'true',
  "-p:KitVersion=$kitVersion",
  "-p:Version=$version",
  "-p:FileVersion=$version.0",
  "-p:AssemblyVersion=$version.0",
  '-o', $publishDir,
  '--nologo'
) + $extra
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish 失败' }

# 4) 签名 exe（如果配了 PFX；MSI 建好后再签一次）
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
$pfxPath = $null
if ($env:WINDOWS_PFX_BASE64) {
  if (-not $signtool) { throw '找不到 signtool.exe（需要 Windows SDK）' }
  $pfxPath = Join-Path $env:RUNNER_TEMP 'windows-signing.pfx'
  [System.IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64))
  & $signtool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $pfxPath /p "$env:WINDOWS_PFX_PASSWORD" (Join-Path $publishDir 'CleverVpn.exe')
  if ($LASTEXITCODE -ne 0) { throw 'exe 签名失败' }
}

# 5) MSI：把品牌名/版本/发布目录写进 WiX 能导入的 props（避免命令行转义中文）
function XmlEscape([string]$value) {
  return $value.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}
$props = @"
<Project>
  <PropertyGroup>
    <AppName>$(XmlEscape $appName)</AppName>
    <MsiVersion>$version.0</MsiVersion>
    <PublishDir>$publishDir</PublishDir>
  </PropertyGroup>
</Project>
"@
Set-Content -Path (Join-Path $WindowsDir 'installer/generated.props') -Value $props -Encoding UTF8

& dotnet build $InstallerProject -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) { throw 'MSI 构建失败' }

$msi = Get-ChildItem (Join-Path $WindowsDir 'installer/bin') -Recurse -Filter '*.msi' | Select-Object -First 1
if (-not $msi) { throw 'MSI 构建成功但没找到产物' }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$asset = Join-Path $OutDir "clever-vpn-app-windows-$tag.msi"
Copy-Item $msi.FullName $asset -Force

# 6) 签名 MSI
if ($pfxPath) {
  & $signtool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $pfxPath /p "$env:WINDOWS_PFX_PASSWORD" $asset
  if ($LASTEXITCODE -ne 0) { throw 'MSI 签名失败' }
  Remove-Item $pfxPath -Force
}

Write-Host "✓ 产物：$asset"
Get-ChildItem $OutDir | Format-Table Name, Length
