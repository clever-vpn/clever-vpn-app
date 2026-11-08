# UI 参考清单（竞品与平台实测）

Last updated: 2026-10-21
Status: `design`（素材参考，不是规范；规范见 `UI-PRINCIPLES.md`）

> 来源：`clever-vpn-docs`（2026-11-08 迁入本仓）。这是 app 自己的界面素材清单。

Status: `design`

> 用途：给新品牌 App（web UI + 原生薄壳）做界面参考。
> ⚠️ 看设计稿只解决「好看」，不解决「失败态」——后者见 §3。

## 1. 平台可达性（实测）

| 平台 | 状态 | 说明 |
|---|---|---|
| **Dribbble** | ✅ 可看 | 本次 25 个作品全部来自这里 |
| **Figma Community** | ✅ 可搜 | 搜 `vpn app ui` 有**可复制的源文件**，比截图有用 |
| **Behance** | ⚠️ 403 | 需登录 |
| **Mobbin** | ⚠️ 需登录 | **真实产品截图库**，最贴近落地 |
| **Pageflows** | ⚠️ 需登录 | 真实流程录屏（NordVPN / Proton 等）|

## 2. Dribbble 作品（vpn app 搜索结果）

### 2.1 手机端 App UI

| 作品 | 链接 |
|---|---|
| Vepeen SaaS VPN App（完整流程） | https://dribbble.com/shots/27768772 |
| iHide VPN: seamless UX & product design | https://dribbble.com/shots/27346008 |
| SafeNet VPN（落地页 + App 全套） | https://dribbble.com/shots/26790186 |
| PinVpn – Modern VPN Mobile App UI | https://dribbble.com/shots/27443190 |
| VPN App UI – Dark Mobile Security Dashboard | https://dribbble.com/shots/27525320 |
| Argus VPN – Mobile app design and 3D animation | https://dribbble.com/shots/27497923 |
| SlyVPN Mobile App Design | https://dribbble.com/shots/26374003 |
| Gelby – VPN Mobile App | https://dribbble.com/shots/25293430 |
| Cyber VPN Mobile App | https://dribbble.com/shots/27617928 |
| Cycle Net VPN – Mobile App Concept | https://dribbble.com/shots/25679895 |
| VPN Mobile App Design | https://dribbble.com/shots/27460731 |
| VPN Mobile App UI | https://dribbble.com/shots/26713721 |
| VPN Mobile UI | https://dribbble.com/shots/26477799 |
| VPN Mobile App | https://dribbble.com/shots/25543334 |

### 2.2 桌面 / 网页 / 商店物料

| 作品 | 链接 |
|---|---|
| VPN Software Website Landing Page | https://dribbble.com/shots/26792953 |
| VPN Mobile App \| Store Screenshots & Banner | https://dribbble.com/shots/27073473 |
| Branding for VPN & Privacy Service | https://dribbble.com/shots/27824885 |

### 2.3 更该看：真实产品（不是概念稿）

| 来源 | 为什么 |
|---|---|
| ProtonVPN / NordVPN / Mullvad 官网 App 截图 | 真实产品，**有错误态** |
| ⭐ **Outline 客户端**（开源，Electron + Go）| 与本项目同构，可直接看源码怎么组织界面 |
| ⭐ **Clash Verge Rev**（Tauri + Rust/TS）| 真实 Web UI 在桌面上的实际观感 |

## 3. 行业标准骨架（3 屏）

以 Vepeen 那组为例：

| 屏 | 内容 |
|---|---|
| ① **选服务器** | 搜索框 + 国家/城市列表（国旗 · 城市 · 延迟 · 锁） |
| ② **连接中** | **计时器** + **巨大圆形电源按钮** + 状态文案 |
| ③ **升级引导** | 权益勾选列表 + CTA |

### ⚠️ 概念稿普遍缺失的「失败态」（我们的真实难点）

| 状态 | 必须设计 |
|---|---|
| 账号过期 | 明确提示 + 续费入口（不弹窗骚扰） |
| **被冻结** | 中性文案（不说“违规”），给客服入口 |
| 设备数超限 | 显示当前设备列表 + 让他踢掉一台 |
| 无网络 / 节点全挂 | 区分「你的网络问题」和「我们的问题」 |
| 连接中卡住 | 超时后自动降级 + 一键重试 |
| 已连接但流量为 0 | 提示「已连接但无数据，换节点试试」 |

## 4. 抄 / 不抄

| 抄 ✓ | 不抄 ✗ |
|---|---|
| 三屏结构（服务器 / 连接 / 升级） | 3D 动画（租户维护不了） |
| 大圆形按钮 + 计时器 | 过度暗色（白标客户行业不同） |
| 服务器列表（国旗 + 延迟） | 固定玻璃拟态（要能换主题） |

## 5. 白标约束（给设计师的硬要求）

| 要求 | 说明 |
|---|---|
| 只用 **8 个 CSS 变量** | `--brand` `--bg` `--surface` `--text` `--dim` `--radius` `--gap` `--font` |
| 页面里**禁止硬编码颜色/间距** | 否则租户换不了品牌 |
| **必须支持暗色** | `prefers-color-scheme`，只改变量不改结构 |
| **只做 2 个布局** | `≤600px` 单列 / `>600px` 侧栏；不要 4–5 个断点 |
| **桌面迷你模式** | 360×200 只显示「状态 + 按钮」，桌面端刚需 |
| 按钮不固定宽度 | 中英文长度差 30–50% |

## 6. 尺寸清单（验收用）

| 视口 | 场景 |
|---|---|
| 320×568 | 最小 Android |
| 375×812 | iPhone 常规 |
| 600×900 | 平板 / 桌面小窗 |
| 1280×800 | 桌面（含 Windows 125% 缩放） |
| 360×200 | 迷你模式 |
