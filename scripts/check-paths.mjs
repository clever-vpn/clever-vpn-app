#!/usr/bin/env node
/**
 * 路径白名单 —— 按 PR 的分支前缀判定允许改哪些路径（app-studio-app §2）
 *
 * 用法：
 *   node scripts/check-paths.mjs --base main --head HEAD
 *   node scripts/check-paths.mjs --base origin/main --head HEAD   # CI（fetch-depth: 0）
 *
 * 规则（decisions §1 / §6.3）：
 *   studio/design/<sha>   web/**、assets/**、app.json；**不得**改 crm.*
 *   studio/config/<sha>   仅 app.json（可以改 crm.*）
 *   studio/onboard/<sha>  design 的路径 + app.lock.json（首次接入）
 *   其它分支             人工/上游分支：只提示、不拦截（上游自己要改 scripts/、.github/）
 *
 * 任何 studio 分支都不得改：shell-xxx/、kit/、scripts/、.github/、docs/、README.md、LICENSE、template.json。
 * 退出码：0 = 通过，1 = 越界，2 = 用法/环境错误。
 */
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}
const BASE = arg('base', 'main');
const HEAD = arg('head', 'HEAD');

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let baseRef = BASE;
try {
  git(['rev-parse', '--verify', `${BASE}^{commit}`]);
} catch {
  try {
    baseRef = `origin/${BASE}`;
    git(['rev-parse', '--verify', `${baseRef}^{commit}`]);
  } catch {
    console.error(`✗ 找不到基线分支 ${BASE}（本地也没有 origin/${BASE}）：fetch 后再跑`);
    process.exit(2);
  }
}

const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git(['rev-parse', '--abbrev-ref', HEAD]);
const prefix = branch.startsWith('studio/design/') ? 'design'
  : branch.startsWith('studio/config/') ? 'config'
    : branch.startsWith('studio/onboard/') ? 'onboard'
      : 'other';

const FORBIDDEN = [
  [/^shell-[^/]+\//, 'shell-*/ 属于上游壳'],
  [/^kit\//, 'kit/ 属于平台'],
  [/^scripts\//, 'scripts/ 属于上游'],
  [/^\.github\//, '.github/ 属于上游'],
  [/^docs\//, 'docs/ 属于上游'],
  [/^README\.md$/, 'README.md 属于上游'],
  [/^LICENSE$/, 'LICENSE 属于上游'],
  [/^template\.json$/, 'template.json 属于平台'],
];

const ALLOW = {
  design: [/^web\//, /^assets\//, /^app\.json$/],
  config: [/^app\.json$/],
  onboard: [/^web\//, /^assets\//, /^app\.json$/, /^app\.lock\.json$/],
};

let changes;
try {
  changes = git(['diff', '--name-status', '--diff-filter=ACDMRT', `${baseRef}...${HEAD}`])
    .split('\n').filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: status[0], path: rest[rest.length - 1] };
    });
} catch (e) {
  console.error(`✗ 取不到 diff（${baseRef}...${HEAD}）：${e.message}`);
  process.exit(2);
}

console.log(`\n路径白名单（${branch} · ${baseRef}...${HEAD}）\n`);

if (prefix === 'other') {
  console.log('  · 非 studio 分支：不做强制判定（人工/上游分支可以改任何路径）');
  for (const c of changes) console.log(`    ${c.status} ${c.path}`);
  console.log('\n✓ 通过（仅提示）\n');
  process.exit(0);
}

const violations = [];
const allowed = ALLOW[prefix];

for (const c of changes) {
  const hard = FORBIDDEN.find(([re]) => re.test(c.path));
  if (hard) {
    violations.push({ path: c.path, rule: 'forbidden', message: `${hard[1]}（任何 studio PR 都不得修改）` });
    continue;
  }
  if (!allowed.some((re) => re.test(c.path))) {
    violations.push({ path: c.path, rule: 'outside', message: `${branch} 分支不允许改这个路径` });
    continue;
  }
  if (c.path === 'app.json' && c.status === 'D') {
    violations.push({ path: c.path, rule: 'required', message: 'app.json 不可删除（App 的品牌与业务入口）' });
  }
}

// 设计分支不得改 crm.*：它决定登录与收款去向
if (prefix === 'design') {
  const readApp = (ref) => {
    try { return JSON.parse(git(['show', `${ref}:app.json`])); } catch { return null; }
  };
  const before = readApp(baseRef);
  const after = readApp(HEAD);
  if (before && after) {
    const a = JSON.stringify(before.crm ?? {});
    const b = JSON.stringify(after.crm ?? {});
    if (a !== b) {
      violations.push({
        path: 'app.json',
        rule: 'crm-locked',
        message: `studio/design/* 不得修改 crm.*（${a} → ${b}）；要改业务入口请走 studio/config/*`,
      });
    }
  }
}

if (prefix === 'onboard' && !changes.some((c) => c.path === 'app.lock.json')) {
  console.log('  ⚠ onboard 分支没有带 app.lock.json：确认这是不是一次真正的首次接入');
}

if (violations.length) {
  console.log('  越界：');
  for (const v of violations) console.log(`  ✗ ${v.path}  [${v.rule}] ${v.message}`);
  console.log(`\n✗ 未通过（${violations.length} 处）\n`);
  process.exit(1);
}

console.log(`  ✓ ${changes.length} 个改动都在 ${prefix} 分支的允许路径内`);
console.log('\n✓ 通过\n');
