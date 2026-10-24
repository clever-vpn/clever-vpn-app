/**
 * 测试用的假壳：实现 `bridge@1` 的 3 个方法 + 1 个事件，
 * 并在 `window.__bridge.calls` 里记录调用，供断言“UI 真的按契约走”。
 *
 * 为什么要假壳：真壳（三个原生壳）在 CI 里跑不了；而 bridge 契约只有 4 个入口，
 * 所以假壳是**完备**的 —— 这一层能测出所有与壳有关的 UI 行为。
 *
 * 注意：它必须在页面脚本之前注入（Playwright 的 addInitScript）。
 */
export const FAKE_SHELL = `
(() => {
  const listeners = [];
  const calls = [];
  let snap = { status: 'disconnected', since: null, serverName: 'Test 01', error: null };
  const fire = () => listeners.slice().forEach(fn => { try { fn({ ...snap }); } catch (e) {} });

  window.__bridge = {
    calls,
    async connect(cfg) {
      calls.push({ method: 'connect', cfg });
      snap = { ...snap, status: 'connecting', error: null }; fire();
      await new Promise(r => setTimeout(r, 20));
      snap = { ...snap, status: 'connected', since: Date.now() }; fire();
    },
    async disconnect() {
      calls.push({ method: 'disconnect' });
      snap = { ...snap, status: 'disconnected', since: null, error: null }; fire();
    },
    async state() {
      calls.push({ method: 'state' });
      return { ...snap };
    },
    on(cb) {
      calls.push({ method: 'on' });
      listeners.push(cb);
    },
  };

  window.__BRIDGE__ = window.__bridge;

  /** 模拟壳主动推事件：状态变化 / 连接失败 / 外部（服务端）改状态 */
  window.__setShell = (patch) => { snap = { ...snap, ...patch }; fire(); };
  window.__callsByMethod = () => calls.map(c => c.method);
})();
`;

/** 必须中性的错误文案（bridge@1 §3：FROZEN 不得对用户定性） */
export const FROZEN_BANNED = /违规|封禁|作弊|滥用|违反/;
