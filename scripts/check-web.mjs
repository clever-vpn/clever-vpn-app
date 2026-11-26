#!/usr/bin/env node
/**
 * web/ 契约校验 CLI —— runWebCheck() 的读盘包装（判决逻辑全在 scripts/lib/web-check.mjs）
 *
 * 用法：
 *   node scripts/check-web.mjs                       # 只看结果
 *   node scripts/check-web.mjs --report r.json       # 同时写出报告（CI artifact）
 *   node scripts/check-web.mjs --root test/fixtures  # 换根目录（只给测试用）
 *
 * 退出码：0 = 通过（允许 warn），1 = 有违规，2 = 用法/环境错误。
 *
 * 定位：CI 门禁（validate.yml 的 web-contract job）。这里只做**静态**判定；
 * 运行时行为（点击流、console、截图）由 web-smoke（Playwright）判定。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWebCheck, TEXT_EXT, STUDIO_CONTRACT, BRIDGE_VERSION } from './lib/web-check.mjs';

const SELF = fileURLToPath(import.meta.url);
const LIB = new URL('./lib/web-check.mjs', import.meta.url);
const REPO = join(dirname(SELF), '..');

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const reportPath = argValue('--report');
const ROOT = argValue('--root') ? resolve(process.cwd(), argValue('--root')) : REPO;

if (!existsSync(join(ROOT, 'web'))) {
  console.error(`✗ 找不到 ${join(ROOT, 'web')}`);
  process.exit(2);
}

/** @type {{path:string,content?:string,bytes?:Uint8Array}[]} */
const files = [];
function collect(absDir, prefix) {
  for (const name of readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const rel = `${prefix}/${name}`;
    if (statSync(abs).isDirectory()) {
      collect(abs, rel);
      continue;
    }
    const bytes = readFileSync(abs);
    const isText = TEXT_EXT.has(extname(name).toLowerCase());
    files.push({ path: rel, bytes, ...(isText ? { content: bytes.toString('utf8') } : {}) });
  }
}

collect(join(ROOT, 'web'), 'web');
if (existsSync(join(ROOT, 'assets'))) collect(join(ROOT, 'assets'), 'assets');

let appJson = null;
const appJsonPath = join(ROOT, 'app.json');
if (existsSync(appJsonPath)) appJson = readFileSync(appJsonPath, 'utf8');

// WEB_CHECK_ID：与 studio 副本对同一份文件算 sha256，前 16 字节；报告里带，便于对屏
const webCheckId = `sha256:${createHash('sha256').update(readFileSync(LIB)).digest('hex').slice(0, 16)}`;

const result = runWebCheck({ files, appJson, bridge: BRIDGE_VERSION });

console.log(`\nweb/ 契约校验（studio_contract ${STUDIO_CONTRACT} · bridge@${BRIDGE_VERSION}）`);
console.log(`  ${webCheckId}\n`);
for (const c of result.checks) {
  const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
  console.log(`  ${mark} ${c.id.padEnd(26)} ${c.detail ?? ''}`);
}
if (result.violations.length) {
  console.log('\n违规：');
  for (const v of result.violations) {
    console.log(`  ${v.path}${v.line ? `:${v.line}` : ''}  [${v.id}] ${v.message}`);
  }
}
console.log('\n  · runtime.console-clean / 点击流：由 web-smoke（Playwright）判定，见 validate.yml');
console.log(result.ok ? '\n✓ 通过\n' : `\n✗ 未通过（${result.violations.length} 处）\n`);

if (reportPath) {
  const out = reportPath.startsWith('/') ? reportPath : join(ROOT, reportPath);
  writeFileSync(
    out,
    JSON.stringify(
      {
        studio_contract: STUDIO_CONTRACT,
        bridge: BRIDGE_VERSION,
        web_check_id: webCheckId,
        ok: result.ok,
        checks: result.checks,
        violations: result.violations,
        toolchain: { runtime: `node ${process.version}`, generator: 'scripts/check-web.mjs@2', engines: [] },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  报告：${reportPath}\n`);
}

process.exit(result.ok ? 0 : 1);
