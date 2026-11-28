#!/usr/bin/env node
/**
 * 路径白名单 —— 按 ref 判定允许改哪些路径（app-studio-app §2）
 *
 * 用法：
 *   node scripts/check-paths.mjs --base main --head HEAD
 *   node scripts/check-paths.mjs --base origin/main --head HEAD   # CI（fetch-depth: 0）
 *
 * 规则（Contract 6）：
 *   studio/app            设计分支：app/web/**、app/assets/**、app/app.json、app.lock.json
 *   studio/build/<sha>    临时构建：相对 main 只允许 app/** + app.lock.json
 *   其它分支              上游/人工分支：只提示、不拦截（上游自己要改 scripts/、.github/）
 *
 * 任何 studio 分支都不得改：shells/、scripts/、.github/、docs/、README.md、LICENSE。
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
const prefix = branch === 'studio/app' ? 'design'
  : branch.startsWith('studio/build/') ? 'build'
    : 'other';

const FORBIDDEN = [
  [/^shells\//, 'shells/ 属于上游壳'],
  [/^scripts\//, 'scripts/ 属于上游'],
  [/^\.github\//, '.github/ 属于上游'],
  [/^docs\//, 'docs/ 属于上游'],
  [/^README\.md$/, 'README.md 属于上游'],
  [/^LICENSE$/, 'LICENSE 属于上游'],
];

const ALLOW = {
  design: [/^app\/web\//, /^app\/assets\//, /^app\/app\.json$/, /^app\.lock\.json$/],
  build: [/^app\/web\//, /^app\/assets\//, /^app\/app\.json$/, /^app\.lock\.json$/],
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
    violations.push({ path: c.path, rule: 'forbidden', message: `${hard[1]}（任何 studio 分支都不得修改）` });
    continue;
  }
  if (!allowed.some((re) => re.test(c.path))) {
    violations.push({ path: c.path, rule: 'outside', message: `${branch} 分支不允许改这个路径` });
    continue;
  }
  if (c.path === 'app/app.json' && c.status === 'D') {
    violations.push({ path: c.path, rule: 'required', message: 'app.json 不可删除（App 的品牌与业务入口）' });
  }
}

// build 分支必须带 app.lock.json；设计分支允许首次发布前还没有
if (prefix === 'build' && !changes.some((c) => c.path === 'app.lock.json' && c.status !== 'D')) {
  violations.push({ path: 'app.lock.json', rule: 'required', message: 'build 分支必须包含 app.lock.json' });
}

if (violations.length) {
  console.log('  越界：');
  for (const v of violations) console.log(`  ✗ ${v.path}  [${v.rule}] ${v.message}`);
  console.log(`\n✗ 未通过（${violations.length} 处）\n`);
  process.exit(1);
}

console.log(`  ✓ ${changes.length} 个改动都在 ${prefix} 分支的允许路径内`);
console.log('\n✓ 通过\n');
