/**
 * web/ 契约闸门 —— 单一实现（纯函数，**不得** import fs / node:*）
 *
 * 真源：clever-vpn-app/scripts/lib/web-check.mjs
 * 用法：
 *   CI / 本地     scripts/check-web.mjs 读盘后调用 runWebCheck()
 *   studio       逐字节副本 src/gate/web-check.mjs（WEB_CHECK_ID = 该文件 sha256 前 16 位）
 *   写路径        checkFiles() 只做"能不能写"的规模/路径/外链判定
 *
 * 契约：clever-vpn-docs 的 `app-studio-app`（studio_contract 4）+ `app-json`。
 * 本文件不定义业务，只实现契约 §4 的 check id 全表。
 */

/** 归档规模上限（app-studio-app §4；只放宽不升版，收紧要升版） */
export const LIMITS = { fileBytes: 1_000_000, totalBytes: 8_000_000, files: 200, depth: 3 };

/** 模板包/契约版本（template.json 与 app-studio-app 同号） */
export const STUDIO_CONTRACT = 4;
export const BRIDGE_VERSION = 2;

/** bridge@2 方法白名单（decisions §10）；下划线开头的内部字段放行 */
export const BRIDGE_METHODS = [
  'capabilities', 'activate', 'deactivate', 'lines', 'setLine', 'connect',
  'disconnect', 'state', 'settings', 'setProtocol', 'setSplit', 'open', 'on',
];

export const ERROR_CODES = ['EXPIRED', 'FROZEN', 'DEVICE_LIMIT', 'NETWORK', 'INTERNAL'];

/** app.css 必须定义的 8 个品牌变量（UI-PRINCIPLES R1） */
export const BRAND_VARS = ['--brand', '--bg', '--surface', '--text', '--dim', '--radius', '--gap', '--font'];

/** app.json 白名单（app-json §1） */
export const APP_KEYS = ['name', 'short_name', 'tagline', 'color', 'icon', 'logo', 'crm', 'links'];
export const CRM_KEYS = ['base', 'id'];
export const LINK_KEYS = ['terms', 'privacy', 'support', 'website'];

/** FROZEN 必须中性（bridge@2 §3） */
const FROZEN_BANNED = /违规|封禁|作弊|滥用|违反/;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_URL = /^https:\/\/[^\s]+$/;

export const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
const ASSET_EXT = new Set([...TEXT_EXT, '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);

/** 构建产物：由 build.mjs 生成，不参与契约判定（gitignore 里也是它） */
const GENERATED = new Set(['web/_brand.js']);
const GENERATED_PREFIX = 'web/_brand-logo.';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

function baseName(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** 安全相对路径：不以 / 开头、不带盘符、无反斜杠、无 .. 段 */
function isSafeRelative(path) {
  if (typeof path !== 'string' || !path) return false;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path)) return false;
  return !path.split('/').some((seg) => seg === '..' || seg === '');
}

function isUnder(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}

/** 统一成 [{path, content, bytes}]；content 是文本，bytes 是 Uint8Array */
function normalize(files) {
  // 同一路径出现多次时后者覆盖前者（调用方传"整份文件集"不该重复；测试用例靠它做覆盖）
  const byPath = new Map();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.path !== 'string') continue;
    const bytes = f.bytes instanceof Uint8Array ? f.bytes
      : f.bytes instanceof ArrayBuffer ? new Uint8Array(f.bytes)
        : null;
    byPath.set(f.path.replace(/^\.\//, ''), {
      path: f.path.replace(/^\.\//, ''),
      content: typeof f.content === 'string' ? f.content : null,
      bytes,
    });
  }
  return [...byPath.values()];
}

function makeCtx() {
  const checks = new Map();
  const violations = [];
  const ctx = {
    checks,
    violations,
    pass(id, detail) {
      if (checks.get(id)?.status === 'fail') return;
      checks.set(id, { id, status: 'pass', detail });
    },
    warn(id, detail) {
      if (checks.get(id)?.status === 'fail') return;
      checks.set(id, { id, status: 'warn', detail });
    },
    fail(id, path, line, message) {
      violations.push({ id, path, line: line || 0, message });
      checks.set(id, { id, status: 'fail', detail: message });
    },
  };
  return ctx;
}

function finish(ctx) {
  return {
    ok: ctx.violations.length === 0,
    checks: [...ctx.checks.values()],
    violations: ctx.violations,
  };
}

function textFiles(files) {
  return files.filter((f) => f.content !== null && !GENERATED.has(f.path) && TEXT_EXT.has(extOf(f.path)));
}

function linesOf(text) {
  return text.split('\n').map((t, i) => [i + 1, t]);
}

/** 读 PNG 头：宽 / 高 / colorType（4、6 带 alpha） */
function pngInfo(bytes) {
  if (!bytes || bytes.length < 26) return null;
  for (let i = 0; i < PNG_SIG.length; i += 1) if (bytes[i] !== PNG_SIG[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25] };
}

// ── web.limits / web.paths ────────────────────────────────────────────────

function checkWebFiles(ctx, web, limits, { requireIndex = true } = {}) {
  const lim = { ...LIMITS, ...(limits || {}) };
  let total = 0;
  let bad = false;
  for (const f of web) {
    const size = f.bytes ? f.bytes.byteLength : (f.content ? new TextEncoder().encode(f.content).byteLength : 0);
    total += size;
    if (size > lim.fileBytes) {
      bad = true;
      ctx.fail('web.limits', f.path, 0, `单文件 ${size} B 超过上限 ${lim.fileBytes} B`);
    }
    const depth = f.path.split('/').length - 2;
    if (depth > lim.depth) {
      bad = true;
      ctx.fail('web.limits', f.path, 0, `目录深度 ${depth} 超过上限 ${lim.depth}`);
    }
    if (baseName(f.path) === '.DS_Store') {
      bad = true;
      ctx.fail('web.limits', f.path, 0, '不要提交 .DS_Store');
    }
  }
  if (web.length > lim.files) {
    bad = true;
    ctx.fail('web.limits', 'web/', 0, `文件数 ${web.length} 超过上限 ${lim.files}`);
  }
  if (total > lim.totalBytes) {
    bad = true;
    ctx.fail('web.limits', 'web/', 0, `总量 ${total} B 超过上限 ${lim.totalBytes} B`);
  }
  if (!bad) ctx.pass('web.limits', `${web.length} 个文件 / ${total} B`);

  let pathsOk = true;
  for (const f of web) {
    if (!isSafeRelative(f.path.replace(/^web\//, ''))) {
      pathsOk = false;
      ctx.fail('web.paths', f.path, 0, '路径必须是相对路径，且不含 .. / 反斜杠 / 盘符');
      continue;
    }
    if (GENERATED.has(f.path) || f.path.startsWith(GENERATED_PREFIX)) continue;
    const ext = extOf(f.path);
    if (!ASSET_EXT.has(ext)) {
      pathsOk = false;
      ctx.fail('web.paths', f.path, 0, `后缀 ${ext || '(无)'} 不在允许清单内（html/css/js/mjs/json/svg/txt/xml/webmanifest + 图片/字体）`);
    }
  }
  if (pathsOk) ctx.pass('web.paths', '路径与后缀都在白名单内');

  if (!requireIndex) return;
  if (web.some((f) => f.path === 'web/index.html')) ctx.pass('web.index', 'web/index.html 存在');
  else ctx.fail('web.index', 'web/index.html', 0, '缺少 web/index.html（入口）');
}

// ── assets.no-external ────────────────────────────────────────────────────

const EXTERNAL_PATTERNS = [
  [/<script[^>]+\bsrc\s*=\s*["'](?:https?:)?\/\//gi, '外部脚本'],
  [/<link[^>]+\bhref\s*=\s*["'](?:https?:)?\/\//gi, '外部样式/资源'],
  [/<img[^>]+\bsrc\s*=\s*["'](?:https?:)?\/\//gi, '外部图片'],
  [/url\(\s*["']?(?:https?:)?\/\//gi, 'CSS url() 指向外部'],
  [/@import\s+(?:url\()?\s*["'](?:https?:)?\/\//gi, 'CSS @import 指向外部'],
  [/\bfrom\s*["'](?:https?:)?\/\//gi, 'ES module 从外部 import'],
  [/\bimport\s*\(\s*["'](?:https?:)?\/\//gi, '动态 import 指向外部'],
];

function checkNoExternal(ctx, texts) {
  let hit = 0;
  for (const f of texts) {
    for (const [ln, text] of linesOf(f.content)) {
      for (const [re, label] of EXTERNAL_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(text)) {
          hit += 1;
          ctx.fail('assets.no-external', f.path, ln, `${label}（离线环境必须可用）`);
        }
      }
    }
  }
  if (!hit) ctx.pass('assets.no-external', '未发现外部资源引用');
}

// ── bridge.* ──────────────────────────────────────────────────────────────

const NATIVE_HOOKS = [
  [/chrome\s*\.\s*webview/i, '直接使用 WebView2 的 postMessage（必须走 bridge）'],
  [/webkit\s*\.\s*messageHandlers/i, '直接使用 WKWebView messageHandlers（必须走 bridge）'],
  [/\bBridge\s*\.\s*postMessage/i, '直接使用 Android Bridge.postMessage（必须走 bridge）'],
];

function checkBridge(ctx, texts, bridgeVersion) {
  const allowed = new Set(BRIDGE_METHODS);
  let methodsOk = true;

  if (bridgeVersion !== BRIDGE_VERSION) {
    methodsOk = false;
    ctx.fail('bridge.methods', 'web/', 0, `模板按 bridge@${BRIDGE_VERSION} 编写，不认识 bridge@${bridgeVersion}`);
  }

  for (const f of texts) {
    for (const [ln, text] of linesOf(f.content)) {
      for (const [re, msg] of NATIVE_HOOKS) {
        if (re.test(text)) {
          methodsOk = false;
          ctx.fail('bridge.methods', f.path, ln, msg);
        }
      }
      for (const m of text.matchAll(/\b(?:bridge|BRIDGE)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (name.startsWith('_')) continue;
        if (!allowed.has(name)) {
          methodsOk = false;
          ctx.fail('bridge.methods', f.path, ln, `bridge.${name}() 不在 bridge@${BRIDGE_VERSION} 白名单内（只允许 ${BRIDGE_METHODS.join(' / ')}）`);
        }
      }
    }
  }
  if (methodsOk) ctx.pass('bridge.methods', `只使用了 bridge@${BRIDGE_VERSION} 白名单方法`);

  const entry = texts.find((f) => f.path === 'web/index.html');
  if (entry && /\b(?:bridge|BRIDGE)\s*\.\s*state\s*\(/.test(entry.content)) {
    ctx.pass('bridge.state-on-load', 'index.html 调用了 state()');
  } else {
    ctx.fail('bridge.state-on-load', 'web/index.html', 0, '页面加载后必须调用一次 state()（事件不会重放）');
  }

  const all = texts.map((f) => f.content).join('\n');
  const missing = ERROR_CODES.filter((c) => !all.includes(c));
  if (missing.length) ctx.fail('bridge.error-copy', 'web/', 0, `缺少错误码文案：${missing.join(', ')}`);
  else ctx.pass('bridge.error-copy', `${ERROR_CODES.length} 个错误码都有文案`);

  let frozenOk = true;
  for (const f of texts) {
    for (const [ln, text] of linesOf(f.content)) {
      if (text.includes('FROZEN') && FROZEN_BANNED.test(text)) {
        frozenOk = false;
        ctx.fail('bridge.frozen-neutral', f.path, ln, 'FROZEN 文案必须中性（不得出现违规/封禁等定性表述）');
      }
    }
  }
  if (frozenOk) ctx.pass('bridge.frozen-neutral', '未发现定性表述');
}

// ── brand.* ───────────────────────────────────────────────────────────────

function checkBrandVars(ctx, texts) {
  const css = texts.find((f) => f.path === 'web/app.css');
  if (!css) {
    ctx.fail('brand.vars', 'web/app.css', 0, '缺少 web/app.css（8 个品牌变量的落脚点）');
    return;
  }
  const declared = new Set();
  for (const [, line] of linesOf(css.content)) {
    const m = line.match(/^\s*(--[\w-]+)\s*:/);
    if (m) declared.add(m[1]);
  }
  const missing = BRAND_VARS.filter((v) => !declared.has(v));
  if (missing.length) {
    ctx.fail('brand.vars', 'web/app.css', 0, `必须定义 ${BRAND_VARS.length} 个品牌变量，缺少 ${missing.join(', ')}`);
    return;
  }

  let ok = true;
  for (const [ln, line] of linesOf(css.content)) {
    if (!/#[0-9a-f]{6}\b/i.test(line)) continue;
    if (/^\s*--[\w-]+\s*:/.test(line)) continue;
    ok = false;
    ctx.fail('brand.vars', 'web/app.css', ln, '色值只能出现在品牌变量声明里（页面用 var(--brand) 等）');
  }
  if (ok) ctx.pass('brand.vars', `${BRAND_VARS.length} 个品牌变量已定义，变量区外无硬编码色值`);
}

function brandLiterals(app) {
  if (!app || typeof app !== 'object') return [];
  return [
    ['name', app.name],
    ['short_name', app.short_name],
    ['tagline', app.tagline],
    ['color', app.color],
  ].filter(([, v]) => typeof v === 'string' && v.length > 0);
}

function checkBrandLiterals(ctx, texts, app) {
  const literals = brandLiterals(app);
  let ok = true;
  for (const f of texts) {
    for (const [field, value] of literals) {
      if (!f.content.includes(value)) continue;
      if (f.path === 'web/index.html') {
        const count = f.content.split(value).length - 1;
        if (count > 3) {
          ctx.warn('brand.from-window-brand', `index.html 里 ${field} 出现 ${count} 次，只应保留兜底默认值`);
        }
        continue;
      }
      if (f.path === 'web/app.css') {
        // 品牌变量区允许放兜底值（运行时会被 window.BRAND.color 覆盖）
        const badLines = linesOf(f.content).filter(([, line]) => line.includes(value) && !/^\s*--[\w-]+\s*:/.test(line));
        if (!badLines.length) continue;
        ok = false;
        ctx.fail('brand.from-window-brand', f.path, badLines[0][0], `${field} 字面量「${value}」只能出现在品牌变量声明里`);
        continue;
      }
      ok = false;
      ctx.fail('brand.from-window-brand', f.path, 0, `${field} 字面量「${value}」只能出现在 index.html 的兜底默认值里，其它文件请读 window.BRAND`);
    }
  }
  if (ok) ctx.pass('brand.from-window-brand', '品牌值只来自 window.BRAND');
}

// ── a11y.basic ────────────────────────────────────────────────────────────

function checkA11y(ctx, web) {
  let ok = true;
  for (const f of web.filter((x) => extOf(x.path) === '.html' && x.content !== null)) {
    const html = f.content;
    if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) {
      ok = false;
      ctx.fail('a11y.basic', f.path, 0, '<html> 必须带 lang（当前模板为 zh-CN）');
    }
    if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) {
      ok = false;
      ctx.fail('a11y.basic', f.path, 0, '缺少 <meta name="viewport">（移动端会按桌面宽度缩放）');
    }
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/.test(m[0])) {
        ok = false;
        const line = html.slice(0, m.index).split('\n').length;
        ctx.fail('a11y.basic', f.path, line, '<img> 必须带 alt（装饰图用 alt=""）');
      }
    }
  }
  if (ok) ctx.pass('a11y.basic', '每页都有 lang / viewport / img alt');
}

// ── app.config / app.icon / app.logo ──────────────────────────────────────

function parseAppJson(appJson) {
  if (typeof appJson === 'string') {
    try {
      return { app: JSON.parse(appJson), error: null };
    } catch (e) {
      return { app: null, error: e.message };
    }
  }
  if (appJson === undefined || appJson === null) return { app: null, error: null };
  return { app: appJson, error: null };
}

function checkAppConfig(ctx, app, error) {
  if (error) {
    ctx.fail('app.config', 'app.json', 0, `app.json 不是合法 JSON：${error}`);
    return;
  }
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    ctx.fail('app.config', 'app.json', 0, '缺少 app.json');
    return;
  }

  let ok = true;
  for (const k of Object.keys(app)) {
    if (!APP_KEYS.includes(k)) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, `不接受字段 "${k}"（包名放 app.lock.json，核心版本放 kit/kit.version）`);
    }
  }
  for (const k of ['name', 'short_name']) {
    if (typeof app[k] !== 'string' || !app[k].trim()) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, `${k} 必填且为非空字符串`);
    }
  }
  if (typeof app.tagline === 'string') {
    if (app.tagline.includes('\n') || app.tagline.includes('\r')) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, 'tagline 不支持换行');
    }
  } else if (app.tagline !== undefined) {
    ok = false;
    ctx.fail('app.config', 'app.json', 0, 'tagline 必须是字符串（可留空）');
  }
  if (typeof app.color !== 'string' || !HEX_COLOR.test(app.color)) {
    ok = false;
    ctx.fail('app.config', 'app.json', 0, 'color 必须是 #rrggbb');
  }

  for (const [key, keys, label] of [['crm', CRM_KEYS, 'crm'], ['links', LINK_KEYS, 'links']]) {
    const obj = app[key];
    if (obj === undefined) continue;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, `${label} 必须是对象`);
      continue;
    }
    for (const k of Object.keys(obj)) {
      if (!keys.includes(k)) {
        ok = false;
        ctx.fail('app.config', 'app.json', 0, `${label} 不接受字段 "${k}"`);
      }
    }
  }

  const crm = app.crm && typeof app.crm === 'object' ? app.crm : {};
  if (crm.base) {
    if (!HTTPS_URL.test(crm.base) || crm.base.endsWith('/')) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, 'crm.base 必须是 https:// 开头且无尾斜杠（或留空）');
    }
  }
  if (crm.id && !UUID.test(crm.id)) {
    ok = false;
    ctx.fail('app.config', 'app.json', 0, 'crm.id 必须是 UUID（或留空）');
  }

  const links = app.links && typeof app.links === 'object' ? app.links : {};
  for (const k of LINK_KEYS) {
    if (!links[k]) continue;
    if (!HTTPS_URL.test(links[k])) {
      ok = false;
      ctx.fail('app.config', 'app.json', 0, `links.${k} 必须是 https:// 链接（或留空）`);
    }
  }

  if (ok) ctx.pass('app.config', '字段白名单 / 必填 / 格式均通过');
}

function resolveBrandPath(app, key, fallback) {
  const p = typeof app?.[key] === 'string' && app[key] ? app[key] : fallback;
  if (!isSafeRelative(p)) return { path: p, error: `${key} 必须是项目内相对路径（不得绝对路径 / .. / 仓库外）` };
  if (!isUnder(p, 'assets') && !isUnder(p, 'web')) {
    return { path: p, error: `${key} 必须位于 assets/ 或 web/ 下（当前 ${p}）` };
  }
  return { path: p, error: null };
}

function checkIcon(ctx, files, app) {
  const { path, error } = resolveBrandPath(app, 'icon', 'assets/icon.png');
  if (error) {
    ctx.fail('app.icon', 'app.json', 0, error);
    return;
  }
  const f = files.find((x) => x.path === path);
  if (!f) {
    ctx.fail('app.icon', path, 0, '找不到图标文件（默认 assets/icon.png）');
    return;
  }
  if (!f.bytes) {
    ctx.fail('app.icon', path, 0, '读不到图标字节（构建与闸门都需要真实文件）');
    return;
  }
  const info = pngInfo(f.bytes);
  if (!info) {
    ctx.fail('app.icon', path, 0, '不是 PNG 文件（App Store / Play 都不接受改名而来的图标）');
    return;
  }
  let ok = true;
  if (info.width !== 1024 || info.height !== 1024) {
    ok = false;
    ctx.fail('app.icon', path, 0, `必须是 1024×1024（当前 ${info.width}×${info.height}）`);
  }
  if (info.colorType === 4 || info.colorType === 6) {
    ok = false;
    ctx.fail('app.icon', path, 0, '必须无透明通道（App Store 会拒绝带 alpha 的图标）');
  }
  if (f.bytes.byteLength > LIMITS.fileBytes) {
    ok = false;
    ctx.fail('app.icon', path, 0, `不能超过 1MB（当前 ${(f.bytes.byteLength / 1024 / 1024).toFixed(2)}MB）`);
  }
  if (ok) ctx.pass('app.icon', `1024² PNG / 无 alpha / ${(f.bytes.byteLength / 1024).toFixed(0)} KB`);
}

function checkLogo(ctx, files, app) {
  const { path, error } = resolveBrandPath(app, 'logo', typeof app?.icon === 'string' && app.icon ? app.icon : 'assets/icon.png');
  if (error) {
    ctx.fail('app.logo', 'app.json', 0, error);
    return;
  }
  const f = files.find((x) => x.path === path);
  if (!f || (!f.bytes && !f.content)) {
    ctx.fail('app.logo', path, 0, '找不到 logo 文件（不填 logo 时回落到 icon）');
    return;
  }
  const ext = extOf(path);
  if (ext !== '.png' && ext !== '.svg') {
    ctx.fail('app.logo', path, 0, 'logo 只收 PNG 或 SVG（单色矢量才能跟随主题染色）');
    return;
  }
  const size = f.bytes ? f.bytes.byteLength : new TextEncoder().encode(f.content).byteLength;
  if (size > 256 * 1024) {
    ctx.fail('app.logo', path, 0, `logo 不能超过 256KB（当前 ${(size / 1024).toFixed(0)}KB）`);
    return;
  }
  if (ext === '.png') {
    const info = pngInfo(f.bytes);
    if (!info) {
      ctx.fail('app.logo', path, 0, '不是合法的 PNG 文件');
      return;
    }
    if (info.width !== info.height) {
      ctx.fail('app.logo', path, 0, `PNG logo 必须是正方形（当前 ${info.width}×${info.height}）`);
      return;
    }
  }
  ctx.pass('app.logo', `${path}（${ext.slice(1).toUpperCase()} / ${(size / 1024).toFixed(0)} KB）`);
}

// ── 对外 API ──────────────────────────────────────────────────────────────

/**
 * 写路径复用的子集：只判"能不能写"（规模 / 路径 / 外链）。
 * @param {{files:Array<{path:string,content?:string,bytes?:Uint8Array}>, limits?:object}} input
 */
export function checkFiles({ files, limits } = {}) {
  const ctx = makeCtx();
  const list = normalize(files);
  const web = list.filter((f) => isUnder(f.path, 'web'));
  checkWebFiles(ctx, web, limits, { requireIndex: false });
  checkNoExternal(ctx, textFiles(web));
  return finish(ctx);
}

/**
 * 完整闸门（CI 与 studio 的 check_draft 共用）。
 * @param {{files:Array<{path:string,content?:string,bytes?:Uint8Array}>,
 *          appJson?:object|string, bridge?:number}} input
 */
export function runWebCheck({ files, appJson, bridge = BRIDGE_VERSION } = {}) {
  const ctx = makeCtx();
  const list = normalize(files);
  const web = list.filter((f) => isUnder(f.path, 'web'));
  const texts = textFiles(web);
  const { app, error } = parseAppJson(appJson);

  checkWebFiles(ctx, web, LIMITS);
  checkNoExternal(ctx, texts);
  checkBridge(ctx, texts, bridge);
  checkBrandVars(ctx, texts);
  checkBrandLiterals(ctx, texts, app);
  checkA11y(ctx, web);
  checkAppConfig(ctx, app, error);
  checkIcon(ctx, list, app);
  checkLogo(ctx, list, app);

  return finish(ctx);
}

/** 供报告/排障：一眼看出这是什么版本的门禁 */
export const WEB_CHECK_VERSION = 1;
