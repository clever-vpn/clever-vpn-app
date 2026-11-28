import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { BRIDGE_METHODS } from '../scripts/lib/web-check.mjs';

/**
 * 模拟壳（shells/mock/bridge.js）是仓库里最接近"壳"的东西：Studio 预览与 CI 冒烟都用它。
 * 它必须实现闸门白名单里的每一个方法 —— 这条测试就是两者之间的合同。
 */

const MOCK = fileURLToPath(new URL('../shells/mock/bridge.js', import.meta.url));
const SOURCE = readFileSync(MOCK, 'utf8');

function run(config, scenario) {
  const context = vm.createContext({
    window: {},
    navigator: { userAgent: 'Mozilla/5.0 (Test) Chrome/120' },
    console,
    fetch: () => Promise.reject(new Error('mock 不该发网络请求')),
  });
  if (config !== undefined) context.window.__MOCK_SHELL_CONFIG = config;
  if (scenario !== undefined) context.window.__MOCK_SCENARIO = scenario;
  vm.runInContext(SOURCE, context, { filename: 'shells/mock/bridge.js' });
  return context.window;
}

test('mock 的方法集合 == 闸门白名单（一个不多、一个不少）', () => {
  const win = run();
  assert.deepEqual([...Object.keys(win.bridge)].sort(), [...BRIDGE_METHODS].sort());
  for (const name of BRIDGE_METHODS) assert.equal(typeof win.bridge[name], 'function', `${name} 必须是函数`);
});

test('mock 不提供白名单以外的方法（页面只能走 bridge）', () => {
  const win = run();
  for (const name of ['readFile', 'exec', 'postMessage', 'send']) {
    assert.equal(win.bridge[name], undefined, `${name} 不该出现在 bridge 上`);
  }
});

test('capabilities 返回 bridge@3 与平台', async () => {
  const win = run();
  const caps = await win.bridge.capabilities();
  assert.equal(caps.bridge, '3');
  assert.equal(caps.store, null);
  assert.ok(['windows', 'macos', 'android', 'ios'].includes(caps.platform));
});

test('场景 expired：状态直接是 error + EXPIRED（预览/冒烟引用同一套语义）', async () => {
  const win = run(undefined, 'expired');
  const state = await win.bridge.state();
  assert.equal(state.status, 'error');
  assert.equal(state.error.code, 'EXPIRED');
});

test('shell:false 时不定义 window.bridge（让 app/web/bridge.js 接管）', () => {
  const win = run({ shell: false });
  assert.equal(win.bridge, undefined);
  assert.equal(typeof win.__callsByMethod, 'function', '测试钩子仍然可用');
});

test('调用的方法会被记录（冒烟靠它断言"UI 真的按契约走"）', async () => {
  const win = run();
  await win.bridge.state();
  await win.bridge.lines();
  assert.deepEqual([...win.__callsByMethod()], ['state', 'lines']);
});
