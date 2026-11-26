/* bridge@2（契约：docs/BRIDGE.md）
 *
 * 有壳：`window.bridge` 由壳在页面脚本之前注入，这里一个字段都不覆盖。
 * 没壳：提供一个同形的 mock（本地开发 / Studio 预览 / 浏览器直开）。
 *
 * 页面只调 `bridge.*`，不直接碰 WebView 的注入点。
 */
(function () {
  'use strict';

  if (window.bridge) return;

  var LINE_KEY = 'app.line';
  var PROTOCOL_KEY = 'app.protocol';
  var SPLIT_KEY = 'app.split';
  var ACTIVE_KEY = 'app.activated';
  var STATE_KEY = 'app.conn';

  var LINES = [
    { id: 1, label: '香港 01', icon: 'HK', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false, isDefault: true },
    { id: 2, label: '日本 01', icon: 'JP', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false },
    { id: 3, label: '美国 01', icon: 'US', iconKind: 'flag', factor: 2, hasRelay: true, hasUpstream: true },
    { id: 4, label: 'TikTok 专用', icon: 'streaming', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 5, label: 'ChatGPT', icon: 'ai', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 6, label: '游戏加速', icon: 'gaming', iconKind: 'service', factor: 2, hasRelay: true, hasUpstream: false },
  ];

  var PROTOCOLS = ['auto', 'udpTunnel', 'udpFast', 'udpStable', 'tcpFast', 'tcpStable'];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function defaultSplit() {
    return {
      region: { enable: true, code: 'CN' },
      ip: { enable: false, ip_cidr: [] },
      domain: { enable: false, domain: [], domain_suffix: [], domain_regex: [] },
    };
  }

  function savedSplit() {
    var s = read(SPLIT_KEY, null);
    if (!s || typeof s !== 'object') return defaultSplit();
    var d = defaultSplit();
    if (s.region && typeof s.region === 'object') {
      d.region.enable = !!s.region.enable;
      if (typeof s.region.code === 'string' && s.region.code) d.region.code = s.region.code;
    }
    if (s.ip && typeof s.ip === 'object') {
      d.ip.enable = !!s.ip.enable;
      d.ip.ip_cidr = Array.isArray(s.ip.ip_cidr) ? s.ip.ip_cidr.slice() : [];
    }
    if (s.domain && typeof s.domain === 'object') {
      d.domain.enable = !!s.domain.enable;
      d.domain.domain = Array.isArray(s.domain.domain) ? s.domain.domain.slice() : [];
      d.domain.domain_suffix = Array.isArray(s.domain.domain_suffix) ? s.domain.domain_suffix.slice() : [];
      d.domain.domain_regex = Array.isArray(s.domain.domain_regex) ? s.domain.domain_regex.slice() : [];
    }
    return d;
  }

  function platform() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    return 'windows';
  }

  var listeners = [];
  var lineId = read(LINE_KEY, 1);
  var protocol = read(PROTOCOL_KEY, 'auto');
  var split = savedSplit();
  var activated = read(ACTIVE_KEY, false) === true;

  var saved = read(STATE_KEY, null);
  var state = {
    status: saved && saved.status === 'connected' ? 'connected' : 'disconnected',
    error: null,
    since: saved && saved.status === 'connected' ? saved.since : null,
    line: saved && saved.status === 'connected' ? saved.line : null,
    bytesIn: 0,
    bytesOut: 0,
    activated: activated,
  };

  function currentLine() {
    return LINES.filter(function (l) { return l.id === lineId; })[0] || LINES[0];
  }

  function snapshot() {
    return {
      status: state.status,
      error: state.error ? { code: state.error.code, message: state.error.message } : null,
      since: state.since,
      line: state.line ? { id: state.line.id, label: state.line.label } : null,
      bytesIn: state.bytesIn,
      bytesOut: state.bytesOut,
      activated: activated,
    };
  }

  function emit() {
    var snap = snapshot();
    listeners.slice().forEach(function (cb) {
      try { cb(snap); } catch (e) { /* 页面自己的错误不该影响别的订阅者 */ }
    });
  }

  function persist() {
    write(STATE_KEY, { status: state.status, since: state.since, line: state.line });
  }

  function reject(code, message) {
    return Promise.reject({ code: code, message: message });
  }

  window.bridge = {
    capabilities: function () {
      return Promise.resolve({ bridge: '2', platform: platform(), store: null });
    },

    activate: function (key) {
      if (!key) return reject('INTERNAL', '缺少激活码');
      activated = true;
      write(ACTIVE_KEY, true);
      emit();
      return Promise.resolve();
    },

    deactivate: function () {
      activated = false;
      write(ACTIVE_KEY, false);
      state.status = 'disconnected';
      state.since = null;
      state.line = null;
      state.error = null;
      persist();
      emit();
      return Promise.resolve();
    },

    lines: function (opts) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ lines: LINES.map(function (l) { return Object.assign({}, l); }) });
        }, opts && opts.refresh ? 300 : 0);
      });
    },

    setLine: function (id) {
      var hit = LINES.filter(function (l) { return l.id === id; })[0];
      if (!hit) return reject('INTERNAL', '线路不存在');
      lineId = id;
      write(LINE_KEY, id);
      return Promise.resolve();
    },

    connect: function () {
      if (!activated) return reject('EXPIRED', '还没有可用的订阅');
      if (state.status === 'connected') return Promise.resolve();
      state.status = 'connecting';
      state.error = null;
      emit();
      return new Promise(function (resolve) {
        setTimeout(function () {
          state.status = 'connected';
          state.since = Date.now();
          state.line = { id: currentLine().id, label: currentLine().label };
          state.bytesIn = 1024 * 1024 * 3.4;
          state.bytesOut = 1024 * 512;
          persist();
          emit();
          resolve();
        }, 900);
      });
    },

    disconnect: function () {
      state.status = 'disconnected';
      state.since = null;
      state.line = null;
      state.error = null;
      persist();
      emit();
      return Promise.resolve();
    },

    state: function () { return Promise.resolve(snapshot()); },

    settings: function () {
      return Promise.resolve({
        protocol: protocol,
        split: JSON.parse(JSON.stringify(split)),
      });
    },

    setProtocol: function (p) {
      if (PROTOCOLS.indexOf(p) < 0) return reject('INTERNAL', '未知协议');
      protocol = p;
      write(PROTOCOL_KEY, p);
      return Promise.resolve();
    },

    setSplit: function (s) {
      if (!s || typeof s !== 'object') return reject('INTERNAL', '分流配置无效');
      split = JSON.parse(JSON.stringify(s));
      write(SPLIT_KEY, split);
      return Promise.resolve();
    },

    // 可选能力：与真壳一致，只收 https，交给系统浏览器
    open: function (url) {
      if (!/^https:\/\//i.test(String(url || ''))) {
        return reject('INTERNAL', '只允许 https 链接');
      }
      window.open(url, '_blank', 'noopener');
      return Promise.resolve();
    },

    on: function (evt, cb) {
      if (evt === 'state' && typeof cb === 'function') listeners.push(cb);
    },
  };
})();
