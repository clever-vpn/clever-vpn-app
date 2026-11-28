import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BRIDGE_VERSION, BRIDGE_METHODS } from '../scripts/lib/web-check.mjs';

/**
 * 文档是规范、代码是判决：两处方法表与版本号必须一字不差。
 * 这里故意从 docs/BRIDGE.md 里**解析**，而不是再写一份清单 —— 抄一份就等于没钉。
 */

const DOC = fileURLToPath(new URL('../docs/BRIDGE.md', import.meta.url));

function bridgeSection() {
  const text = readFileSync(DOC, 'utf8');
  const start = text.indexOf('interface Bridge {');
  assert.ok(start >= 0, 'docs/BRIDGE.md 里找不到 interface Bridge');
  const rest = text.slice(start);
  const end = rest.indexOf('\n}');
  assert.ok(end >= 0, 'interface Bridge 没有结束的 }');
  return rest.slice(0, end);
}

test('docs/BRIDGE.md 的 bridge 版本 == 闸门的 BRIDGE_VERSION', () => {
  const text = readFileSync(DOC, 'utf8');
  const m = /^#\s+Bridge 契约\s+`bridge@(\d+)`/m.exec(text);
  assert.ok(m, '标题应是「# Bridge 契约 `bridge@N`」');
  assert.equal(Number(m[1]), BRIDGE_VERSION);
});

test('docs/BRIDGE.md 的 capabilities 里 bridge 字面量 == BRIDGE_VERSION', () => {
  const section = bridgeSection();
  const m = /bridge:\s*'(\d+)'/.exec(section);
  assert.ok(m, 'interface Bridge 的 capabilities() 应声明 bridge 版本');
  assert.equal(Number(m[1]), BRIDGE_VERSION);
});

test('docs/BRIDGE.md 的方法表 == 闸门 BRIDGE_METHODS', () => {
  const names = new Set();
  for (const line of bridgeSection().split('\n')) {
    const m = /^\s{2}([A-Za-z_$][\w$]*)(?:\?)?\s*\(/.exec(line);
    if (m) names.add(m[1]);
  }
  assert.ok(names.size > 0, '没解析出任何方法');
  assert.deepEqual([...names].sort(), [...BRIDGE_METHODS].sort());
});
