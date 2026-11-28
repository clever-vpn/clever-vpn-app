#!/usr/bin/env node
/**
 * 构建：校验 app/app.json / 图标 / logo / app.lock.json
 *      → 注入 app/web/_brand.js → 拷 logo → 复制到 dist/ → 写 manifest
 *
 * 用法：
 *   node scripts/build.mjs           # 构建
 *   node scripts/build.mjs --check   # 只校验（CI 的 PR 门禁用）
 *
 * 输入分三层，别混（契约在 clever-vpn-docs 的 docs/contracts/）：
 *   app/app.json      租户面：name / short_name / tagline / color / icon / logo
 *                            / crm{base,id} / links{terms,privacy,support,website} → app-json.md
 *   app/assets/       租户面：1024×1024 PNG（无 alpha、≤1MB）、logo（PNG/SVG）     → app-json.md §3
 *   app.lock.json     机器面：lock_version / bundle_id / generator / source_revision → app-studio-app.md §1.1
 *
 * 桥的版本在 scripts/lib/web-check.mjs（BRIDGE_VERSION），不在这里读写。
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS } from './lib/web-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const CHECK_ONLY = process.argv.includes('--check');
const RELEASE = Boolean(process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME?.startsWith('v'));
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);

function readJson(rel, base = ROOT) {
  const p = join(base, rel);
  if (!existsSync(p)) fail(`缺少 ${base === APP ? 'app/' : ''}${rel}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { fail(`${rel} 不是合法 JSON：${e.message}`); }
}

const app = readJson('app.json', APP);
const lock = readJson('app.lock.json');

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
    errors.push(`app.json 不接受字段 "${k}"（包名放 app.lock.json，外观/业务入口见 clever-vpn-docs 的 app-json 契约）`);
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
if (typeof app.tagline === 'string' && /[\r\n]/.test(app.tagline)) errors.push('app.json: tagline 不支持换行');
if (app.tagline !== undefined && typeof app.tagline !== 'string') errors.push('app.json: tagline 必须是字符串（可留空）');
if (typeof app.color !== 'string' || !hexColor.test(app.color)) errors.push('app.json: color 必须是 #rrggbb');

if (typeof app.name === 'string' && app.name.length > 24) warnings.push(`app.json: name 建议 ≤ 24 字符（当前 ${app.name.length}）`);
if (typeof app.short_name === 'string' && app.short_name.length > 12) warnings.push(`app.json: short_name 建议 ≤ 12 字符（当前 ${app.short_name.length}）`);
if (typeof app.tagline === 'string' && app.tagline.length > 24) warnings.push(`app.json: tagline 建议 ≤ 24 字符（当前 ${app.tagline.length}）`);

/** 品牌素材路径：app/ 内相对路径，且只能在 assets/ 或 web/ 下 */
function brandPath(value, field, fallback) {
  const p = typeof value === 'string' && value ? value : fallback;
  if (p.startsWith('/') || p.includes('\\') || p.split('/').some((s) => s === '..')) {
    errors.push(`app.json: ${field} 必须是 app/ 内相对路径（不得绝对路径 / .. / 仓库外）：${p}`);
    return null;
  }
  if (!p.startsWith('assets/') && !p.startsWith('web/')) {
    errors.push(`app.json: ${field} 必须位于 app/assets/ 或 app/web/ 下：${p}`);
    return null;
  }
  if (!existsSync(join(APP, p))) {
    errors.push(`app.json: ${field} 指向的文件不存在：app/${p}`);
    return null;
  }
  return p;
}

function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 26 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

// ── 图标（app/assets/icon.png 或 app.json.icon）──
const iconPath = brandPath(app.icon, 'icon', 'assets/icon.png');
if (iconPath) {
  const buf = readFileSync(join(APP, iconPath));
  const info = pngInfo(buf);
  if (!info) errors.push(`app/${iconPath} 不是 PNG 文件`);
  else {
    if (info.width !== 1024 || info.height !== 1024) errors.push(`app/${iconPath} 必须是 1024×1024（当前 ${info.width}×${info.height}）`);
    if (info.colorType === 4 || info.colorType === 6) errors.push(`app/${iconPath} 必须无透明通道（App Store 会拒绝带 alpha 的图标）`);
    if (buf.length > LIMITS.fileBytes) errors.push(`app/${iconPath} 不能超过 1MB（当前 ${(buf.length / 1024 / 1024).toFixed(2)}MB）`);
  }
} else if (!RELEASE) {
  warnings.push('缺少可用图标：开发构建可以继续，正式出包会失败');
}

// ── logo（界面里的品牌标记；不填回落到 icon）──
const logoPath = brandPath(app.logo, 'logo', iconPath || 'assets/icon.png');
let logoUrl = '';
if (logoPath) {
  const ext = extname(logoPath).toLowerCase();
  const size = statSync(join(APP, logoPath)).size;
  if (ext !== '.png' && ext !== '.svg') errors.push(`app/${logoPath}: logo 只收 PNG 或 SVG`);
  if (size > 256 * 1024) errors.push(`app/${logoPath}: logo 不能超过 256KB（当前 ${(size / 1024).toFixed(0)}KB）`);
  if (ext === '.png') {
    const info = pngInfo(readFileSync(join(APP, logoPath)));
    if (!info) errors.push(`app/${logoPath}: 不是合法的 PNG 文件`);
    else if (info.width !== info.height) errors.push(`app/${logoPath}: PNG logo 必须是正方形（当前 ${info.width}×${info.height}）`);
  }
  // 产物内的相对 URL：web/ 下的文件原样，assets/ 下的拷到 web/_brand-logo.<ext>
  logoUrl = logoPath.startsWith('web/') ? logoPath.slice('web/'.length) : `_brand-logo${ext}`;
}

const crm = app.crm ?? {};
if (crm.base) {
  if (!httpsUrl.test(crm.base) || crm.base.endsWith('/')) errors.push('app.json: crm.base 必须是 https:// 开头且无尾斜杠（或留空）');
}
if (crm.id && !uuid.test(crm.id)) errors.push('app.json: crm.id 必须是 UUID（或留空）');
if (crm.base && !crm.id) warnings.push('crm.base 已填但 crm.id 为空：无法比对实例标识（见 clients.md §7.1）');
if (crm.id && !crm.base) warnings.push('crm.id 已填但 crm.base 为空：该值不会生效');

for (const [k, v] of Object.entries(app.links ?? {})) {
  if (v && !httpsUrl.test(v)) warnings.push(`links.${k} 建议用 https:// 链接`);
}
if (RELEASE) {
  for (const k of ['privacy', 'terms']) {
    if (!app.links?.[k]) warnings.push(`发布构建：links.${k} 为空。上架应用商店前必须补齐（见 docs/TENANT-GUIDE.md 的发布清单）`);
  }
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

const webEntry = join(APP, 'web', 'index.html');
if (!existsSync(webEntry)) errors.push('缺少 app/web/index.html');

// UI 必须自包含：不允许外链脚本/样式（离线也要能用）
const html = existsSync(webEntry) ? readFileSync(webEntry, 'utf8') : '';
const external = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (external.length) errors.push(`app/web/index.html 引用了外部资源（离线不可用）：${external.join(', ')}`);

// ── crm.base / crm.id 构建期门禁（clients.md §7.1）──
// 可达 + 已初始化 + 标识一致。不可达在 RELEASE 时阻塞（网络抖动不该红掉每个 PR）；
// 标识不一致是确定的配置错误，任何时候都阻塞。
async function crmGate() {
  if (!crm.base) return;
  const url = `${crm.base}/api/app/v1/meta`;
  let meta;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    meta = await res.json();
  } catch (e) {
    const msg = `CRM 不可达（${url}）：${e.message}${crm.base ? '；检查 crm.base 是否拼错 / 实例是否在线' : ''}`;
    if (RELEASE) errors.push(msg);
    else warnings.push(`${msg}（发布构建会失败）`);
    return;
  }
  if (!meta || !meta.crm_id) {
    const msg = `CRM 尚未初始化（${url} 没有 crm_id）：先在 CRM 完成首次设置`;
    if (RELEASE) errors.push(msg);
    else warnings.push(`${msg}（发布构建会失败）`);
    return;
  }
  if (crm.id && meta.crm_id !== crm.id) {
    errors.push(
      `crm.id 与 CRM 实例不一致：app.json=${crm.id}，${url} 返回 ${meta.crm_id}。` +
      '配错会让用户在别人的 CRM 上注册和付款（clients.md §7.1）',
    );
    return;
  }
  ok(`CRM 实例比对通过（crm_id=${meta.crm_id}）`);
}

if (errors.length) {
  warnings.forEach((w) => warn(w));
  console.error('✗ 配置校验失败：');
  errors.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}

await crmGate();

warnings.forEach((w) => warn(w));
if (errors.length) {
  console.error('✗ 配置校验失败：');
  errors.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}
ok('app/app.json / app.lock.json / 图标 / logo 校验通过');

if (CHECK_ONLY) { console.log('  ✓ check 模式：未生成产物'); process.exit(0); }

// ── 注入 ──
const brand = {
  name: app.name,
  short_name: app.short_name,
  tagline: typeof app.tagline === 'string' ? app.tagline : '',
  color: app.color,
  logo: logoUrl,
  crm: { base: crm.base || '', id: crm.id || '' },
  links: {
    terms: app.links?.terms || '',
    privacy: app.links?.privacy || '',
    support: app.links?.support || '',
    website: app.links?.website || '',
  },
};
const brandJs = `/* 由 scripts/build.mjs 从 app/app.json 生成，请勿手改 */\nwindow.BRAND = ${JSON.stringify(brand, null, 2)};\n`;

// 品牌标记：assets/ 下的文件拷一份到 web/（产物内相对 URL）；web/ 下的原样使用
if (logoPath && logoPath.startsWith('assets/')) {
  copyFileSync(join(APP, logoPath), join(APP, 'web', logoUrl));
  ok(`拷贝 app/${logoPath} → app/web/${logoUrl}`);
}
writeFileSync(join(APP, 'web', '_brand.js'), brandJs);
ok('生成 app/web/_brand.js');

// ── 产物 ──
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(APP, 'web'), join(dist, 'web'), { recursive: true });
writeFileSync(join(dist, 'web', '_brand.js'), brandJs);
// 图标唯一输入：各壳的 ci 脚本从 dist/icon.png 生成平台图标，不读 app.json
if (iconPath) {
  copyFileSync(join(APP, iconPath), join(dist, 'icon.png'));
  ok('拷贝图标 → dist/icon.png');
}

const version = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || 'dev';
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
  name: brand.name,
  version,
  crm: brand.crm,
  bundle_id: lock.bundle_id,
  lock_version: lock.lock_version,
  source_revision: lock.source_revision ?? null,
  built_at: new Date().toISOString(),
}, null, 2) + '\n');

ok(`产物输出到 dist/（版本 ${version}）`);
console.log('\n下一步：在 shells/windows / shells/macos / shells/android 中把 dist/web 打进安装包。');
