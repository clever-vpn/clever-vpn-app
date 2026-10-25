#!/usr/bin/env node
/**
 * web/ 契约校验 —— 实现 docs/contracts/studio-app.md §2 的静态约束。
 *
 * 用法：
 *   node scripts/check-web.mjs                  # 只看结果
 *   node scripts/check-web.mjs --report r.json  # 同时写出报告
 *
 * 退出码：0 = 通过（允许 warn），1 = 有违规，2 = 用法/环境错误。
 *
 * 定位：这是 CI 门禁（.github/workflows/validate.yml 的 `web-contract` job）。
 * 本脚本只做**静态**判定，不启动浏览器；运行时行为（能否加载、点击流、
 * console 是否干净）由 `web-smoke` job 判定。两个 job 一起构成唯一判决。
 *
 * 设计取舍：不引入任何依赖（不用 acorn / postcss / parse5）。
 * 静态检查只负责"一眼就能看出的错"，语义正确性交给真跑一遍。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const CONTRACT = 2; // studio-app.md 的 studio_contract 版本

/** 归档规模上限（studio-app.md §1；只放宽不升版，收紧要升版） */
const LIMITS = { fileBytes: 1_000_000, totalBytes: 8_000_000, files: 200, depth: 3 };

/** bridge@1 白名单 */
const BRIDGE_METHODS = new Set(['connect', 'disconnect', 'state', 'on']);
const ERROR_CODES = ['EXPIRED', 'FROZEN', 'DEVICE_LIMIT', 'NETWORK', 'INTERNAL'];
/** FROZEN 必须中性文案（bridge@1 §3） */
const FROZEN_BANNED = /违规|封禁|作弊|滥用|违反/;

const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt']);
/** 构建产物，不参与校验（gitignore 里也是它） */
const SKIP_FILES = new Set(['_brand.js']);

const args = process.argv.slice(2);
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;

const violations = [];
const checks = new Map();
const notes = [];

function record(id, ok, detail) {
  const prev = checks.get(id);
  if (prev && prev.status === 'fail') return; // 已有失败，保持失败
  checks.set(id, { id, status: ok ? 'pass' : 'fail', detail });
}
function warn(id, detail) {
  if (checks.get(id)?.status === 'fail') return;
  checks.set(id, { id, status: 'warn', detail });
}
function fail(id, file, line, message) {
  violations.push({ id, file, line: line || 0, message });
  record(id, false, message);
}

// ── 收集文件 ──────────────────────────────────────────────
if (!existsSync(WEB)) {
  console.error('✗ 找不到 web/ 目录');
  process.exit(2);
}

/** @type {{abs:string, rel:string, size:number}[]} */
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') {
      fail('web.limits', rel(dir, name), 0, '不要提交 .DS_Store');
      continue;
    }
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
    else files.push({ abs, rel: rel(WEB, abs), size: st.size });
  }
})(WEB);

function rel(base, abs) {
  return abs.slice(base.length + 1);
}

const textFiles = files.filter(
  (f) => TEXT_EXT.has(extname(f.rel).toLowerCase()) && !SKIP_FILES.has(f.rel),
);

function readText(f) {
  return readFileSync(f.abs, 'utf8');
}

/** 返回 [行号, 行文本] 列表，用于定位违规 */
function linesOf(text) {
  return text.split('\n').map((t, i) => [i + 1, t]);
}

// ── web.limits ───────────────────────────────────────────
{
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (f.size > LIMITS.fileBytes) {
      fail('web.limits', f.rel, 0, `单文件 ${f.size} B 超过上限 ${LIMITS.fileBytes} B`);
    }
    const depth = f.rel.split('/').length - 1;
    if (depth > LIMITS.depth) {
      fail('web.limits', f.rel, 0, `目录深度 ${depth} 超过上限 ${LIMITS.depth}`);
    }
  }
  if (files.length > LIMITS.files) {
    fail('web.limits', 'web/', 0, `文件数 ${files.length} 超过上限 ${LIMITS.files}`);
  }
  if (total > LIMITS.totalBytes) {
    fail('web.limits', 'web/', 0, `总量 ${total} B 超过上限 ${LIMITS.totalBytes} B`);
  }
  record('web.limits', true, `${files.length} 个文件 / ${total} B`);

  if (!files.some((f) => f.rel === 'index.html')) {
    fail('web.limits', 'web/index.html', 0, 'web/ 根必须存在 index.html');
  }
}

// ── assets.no-external ────────────────────────────────────
const EXTERNAL_PATTERNS = [
  [/<script[^>]+\bsrc\s*=\s*["'](?:https?:)?\/\//gi, '外部脚本'],
  [/<link[^>]+\bhref\s*=\s*["'](?:https?:)?\/\//gi, '外部样式/资源'],
  [/<img[^>]+\bsrc\s*=\s*["'](?:https?:)?\/\//gi, '外部图片'],
  [/url\(\s*["']?(?:https?:)?\/\//gi, 'CSS url() 指向外部'],
  [/@import\s+(?:url\()?\s*["'](?:https?:)?\/\//gi, 'CSS @import 指向外部'],
  [/\bfrom\s*["'](?:https?:)?\/\//gi, 'ES module 从外部 import'],
  [/\bimport\s*\(\s*["'](?:https?:)?\/\//gi, '动态 import 指向外部'],
];
{
  let hit = 0;
  for (const f of textFiles) {
    for (const [ln, text] of linesOf(readText(f))) {
      for (const [re, label] of EXTERNAL_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(text)) {
          fail('assets.no-external', f.rel, ln, `${label}（离线环境必须可用）`);
          hit++;
        }
      }
    }
  }
  if (!hit) record('assets.no-external', true, '未发现外部资源引用');
}

// ── bridge.methods / 原生注入点 ───────────────────────────
const NATIVE_HOOKS = [
  [/chrome\s*\.\s*webview/i, '直接使用 WebView2 的 postMessage（必须走 bridge）'],
  [/webkit\s*\.\s*messageHandlers/i, '直接使用 WKWebView messageHandlers（必须走 bridge）'],
  [/\bBridge\s*\.\s*postMessage/i, '直接使用 Android Bridge.postMessage（必须走 bridge）'],
];
{
  let ok = true;
  for (const f of textFiles) {
    for (const [ln, text] of linesOf(readText(f))) {
      for (const [re, msg] of NATIVE_HOOKS) {
        if (re.test(text)) {
          fail('bridge.methods', f.rel, ln, msg);
          ok = false;
        }
      }
      // bridge.<name>( / BRIDGE.<name>(（下划线开头的是内部字段/回调，不是契约方法）
      for (const m of text.matchAll(/\b(?:bridge|BRIDGE)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (name.startsWith('_')) continue;
        if (!BRIDGE_METHODS.has(name)) {
          fail('bridge.methods', f.rel, ln, `bridge.${name}() 不在 bridge@1 白名单内（只允许 ${[...BRIDGE_METHODS].join(' / ')}）`);
          ok = false;
        }
      }
    }
  }
  if (ok) record('bridge.methods', true, '只使用了 bridge@1 白名单方法');
}

// ── bridge.state-on-load（静态近似）────────────────────────
{
  const entry = textFiles.find((f) => f.rel === 'index.html');
  const text = entry ? readText(entry) : '';
  if (/\b(?:bridge|BRIDGE)\s*\.\s*state\s*\(/.test(text)) {
    record('bridge.state-on-load', true, 'index.html 调用了 state()');
  } else {
    fail('bridge.state-on-load', 'index.html', 0, '页面加载后必须调用一次 state()（事件不会重放）');
  }
}

// ── bridge.error-copy ─────────────────────────────────────
{
  const all = textFiles.map(readText).join('\n');
  const missing = ERROR_CODES.filter((c) => !all.includes(c));
  if (missing.length) {
    fail('bridge.error-copy', 'web/', 0, `缺少错误码文案：${missing.join(', ')}`);
  } else {
    record('bridge.error-copy', true, `${ERROR_CODES.length} 个错误码都有文案`);
  }
}

// ── bridge.frozen-neutral ─────────────────────────────────
{
  let ok = true;
  for (const f of textFiles) {
    for (const [ln, text] of linesOf(readText(f))) {
      if (text.includes('FROZEN') && FROZEN_BANNED.test(text)) {
        fail('bridge.frozen-neutral', f.rel, ln, 'FROZEN 文案必须中性（不得出现违规/封禁等定性表述）');
        ok = false;
      }
    }
  }
  if (ok) record('bridge.frozen-neutral', true, '未发现定性表述');
}

// ── brand.from-window-brand ───────────────────────────────
{
  let app;
  try {
    app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
  } catch (e) {
    console.error(`✗ 读不到 app.json：${e.message}`);
    process.exit(2);
  }
  const literals = [
    ['name', app.name],
    ['short_name', app.short_name],
    ['color', app.color],
  ].filter(([, v]) => typeof v === 'string' && v.length > 0);

  let ok = true;
  for (const f of textFiles) {
    const text = readText(f);
    for (const [field, value] of literals) {
      if (!text.includes(value)) continue;
      if (f.rel === 'index.html') {
        const count = text.split(value).length - 1;
        if (count > 3) {
          warn('brand.from-window-brand', `index.html 里 ${field} 出现 ${count} 次，建议只保留兜底默认值`);
        }
      } else {
        fail('brand.from-window-brand', f.rel, 0, `${field} 字面量「${value}」只能出现在 index.html 的兜底默认值里，其它文件请读 window.BRAND`);
        ok = false;
      }
    }
  }
  if (ok) record('brand.from-window-brand', true, '品牌值只来自 window.BRAND');
}

// ── runtime.*（不在本脚本判定）─────────────────────────────
notes.push('runtime.console-clean / 点击流：由 web-smoke（Playwright）判定，见 validate.yml');

// ── 输出 ──────────────────────────────────────────────────
const ok = violations.length === 0;
const list = [...checks.values()];

console.log(`\nweb/ 契约校验（studio_contract ${CONTRACT}）\n`);
for (const c of list) {
  const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
  console.log(`  ${mark} ${c.id.padEnd(26)} ${c.detail ?? ''}`);
}
if (violations.length) {
  console.log('\n违规：');
  for (const v of violations) {
    console.log(`  ${v.file}${v.line ? `:${v.line}` : ''}  [${v.id}] ${v.message}`);
  }
}
for (const n of notes) console.log(`\n  · ${n}`);

console.log(ok ? '\n✓ 通过\n' : `\n✗ 未通过（${violations.length} 处）\n`);

if (reportPath) {
  const out = reportPath.startsWith('/') ? reportPath : join(ROOT, reportPath);
  writeFileSync(
    out,
    JSON.stringify(
      {
        studio_contract: CONTRACT,
        ok,
        checks: list,
        violations,
        toolchain: { runtime: `node ${process.version}`, generator: 'scripts/check-web.mjs@1', engines: [] },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  报告：${reportPath}\n`);
}

process.exit(ok ? 0 : 1);
