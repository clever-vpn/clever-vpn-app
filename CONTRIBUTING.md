# 协作规则

## 分支与合并

- **禁止直接推 `main`**（本地钩子会在 `pre-push` 拦下）。
- 一个改动 = 一个 feature 分支 + 一个 PR。
- 分支命名：`feat/xxx`、`fix/xxx`、`chore/xxx`。

先启用本地钩子：

```bash
git config core.hooksPath .githooks
```

## 提交信息

Conventional Commits，**中文描述**，合并后带 PR 号：

```
feat(web): 节点列表按延迟排序
fix(bridge): state() 在隧道未启动时返回 disconnected
chore(kit): 升级 android-kit 到 2.1.4
```

类型：`feat` `fix` `chore` `docs` `refactor` `test` `perf`。

## 目录所有权

| 目录 | 谁能改 |
|---|---|
| `web/`、`brand.json` | 租户 / 任何贡献者 |
| `docs/` | 任何贡献者 |
| `shell-*/`、`kit/`、`scripts/` | 需维护者审核（见 `CODEOWNERS`）|

## 发布

发布统一走 Actions → **release**（`workflow_dispatch`）：

- `tag` 留空 ⇒ 自动取最新 release 的 `patch + 1`（如 `v1.2.3` → `v1.2.4`）
- 指定 `tag` ⇒ 用你给的版本
- 统一 `v` 前缀

## 校验门禁

PR 必须通过 `validate` 工作流：

- `brand.json` 必填字段齐全、格式合法
- `web/index.html` 存在
- `web/` 不得引用外部 http(s) 脚本/样式（必须自包含）

## 版本对齐

- 外层版本（tag）统一管理 UI + 三端壳。
- 闭源核心版本单独记录在 `kit/kit.version`，由 `kit/fetch-kit.sh` 拉取并校验 sha256。
