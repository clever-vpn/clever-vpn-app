/* 模拟壳（bridge@3）：Studio 预览与 CI 冒烟共用的那份「壳」。
 *
 * 它不是产物的一部分，也不随安装包发布；真壳在 shells/<platform>/。
 * 契约只有一份：docs/BRIDGE.md。本文件必须实现它的 14 个方法
 * （test/mock-shell.test.mjs 拿 window.bridge 的键与闸门白名单对账）。
 *
 * 调用方在页面脚本之前注入两样东西：
 *   window.__MOCK_SCENARIO      'real' | 'anon' | 'active' | 'slow' |
 *                               'expired' | 'frozen' | 'device_limit' | 'net_down'
 *   window.__MOCK_SHELL_CONFIG  { shell, platform, store, connect, errorCode,
 *                                 activated, lines, traffic, protocol, split }
 * 没有配置时按 scenario 推导；scenario 也没有时就是「正常的壳」。
 *
 * 测试钩子（Studio 不用，冒烟用）：
 *   window.__calls / __callsByMethod / __setShell / __activate
 */
(function () {
  'use strict';

  var SCENARIO = typeof window.__MOCK_SCENARIO === 'string' ? window.__MOCK_SCENARIO : 'real';
  var PROTOCOLS = ['auto', 'udpTunnel', 'udpFast', 'udpStable', 'tcpFast', 'tcpStable'];
  var ERR = {
    EXPIRED: '订阅已到期，续费后即可继续使用',
    FROZEN: '账号暂时不可用，请联系客服',
    DEVICE_LIMIT: '同时使用的设备数已达上限，可联系客服调整',
    NETWORK: '网络连不上，请检查网络后重试',
    INTERNAL: '暂时无法连接'
  };
  var SCENARIO_ERROR = {
    expired: 'EXPIRED',
    frozen: 'FROZEN',
    device_limit: 'DEVICE_LIMIT',
    net_down: 'NETWORK'
  };

  var LINES = [
    { id: 1, label: '香港 01', icon: 'HK', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false, isDefault: true },
    { id: 2, label: '日本 01', icon: 'JP', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false },
    { id: 3, label: '美国 01', icon: 'US', iconKind: 'flag', factor: 2, hasRelay: true, hasUpstream: true },
    { id: 4, label: 'TikTok 专用', icon: 'streaming', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 5, label: 'ChatGPT', icon: 'ai', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
    { id: 6, label: '游戏加速', icon: 'gaming', iconKind: 'service', factor: 2, hasRelay: true, hasUpstream: false }
  ];

  function platformOf() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
    return 'windows';
  }

  function defaultSplit() {
    return {
      region: { enable: true, code: 'CN' },
      ip: { enable: false, ip_cidr: [] },
      domain: { enable: false, domain: [], domain_suffix: [], domain_regex: [] }
    };
  }

  function splitOf(value) {
    var d = defaultSplit();
    if (!value || typeof value !== 'object') return d;
    if (value.region && typeof value.region === 'object') {
      d.region.enable = !!value.region.enable;
      if (typeof value.region.code === 'string' && value.region.code) d.region.code = value.region.code;
    }
    if (value.ip && typeof value.ip === 'object') {
      d.ip.enable = !!value.ip.enable;
      d.ip.ip_cidr = Array.isArray(value.ip.ip_cidr) ? value.ip.ip_cidr.slice() : [];
    }
    if (value.domain && typeof value.domain === 'object') {
      d.domain.enable = !!value.domain.enable;
      d.domain.domain = Array.isArray(value.domain.domain) ? value.domain.domain.slice() : [];
      d.domain.domain_suffix = Array.isArray(value.domain.domain_suffix) ? value.domain.domain_suffix.slice() : [];
      d.domain.domain_regex = Array.isArray(value.domain.domain_regex) ? value.domain.domain_regex.slice() : [];
    }
    return d;
  }

  function configOf() {
    var cfg = {
      shell: true,
      platform: platformOf(),
      store: null,
      connect: 'ok',
      errorCode: 'NETWORK',
      activated: true,
      lines: 'normal',
      traffic: true,
      protocol: 'auto',
      split: defaultSplit()
    };
    var input = window.__MOCK_SHELL_CONFIG;
    if (input && typeof input === 'object') {
      for (var k in cfg) {
        if (Object.prototype.hasOwnProperty.call(input, k)) cfg[k] = input[k];
      }
      cfg.split = splitOf(input.split);
      return cfg;
    }
    if (SCENARIO === 'anon') cfg.activated = false;
    if (SCENARIO === 'slow') cfg.connect = 'slow';
    if (SCENARIO_ERROR[SCENARIO]) {
      cfg.connect = 'fail';
      cfg.errorCode = SCENARIO_ERROR[SCENARIO];
    }
    if (SCENARIO === 'active') cfg.activated = true;
    return cfg;
  }

  var cfg = configOf();
  var calls = [];
  var listeners = [];
  var timer = null;
  var reconnectTimer = null;
  var activated = cfg.activated !== false;
  var protocol = PROTOCOLS.indexOf(cfg.protocol) >= 0 ? cfg.protocol : 'auto';
  var split = splitOf(cfg.split);
  var lineId = 1;
  var state = {
    status: 'disconnected',
    error: null,
    since: null,
    line: null,
    bytesIn: 0,
    bytesOut: 0
  };

  function record(method, extra) {
    var entry = { method: method };
    if (extra) for (var k in extra) entry[k] = extra[k];
    calls.push(entry);
  }

  function errorOf(code) {
    var key = ERR[code] ? code : 'INTERNAL';
    return { code: key, message: ERR[key] };
  }

  if (cfg.connect === 'fail') {
    state.status = 'error';
    state.error = errorOf(cfg.errorCode);
  }

  function linesNow() {
    if (cfg.lines === 'empty') return [];
    return LINES.map(function (line) {
      var copy = {};
      for (var k in line) copy[k] = line[k];
      return copy;
    });
  }

  function lineOf(id) {
    var list = linesNow();
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  function snapshot() {
    var seconds = state.status === 'connected' && state.since ? (Date.now() - state.since) / 1000 : 0;
    var traffic = cfg.traffic !== false && state.status === 'connected' && state.since;
    return {
      status: state.status,
      error: state.error ? { code: state.error.code, message: state.error.message } : null,
      since: state.since,
      line: state.line ? { id: state.line.id, label: state.line.label } : null,
      bytesIn: state.bytesIn + (traffic ? Math.round(seconds * 48 * 1024) : 0),
      bytesOut: state.bytesOut + (traffic ? Math.round(seconds * 8 * 1024) : 0),
      activated: activated
    };
  }

  function emit() {
    var snap = snapshot();
    listeners.slice().forEach(function (cb) {
      try { cb(snap); } catch (e) { /* 页面自己的错误不该影响别的订阅者 */ }
    });
  }

  function stopClock() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function startClock() {
    stopClock();
    if (cfg.traffic === false) return;
    timer = setInterval(function () {
      if (state.status === 'connected') emit();
    }, 1000);
  }

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function reject(code, message) {
    return Promise.reject({ code: ERR[code] ? code : 'INTERNAL', message: message || ERR[code] || ERR.INTERNAL });
  }

  function delay(ms, value) {
    if (!ms) return Promise.resolve(value);
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); });
  }

  function connected(line) {
    state.status = 'connected';
    state.error = null;
    state.since = Date.now();
    state.line = line ? { id: line.id, label: line.label } : null;
    state.bytesIn = 0;
    state.bytesOut = 0;
    startClock();
    emit();
  }

  function dropAndReconnect() {
    state.status = 'error';
    state.error = errorOf('NETWORK');
    state.since = null;
    state.line = null;
    stopClock();
    emit();
    reconnectTimer = setTimeout(function () {
      state.status = 'connecting';
      state.error = null;
      emit();
      reconnectTimer = setTimeout(function () {
        connected(lineOf(lineId) || linesNow()[0]);
      }, 900);
    }, 1600);
  }

  /* ── 测试钩子（任何模式下都暴露，方便断言"页面确实调了哪些方法"）── */
  window.__calls = function () { return calls.slice(); };
  window.__callsByMethod = function () {
    return calls.map(function (c) { return c.method; });
  };
  window.__setShell = function (patch) {
    var next = patch || {};
    for (var k in next) {
      if (k === 'error') state.error = next[k];
      else state[k] = next[k];
    }
    emit();
  };
  window.__activate = function () { activated = true; emit(); };

  /* 面板对照用：这条分支让租户自带的 app/web/bridge.js 接管（无壳对照） */
  if (cfg.shell === false) return;

  window.bridge = {
    capabilities: function () {
      record('capabilities');
      return Promise.resolve({
        bridge: '3',
        platform: cfg.platform || platformOf(),
        store: cfg.store === 'none' || !cfg.store ? null : cfg.store
      });
    },

    activate: function (key) {
      record('activate', key ? { key: key } : null);
      if (!key) return reject('INTERNAL', '缺少激活码');
      activated = true;
      emit();
      return Promise.resolve();
    },

    deactivate: function () {
      record('deactivate');
      activated = false;
      clearReconnect();
      stopClock();
      state.status = 'disconnected';
      state.since = null;
      state.line = null;
      state.error = null;
      emit();
      return Promise.resolve();
    },

    lines: function (opts) {
      record('lines', opts && opts.refresh ? { refresh: true } : null);
      if (cfg.lines === 'fail') return reject('NETWORK');
      var wait = cfg.lines === 'slow' ? 1200 : opts && opts.refresh ? 300 : 0;
      return delay(wait, { lines: linesNow() });
    },

    setLine: function (id) {
      record('setLine', { id: id });
      var hit = lineOf(id);
      if (!hit) return reject('INTERNAL', '线路不存在');
      lineId = id;
      return Promise.resolve();
    },

    connect: function () {
      record('connect');
      if (!activated) return reject('EXPIRED', ERR.EXPIRED);
      if (!linesNow().length) return reject('INTERNAL', '没有可用线路');
      if (state.status === 'connected') return Promise.resolve();
      clearReconnect();

      if (cfg.connect === 'fail') {
        state.status = 'error';
        state.error = errorOf(cfg.errorCode);
        state.since = null;
        state.line = null;
        emit();
        return reject(state.error.code, state.error.message);
      }

      state.status = 'connecting';
      state.error = null;
      emit();

      // 卡住：状态一直停在连接中，但 Promise 会返回 —— 否则页面的 busy 会卡死，
      // 点预览的人连「断开」都点不了。再点一次按钮就能退出（toggle 看到 connecting ⇒ disconnect）。
      if (cfg.connect === 'stuck') return delay(600, null);

      var wait = cfg.connect === 'slow' ? 1500 : 450;
      return delay(wait, null).then(function () {
        var chosen = lineOf(lineId) || linesNow()[0];
        connected(chosen);
        if (cfg.connect === 'reconnect') setTimeout(dropAndReconnect, 4200);
      });
    },

    disconnect: function () {
      record('disconnect');
      clearReconnect();
      stopClock();
      state.status = 'disconnected';
      state.since = null;
      state.line = null;
      state.error = null;
      emit();
      return Promise.resolve();
    },

    state: function () {
      record('state');
      return Promise.resolve(snapshot());
    },

    settings: function () {
      record('settings');
      return Promise.resolve({
        protocol: protocol,
        split: splitOf(split)
      });
    },

    setProtocol: function (p) {
      record('setProtocol', { protocol: p });
      if (PROTOCOLS.indexOf(p) < 0) return reject('INTERNAL', '未知协议');
      protocol = p;
      return Promise.resolve();
    },

    setSplit: function (s) {
      record('setSplit', { split: s ? JSON.parse(JSON.stringify(s)) : null });
      if (!s || typeof s !== 'object') return reject('INTERNAL', '分流配置无效');
      split = splitOf(s);
      return Promise.resolve();
    },

    // 外链：预览里真的开出去（试运行态的 iframe 允许 popup）
    open: function (url) {
      record('open', { url: url });
      if (!/^https:\/\//i.test(String(url || ''))) return reject('INTERNAL', '只允许 https 链接');
      window.open(url, '_blank', 'noopener');
      return Promise.resolve();
    },

    /* CRM 的唯一网络出口（bridge@3）。预览里 BRAND.crm.base 是
     * /__preview/<draft>/api/app/v1，请求落到 studio 的转发口 → 真 CRM；
     * 冒烟里是假 CRM 的 origin。两条路都断言同一组白名单。 */
    crmRequest: function (req) {
      record('crmRequest', req ? { req: { method: req.method, path: req.path } } : null);
      if (!req || (req.method !== 'GET' && req.method !== 'POST')) {
        return reject('INTERNAL', '只支持 GET / POST');
      }
      var base = window.BRAND && window.BRAND.crm && window.BRAND.crm.base;
      if (!base) return reject('INTERNAL', '还没接 CRM');
      var headers = {};
      var allowed = { authorization: 1, accept: 1, 'content-type': 1 };
      var src = req.headers || {};
      for (var name in src) {
        if (allowed[String(name).toLowerCase()]) headers[name] = src[name];
      }
      var timeout = Math.max(1000, Math.min(30000, Number(req.timeoutMs) || 15000));
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      var watch = ac ? setTimeout(function () { ac.abort(); }, timeout) : null;
      return fetch(String(base) + '/api/app/v1' + String(req.path || ''), {
        method: req.method,
        headers: headers,
        body: req.method === 'GET' ? undefined : req.body,
        signal: ac ? ac.signal : undefined,
        cache: 'no-store'
      }).then(function (res) {
        if (watch) clearTimeout(watch);
        return res.text().then(function (body) { return { status: res.status, body: body }; });
      }, function () {
        if (watch) clearTimeout(watch);
        return reject('NETWORK', ERR.NETWORK);
      });
    },

    on: function (evt, cb) {
      record('on', { event: evt });
      if (evt === 'state' && typeof cb === 'function') listeners.push(cb);
    }
  };
})();
