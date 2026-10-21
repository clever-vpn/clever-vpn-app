# Repository Copilot Instructions — clever-vpn-app

## Git Workflow Policy (Mandatory)

Follow this policy for all changes unless the user explicitly overrides it in the current chat.

1. Never push directly to `main`.
2. Do all work in a non-main branch.
3. Use pull requests for all merges into `main`.
4. Preferred lifecycle is:
   - issue -> new branch -> implement -> PR -> merge -> delete branch
5. After PR merge, delete both remote and local feature branches when possible.

## Branching Rules

1. If current branch is `main`, create and switch to a new working branch before making commits.
2. Keep branch names task-oriented, for example:
   - `issue-<number>-<short-topic>`
   - `feat/<short-topic>`
   - `fix/<short-topic>`

## PR Rules

1. Ensure CI or required checks pass before merge when feasible.
2. Use clear PR titles and include a short summary of behavior changes.
3. Do not bypass branch protection rules.

## Safety Rules

1. Do not use destructive git operations unless explicitly requested.
2. Do not rewrite shared history unless explicitly requested.
3. If unexpected large workspace changes appear, stop and ask the user before proceeding.

## Release Tag Rules

1. Git tags and GitHub Releases must use a `v` prefix, for example `v1.2.3`.
2. Workflow input may accept both prefixed and unprefixed versions, but publishing is
   always with the `v` prefix.
3. Duplicate checks must target the normalized publish tag.

## Stack Conventions

This repository is an **open-source white-label client shell**: one web UI + three thin
native shells, with the proprietary core shipped as prebuilt binaries from
`clever-vpn-kit`.

- **Tenants only fork this repo and edit `brand.json` + `web/`.** Any change that would
  force a tenant to also edit `shell-*/` or `kit/` is a design regression — push the
  behavior into `web/` instead.
- **Brand values must come from `brand.json` only.** Never hardcode product name, bundle
  id, API domain, icon paths or primary color inside `web/` or `shell-*/`.
- `dist/` and `web/_brand.js` are **build outputs** (gitignored). Never commit them and
  never hand-edit generated files.
- The single build entry point is `node scripts/build.mjs` (same command CI uses). If you
  change build logic, all three platform outputs must still be produced.
- The core is closed-source: **no binaries in this repo**. Always obtain them via
  `kit/fetch-kit.sh` (reads `kit/kit.version`, verifies sha256). To bump the core, change
  only `kit/kit.version`.
- The native shells are **thin**: business logic belongs in `web/`; shells only implement
  the bridge. Changing the bridge requires updating `docs/BRIDGE.md` plus all three
  shells in the same PR, and calling out breaking contract changes in the PR description.
- Node version follows `.nvmrc` (22). Do not add dependencies that need extra toolchains —
  builds must run on default GitHub Actions runners so tenants never install
  Xcode / Android Studio / Visual Studio locally.
- Docs under `docs/` are updated in the same PR as the code they describe.
- This is a **public** repository: never commit secrets, keystores, signing certificates,
  tokens, private endpoints, or real tenant/customer data. Use placeholders in examples.
- Respect `CODEOWNERS`: `web/` and `brand.json` are tenant-editable; `shell-*/`, `kit/`,
  `scripts/` and `docs/` changes need maintainer review.
