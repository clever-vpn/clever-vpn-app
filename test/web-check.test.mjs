import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWebCheck, checkFiles, LIMITS, BRAND_VARS, ERROR_CODES } from '../scripts/lib/web-check.mjs';

/**
 * 闸门纯函数库的 fixtures。
 * 每个用例只改坏一处，断言**报出的 check id** 正确 —— studio 的 check_draft 与 CI
 * 用同一份实现，所以这组断言就是"同一 fixture 给出同一组 id/status"的地基。
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 造一个只有头的 PNG（闸门只读 IHDR：宽 / 高 / colorType） */
function png(width, height, colorType = 2, size = 4096) {
  const b = Buffer.alloc(Math.max(33, size));
  Buffer.from(PNG_SIG).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[25] = colorType;
  return b;
}

const UUID = '8f3a1c2e-1b2c-4d5e-8f90-123456789abc';

function app(over = {}) {
  return {
    name: 'Acme VPN',
    short_name: 'Acme',
    tagline: '一键连接',
    color: '#1a2b3c',
    icon: 'assets/icon.png',
    crm: { base: 'https://crm.acme.example', id: UUID },
    links: { terms: '', privacy: '', support: 'https://t.me/acme', website: '' },
    ...over,
  };
}

function css() {
  return `${BRAND_VARS.map((v) => `  ${v}: inherit;`).join('\n')}
body { color: var(--text); background: var(--bg); }
`;
}

function page({ head = '', body = '', script = 'bridge.state(); bridge.on("state", function () {}); bridge.connect();' } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="app.css">${head}</head>
<body>${body}<script>${script}</script></body>
</html>`;
}

function fixture({ appJson = app(), files = [], index = {} } = {}) {
  return {
    appJson,
    files: [
      { path: 'app.json', content: JSON.stringify(appJson) },
      { path: 'assets/icon.png', bytes: png(1024, 1024, 2) },
      { path: 'web/index.html', content: page(index) },
      { path: 'web/app.css', content: css() },
      { path: 'web/ui.js', content: `/* ${ERROR_CODES.join(' ')} */\n` },
      ...files,
    ],
  };
}

function failedIds(result) {
  return [...new Set(result.violations.map((v) => v.id))].sort();
}

test('干净模板：全部 check 通过', () => {
  const r = runWebCheck(fixture());
  assert.equal(r.ok, true, JSON.stringify(r.violations, null, 2));
  assert.equal(r.checks.filter((c) => c.status === 'fail').length, 0);
  assert.ok(r.checks.some((c) => c.id === 'app.icon' && c.status === 'pass'));
});

test('app.config：未知字段', () => {
  const r = runWebCheck(fixture({ appJson: app({ bundle_id: 'x' }) }));
  assert.deepEqual(failedIds(r), ['app.config']);
});

test('app.icon：不是 1024×1024', () => {
  const r = runWebCheck(fixture({ files: [{ path: 'assets/icon.png', bytes: png(512, 512, 2) }] }));
  assert.deepEqual(failedIds(r), ['app.icon']);
});

test('app.icon：带 alpha', () => {
  const r = runWebCheck(fixture({ files: [{ path: 'assets/icon.png', bytes: png(1024, 1024, 6) }] }));
  assert.deepEqual(failedIds(r), ['app.icon']);
});

test('app.logo：PNG 不是正方形', () => {
  const r = runWebCheck(
    fixture({
      appJson: app({ logo: 'assets/logo.png' }),
      files: [{ path: 'assets/logo.png', bytes: png(100, 200, 2, 1024) }],
    }),
  );
  assert.deepEqual(failedIds(r), ['app.logo']);
});

test('brand.vars：缺一个品牌变量', () => {
  const broken = css().replace('  --radius: inherit;\n', '');
  const r = runWebCheck(fixture({ files: [{ path: 'web/app.css', content: broken }] }));
  assert.deepEqual(failedIds(r), ['brand.vars']);
});

test('brand.vars：变量区外出现 #rrggbb', () => {
  const broken = `${css()}\n.card { border-color: #123456; }\n`;
  const r = runWebCheck(fixture({ files: [{ path: 'web/app.css', content: broken }] }));
  assert.deepEqual(failedIds(r), ['brand.vars']);
});

test('brand.from-window-brand：品牌字面量出现在其它文件', () => {
  const r = runWebCheck(
    fixture({ files: [{ path: 'web/ui.js', content: `const n = 'Acme VPN';\n// ${ERROR_CODES.join(' ')}` }] }),
  );
  assert.deepEqual(failedIds(r), ['brand.from-window-brand']);
});

test('assets.no-external：外部脚本', () => {
  const r = runWebCheck(
    fixture({ index: { head: '<script src="https://cdn.example/x.js"></script>' } }),
  );
  assert.deepEqual(failedIds(r), ['assets.no-external']);
});

test('bridge.methods：白名单外的方法', () => {
  const r = runWebCheck(
    fixture({ index: { script: 'bridge.state(); bridge.hack();' } }),
  );
  assert.deepEqual(failedIds(r), ['bridge.methods']);
});

test('bridge.methods：直接触碰原生注入点', () => {
  const r = runWebCheck(
    fixture({ index: { script: 'bridge.state(); window.chrome.webview.postMessage({});' } }),
  );
  assert.deepEqual(failedIds(r), ['bridge.methods']);
});

test('bridge.state-on-load：加载后没问 state()', () => {
  const r = runWebCheck(fixture({ index: { script: 'bridge.connect();' } }));
  assert.deepEqual(failedIds(r), ['bridge.state-on-load']);
});

test('bridge.error-copy：缺错误码文案', () => {
  const r = runWebCheck(
    fixture({ files: [{ path: 'web/ui.js', content: '// only EXPIRED\n' }] }),
  );
  assert.deepEqual(failedIds(r), ['bridge.error-copy']);
});

test('bridge.frozen-neutral：FROZEN 用定性文案', () => {
  const r = runWebCheck(
    fixture({
      files: [{ path: 'web/ui.js', content: `// ${ERROR_CODES.join(' ')}\nvar m = 'FROZEN 账号因违规被封禁';` }],
    }),
  );
  assert.deepEqual(failedIds(r), ['bridge.frozen-neutral']);
});

test('a11y.basic：img 缺 alt', () => {
  const r = runWebCheck(fixture({ index: { body: '<img src="_brand-logo.png">' } }));
  assert.deepEqual(failedIds(r), ['a11y.basic']);
});

test('web.paths：后缀不在白名单', () => {
  const r = runWebCheck(fixture({ files: [{ path: 'web/tool.exe', content: 'x' }] }));
  assert.deepEqual(failedIds(r), ['web.paths']);
});

test('web.limits：超过 200 个文件', () => {
  const many = Array.from({ length: LIMITS.files }, (_, i) => ({ path: `web/p${i}.txt`, content: 'x' }));
  const r = runWebCheck(fixture({ files: many }));
  assert.deepEqual(failedIds(r), ['web.limits']);
});

test('web.limits：.DS_Store（同时命中 web.paths：后缀不在白名单）', () => {
  const r = runWebCheck(fixture({ files: [{ path: 'web/.DS_Store', content: 'x' }] }));
  assert.deepEqual(failedIds(r), ['web.limits', 'web.paths']);
});

test('checkFiles：写路径复用的子集只判规模/路径/外链', () => {
  const ok = checkFiles({ files: [{ path: 'web/a.html', content: '<p>hi</p>' }] });
  assert.equal(ok.ok, true);
  const big = checkFiles({ files: [{ path: 'web/a.js', content: 'x'.repeat(LIMITS.fileBytes + 1) }] });
  assert.deepEqual(failedIds(big), ['web.limits']);
  const ext = checkFiles({ files: [{ path: 'web/a.exe', content: 'x' }] });
  assert.deepEqual(failedIds(ext), ['web.paths']);
  const external = checkFiles({ files: [{ path: 'web/a.js', content: 'import x from "https://cdn.example/x.js"' }] });
  assert.deepEqual(failedIds(external), ['assets.no-external']);
});
