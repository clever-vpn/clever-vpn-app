#!/usr/bin/env node
/**
 * 构建：校验 brand.json → 注入 web/_brand.js → 复制到 dist/ → 写 manifest
 *
 * 用法：
 *   node scripts/build.mjs           # 构建
 *   node scripts/build.mjs --check   # 只校验（CI 的 PR 门禁用）
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. 读取 ──
const brandPath = join(ROOT, 'brand.json');
if (!existsSync(brandPath)) fail('缺少 brand.json');
let brand;
try { brand = JSON.parse(readFileSync(brandPath, 'utf8')); }
catch (e) { fail(`brand.json 不是合法 JSON：${e.message}`); }

// ── 2. 校验 ──
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reverseDns = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,10}$/i;
const hexColor = /^#[0-9a-f]{6}$/i;
const errors = [];

if (!brand.tenant_id || !uuid.test(brand.tenant_id)) errors.push('tenant_id 必须是 UUID');
for (const k of ['name', 'short_name', 'kit_version']) {
  if (!brand[k] || typeof brand[k] !== 'string') errors.push(`${k} 必填且为字符串`);
}
for (const p of ['android', 'ios', 'macos', 'windows']) {
  const v = brand.bundle_id?.[p];
  if (!v) errors.push(`bundle_id.${p} 必填`);
  else if (!reverseDns.test(v)) errors.push(`bundle_id.${p} 必须是反向域名格式（如 com.acme.vpn）`);
  else if (v.startsWith('com.example.')) console.log(`  ⚠ bundle_id.${p} 还是示例值（上架前必须改）`);
}
if (!brand.brand_color || !hexColor.test(brand.brand_color)) errors.push('brand_color 必须是 #rrggbb');

const webEntry = join(ROOT, 'web', 'index.html');
if (!existsSync(webEntry)) errors.push('缺少 web/index.html');

// UI 必须自包含：不允许外链脚本/样式（离线也要能用）
const html = existsSync(webEntry) ? readFileSync(webEntry, 'utf8') : '';
const external = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
if (external.length) errors.push(`web/index.html 引用了外部资源（离线不可用）：${external.join(', ')}`);

if (errors.length) { console.error('✗ brand.json / web 校验失败：'); errors.forEach(e => console.error('   - ' + e)); process.exit(1); }
ok('brand.json 校验通过');

if (CHECK_ONLY) { console.log('  ✓ check 模式：未生成产物'); process.exit(0); }

// ── 3. 注入品牌 ──
const brandJs = `/* 由 scripts/build.mjs 生成，请勿手改 */
window.BRAND = ${JSON.stringify(
  { tenant_id: brand.tenant_id, name: brand.name, short_name: brand.short_name, brand_color: brand.brand_color, links: brand.links || {} },
  null, 2)};\n`;
writeFileSync(join(ROOT, 'web', '_brand.js'), brandJs);
ok('生成 web/_brand.js');

// ── 4. 产物 ──
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(ROOT, 'web'), join(dist, 'web'), { recursive: true });
writeFileSync(join(dist, 'web', '_brand.js'), brandJs);

const version = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || 'dev';
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
  name: brand.name,
  tenant_id: brand.tenant_id,
  version,
  kit_version: brand.kit_version,
  bundle_id: brand.bundle_id,
  built_at: new Date().toISOString(),
}, null, 2) + '\n');

ok(`产物输出到 dist/（版本 ${version}）`);
console.log('\n下一步：在 shell-windows / shell-macos / shell-android 中把 dist/web 打进安装包。');
