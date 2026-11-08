#!/usr/bin/env node
/**
 * 构建：校验 app.json / assets/icon.png / app.lock.json → 注入 web/_brand.js → 复制到 dist/ → 写 manifest
 *
 * 用法：
 *   node scripts/build.mjs           # 构建
 *   node scripts/build.mjs --check   # 只校验（CI 的 PR 门禁用）
 *
 * 输入分三层，别混（契约在 clever-vpn-docs 的 docs/contracts/）：
 *   app.json         租户面：name / short_name / tagline / color / icon / logo / crm / links → app-json.md
 *   assets/icon.png  租户面：1024×1024 PNG、无 alpha、≤1MB（路径可用 icon 字段改）   → app-json.md §3
 *   assets/logo.*    租户面：界面上的品牌标记（PNG/SVG，正方形），不填则回落到 icon
 *                    路径可指向 assets/ 或 web/ 下的任意文件（见 assetPath）
 *   app.lock.json    机器面：lock_version / bundle_id / generator / source_revision → studio-app.md §1.1
 *   kit/kit.version  平台面：闭源核心版本（平台发布时更新，租户不改）
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const RELEASE = Boolean(process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME?.startsWith('v'));
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(`缺少 ${rel}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { fail(`${rel} 不是合法 JSON：${e.message}`); }
}

const app = readJson('app.json');
const lock = readJson('app.lock.json');

// kit/kit.version 允许注释行与空行
const kitVersionPath = join(ROOT, 'kit', 'kit.version');
if (!existsSync(kitVersionPath)) fail('缺少 kit/kit.version');
const kitVersion = readFileSync(kitVersionPath, 'utf8')
  .split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).join('');
if (!kitVersion) fail('kit/kit.version 里没有版本号');

// ── 校验 ──
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reverseDns = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,10}$/i;
const hexColor = /^#[0-9a-f]{6}$/i;
const httpsUrl = /^https:\/\/[^\s]+$/;
const errors = [];
const warnings = [];

// app.json：白名单（防止构建参数、平台标识被加回来）
const APP_KEYS = new Set(['name', 'short_name', 'tagline', 'color', 'icon', 'logo', 'crm', 'links']);
const CRM_KEYS = new Set(['base', 'id']);
const LINK_KEYS = new Set(['terms', 'privacy', 'support', 'website']);
for (const k of Object.keys(app)) {
  if (!APP_KEYS.has(k)) {
    errors.push(`app.json 不接受字段 "${k}"（包名放 app.lock.json，核心版本放 kit/kit.version，外观/业务入口见 docs/contracts/app-json.md）`);
  }
}
for (const [obj, keys, label] of [[app.crm, CRM_KEYS, 'crm'], [app.links, LINK_KEYS, 'links']]) {
  if (obj === undefined) continue;
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) { errors.push(`app.json: ${label} 必须是对象`); continue; }
  for (const k of Object.keys(obj)) {
    if (!keys.has(k)) errors.push(`app.json: ${label} 不接受字段 "${k}"`);
  }
}

for (const k of ['name', 'short_name']) {
  if (typeof app[k] !== 'string' || !app[k].trim()) errors.push(`app.json: ${k} 必填且为非空字符串`);
}
if (app.tagline !== undefined) {
  if (typeof app.tagline !== 'string') errors.push('app.json: tagline 必须是字符串（可留空）');
  else if (app.tagline.length > 40) warnings.push(`app.json: tagline 已 ${app.tagline.length} 字，欢迎页上会被截断（建议 ≤ 24）`);
}
if (typeof app.color !== 'string' || !hexColor.test(app.color)) errors.push('app.json: color 必须是 #rrggbb');

const crm = app.crm ?? {};
if (crm.base) {
  if (!httpsUrl.test(crm.base) || crm.base.endsWith('/')) errors.push('app.json: crm.base 必须是 https:// 开头且无尾斜杠（或留空）');
}
if (crm.id && !uuid.test(crm.id)) errors.push('app.json: crm.id 必须是 UUID（或留空）');
if (crm.base && !crm.id) warnings.push('crm.base 已填但 crm.id 为空：发布门禁会跳过标识比对（见 app-crm.md §4.1）');
if (crm.id && !crm.base) warnings.push('crm.id 已填但 crm.base 为空：该值不会生效');

for (const [k, v] of Object.entries(app.links ?? {})) {
  if (v && !httpsUrl.test(v)) warnings.push(`links.${k} 建议用 https:// 链接`);
}

// app.lock.json：机器生成的锁文件
if (lock.lock_version !== 1) errors.push(`app.lock.json: lock_version 必须是 1（当前 ${JSON.stringify(lock.lock_version)}）`);
for (const p of ['android', 'ios', 'macos', 'windows']) {
  const v = lock.bundle_id?.[p];
  if (!v) errors.push(`app.lock.json: bundle_id.${p} 必填`);
  else if (!reverseDns.test(v)) errors.push(`app.lock.json: bundle_id.${p} 必须是反向域名格式（如 com.acme.vpn）`);
  else if (v.startsWith('com.example.')) warnings.push(`bundle_id.${p} 还是示例值（上架前必须改，且上架后不可再改）`);
}
for (const k of ['generator', 'source_revision']) {
  if (lock[k] === undefined) warnings.push(`app.lock.json: 缺少 ${k}（Studio 生成的文件会带；手改无效）`);
}

// ── 图标与标记：app-json.md §1.4 / §3 ──
// 两个文件用途不同：icon = 应用图标（商店/启动器，规格硬）；logo = 界面里的品牌标记（可 SVG）
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngInfo = (abs) => {
  const buf = readFileSync(abs);
  if (buf.length < 26 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  // colorType: 0=灰度 2=真彩 3=索引 4=灰度+alpha 6=真彩+alpha
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
};

// 素材路径一律是项目内相对路径，只允许落在租户能改的两个目录（assets/、web/）：
// 不许指到仓库外——产物只能由仓库内容决定，否则同一个 tag 构不出相同结果。
const ASSET_ROOTS = ['assets/', 'web/'];
function assetPath(value, fallback, label) {
  const v = value === undefined || value === '' ? fallback : value;
  if (v === null) return null;
  if (typeof v !== 'string') { errors.push(`app.json: ${label} 必须是字符串路径`); return null; }
  if (v.startsWith('/') || v.includes('..') || !ASSET_ROOTS.some((r) => v.startsWith(r))) {
    errors.push(`app.json: ${label} 必须是 assets/ 或 web/ 下的相对路径（当前 "${v}"）`);
    return null;
  }
  if (!existsSync(join(ROOT, v))) { errors.push(`app.json: ${label} 指向的文件不存在：${v}`); return null; }
  return v;
}

const iconRel = assetPath(app.icon, 'assets/icon.png', 'icon');
if (!iconRel) {
  if (RELEASE) errors.push('缺少应用图标（默认 assets/icon.png）：正式出包不允许用占位图');
  else warnings.push('缺少应用图标：开发构建可以继续，正式出包会失败');
} else {
  const info = pngInfo(join(ROOT, iconRel));
  if (!info) errors.push(`${iconRel} 不是 PNG 文件`);
  else {
    if (info.width !== 1024 || info.height !== 1024) errors.push(`${iconRel} 必须是 1024×1024（当前 ${info.width}×${info.height}）`);
    if (info.colorType === 4 || info.colorType === 6) errors.push(`${iconRel} 必须无透明通道（App Store 会拒绝带 alpha 的图标）`);
    const size = statSync(join(ROOT, iconRel)).size;
    if (size > 1024 * 1024) errors.push(`${iconRel} 不能超过 1MB（当前 ${(size / 1024 / 1024).toFixed(2)}MB）`);
  }
}

// logo 不填就回落到 icon：只准备一张 PNG 也能跑
const logoRel = assetPath(app.logo, iconRel, 'logo');
let logoUrl = '';
if (logoRel) {
  const ext = extname(logoRel).toLowerCase();
  if (ext !== '.png' && ext !== '.svg') errors.push(`app.json: logo 只支持 .png / .svg（当前 ${logoRel}）`);
  const size = statSync(join(ROOT, logoRel)).size;
  if (size > 256 * 1024) errors.push(`logo 不能超过 256KB（当前 ${(size / 1024).toFixed(0)}KB）`);
  if (ext === '.png') {
    const info = pngInfo(join(ROOT, logoRel));
    if (!info) errors.push(`${logoRel} 不是 PNG 文件`);
    else if (info.width !== info.height) warnings.push(`logo 建议用正方形（当前 ${info.width}×${info.height}）`);
  }
  // 已经在 web/ 里的文件不动它（本身就是产物的一部分）；放在 assets/ 的才拷一份过去
  logoUrl = logoRel.startsWith('web/') ? logoRel.slice('web/'.length) : `_brand-logo${ext}`;
}

const webEntry = join(ROOT, 'web', 'index.html');
if (!existsSync(webEntry)) errors.push('缺少 web/index.html');

// UI 必须自包含：不允许外链脚本/样式（离线也要能用）
const html = existsSync(webEntry) ? readFileSync(webEntry, 'utf8') : '';
const external = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (external.length) errors.push(`web/index.html 引用了外部资源（离线不可用）：${external.join(', ')}`);

warnings.forEach((w) => warn(w));
if (errors.length) {
  console.error('✗ 配置校验失败：');
  errors.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}
ok(`app.json / app.lock.json / ${iconRel || 'icon'} 校验通过`);

if (CHECK_ONLY) { console.log('  ✓ check 模式：未生成产物'); process.exit(0); }

// ── 注入 ──
const brand = {
  name: app.name,
  short_name: app.short_name,
  tagline: app.tagline || '',
  color: app.color,
  // logo 是**产物里的相对 URL**（如 _brand-logo.svg），不是仓库路径
  logo: logoUrl,
  crm: { base: crm.base || '', id: crm.id || '' },
  links: app.links || {},
};
const brandJs = `/* 由 scripts/build.mjs 从 app.json 生成，请勿手改 */\nwindow.BRAND = ${JSON.stringify(brand, null, 2)};\n`;
writeFileSync(join(ROOT, 'web', '_brand.js'), brandJs);
ok('生成 web/_brand.js');

// logo 与 _brand.js 一样是构建产物（gitignore 了）：先清掉上一次的扩展名，再拷一份进 web/
for (const f of readdirSync(join(ROOT, 'web'))) {
  if (f.startsWith('_brand-logo.') && f !== logoUrl) rmSync(join(ROOT, 'web', f), { force: true });
}
if (logoRel && !logoRel.startsWith('web/')) {
  copyFileSync(join(ROOT, logoRel), join(ROOT, 'web', logoUrl));
  ok(`拷贝 ${logoRel} → web/${logoUrl}`);
}

// ── 产物 ──
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(ROOT, 'web'), join(dist, 'web'), { recursive: true });
writeFileSync(join(dist, 'web', '_brand.js'), brandJs);

const version = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || 'dev';
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
  name: brand.name,
  version,
  kit_version: kitVersion,
  bundle_id: lock.bundle_id,
  lock_version: lock.lock_version,
  source_revision: lock.source_revision ?? null,
  built_at: new Date().toISOString(),
}, null, 2) + '\n');

ok(`产物输出到 dist/（版本 ${version}，kit ${kitVersion}）`);
console.log('\n下一步：在 shell-windows / shell-macos / shell-android 中把 dist/web 打进安装包。');
