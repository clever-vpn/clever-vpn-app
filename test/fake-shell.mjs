/**
 * 测试用的假壳：实现 bridge@3 的全部 14 个方法，并记录调用，供断言“UI 真的按契约走”。
 *
 * 为什么是完备的：bridge@2 是 UI 与原生之间的唯一接口，假壳覆盖全部方法后，
 * 所有与壳有关的 UI 行为都能在 Chromium 里测出来。
 *
 * 必须在页面脚本之前注入（Playwright 的 addInitScript）。
 */
export const FAKE_SHELL = `
(() => {
  const listeners = [];
  const calls = [];
  const lines = [
    { id: 1, label: '香港 01', icon: 'HK', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false, isDefault: true },
    { id: 2, label: '日本 01', icon: 'JP', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false },
    { id: 3, label: '美国 01', icon: 'US', iconKind: 'flag', factor: 2, hasRelay: true, hasUpstream: true },
    { id: 4, label: 'TikTok 专用', icon: 'streaming', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 5, label: 'ChatGPT', icon: 'ai', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 6, label: '游戏加速', icon: 'gaming', iconKind: 'service', factor: 2, hasRelay: true, hasUpstream: false },
  ];
  let activated = false;
  let lineId = 1;
  let protocol = 'auto';
  let split = {
    region: { enable: true, code: 'CN' },
    ip: { enable: false, ip_cidr: [] },
    domain: { enable: false, domain: [], domain_suffix: [], domain_regex: [] },
  };
  const st = { status: 'disconnected', error: null, since: null, line: null, bytesIn: 0, bytesOut: 0 };

  const snapshot = () => ({
    status: st.status,
    error: st.error ? { code: st.error.code, message: st.error.message } : null,
    since: st.since,
    line: st.line ? { id: st.line.id, label: st.line.label } : null,
    bytesIn: st.bytesIn,
    bytesOut: st.bytesOut,
    activated: activated,
  });
  const emit = () => listeners.slice().forEach((fn) => { try { fn(snapshot()); } catch (e) {} });
  const current = () => lines.filter((l) => l.id === lineId)[0] || lines[0];

  window.__bridge = {
    calls,
    capabilities() {
      calls.push({ method: 'capabilities' });
      return Promise.resolve({ bridge: '3', platform: 'windows', store: null });
    },
    crmRequest(req) {
      calls.push({ method: 'crmRequest', req });
      // 测试假壳：把桥请求转成 fetch，让 Playwright 现有的 **/api/app/v1/** mock 继续生效。
      return fetch(window.BRAND.crm.base + '/api/app/v1' + req.path, {
        method: req.method,
        headers: req.headers || {},
        body: req.body,
      }).then(function (res) {
        return res.text().then(function (text) { return { status: res.status, body: text }; });
      });
    },
    activate(key) {
      calls.push({ method: 'activate', key });
      activated = true;
      emit();
      return Promise.resolve();
    },
    deactivate() {
      calls.push({ method: 'deactivate' });
      activated = false;
      st.status = 'disconnected';
      st.since = null;
      st.line = null;
      emit();
      return Promise.resolve();
    },
    lines() {
      calls.push({ method: 'lines' });
      return Promise.resolve({ lines: lines.map((l) => ({ ...l })) });
    },
    setLine(id) {
      calls.push({ method: 'setLine', id });
      if (!lines.some((l) => l.id === id)) return Promise.reject({ code: 'INTERNAL', message: 'no line' });
      lineId = id;
      return Promise.resolve();
    },
    connect() {
      calls.push({ method: 'connect' });
      if (!activated) return Promise.reject({ code: 'EXPIRED', message: 'no subscription' });
      st.status = 'connecting';
      st.error = null;
      emit();
      return new Promise((resolve) => {
        setTimeout(() => {
          st.status = 'connected';
          st.since = Date.now();
          st.line = { id: current().id, label: current().label };
          st.bytesIn = 1024 * 1024 * 3.4;
          st.bytesOut = 1024 * 512;
          emit();
          resolve();
        }, 20);
      });
    },
    disconnect() {
      calls.push({ method: 'disconnect' });
      st.status = 'disconnected';
      st.since = null;
      st.line = null;
      emit();
      return Promise.resolve();
    },
    state() {
      calls.push({ method: 'state' });
      return Promise.resolve(snapshot());
    },
    settings() {
      calls.push({ method: 'settings' });
      return Promise.resolve({ protocol, split: JSON.parse(JSON.stringify(split)) });
    },
    setProtocol(p) {
      calls.push({ method: 'setProtocol', protocol: p });
      protocol = p;
      return Promise.resolve();
    },
    setSplit(s) {
      calls.push({ method: 'setSplit', split: JSON.parse(JSON.stringify(s)) });
      split = JSON.parse(JSON.stringify(s));
      return Promise.resolve();
    },
    open(url) {
      calls.push({ method: 'open', url });
      return Promise.resolve();
    },
    on(evt, cb) {
      calls.push({ method: 'on', event: evt });
      if (evt === 'state') listeners.push(cb);
    },
  };

  window.bridge = window.__bridge;
  window.__setShell = (patch) => {
    const { error, ...rest } = patch || {};
    Object.assign(st, rest);
    if (error !== undefined) st.error = error;
    emit();
  };
  window.__activate = () => { activated = true; emit(); };
  window.__callsByMethod = () => calls.map((c) => c.method);
  window.__calls = () => calls.slice();
})();
`;

/** 必须中性的错误文案（BRIDGE.md §3：FROZEN 不得对用户定性） */
export const FROZEN_BANNED = /违规|封禁|作弊|滥用|违反/;
