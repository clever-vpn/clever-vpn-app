/* CRM 客户端（契约：clever-vpn-docs 的 clients）。
 *
 * 三条纪律（照契约 §0）：
 *   1. 只渲染：能不能买、多少钱、什么状态，全部读服务端字段，不推导。
 *   2. 错误信封的 message 是整句中文，直接展示；这里不改写、不翻译。
 *   3. 凭据只有 session_token：localStorage + Authorization: Bearer；401 只清凭据。
 */
(function () {
  'use strict';

  var KEY = 'app.session';
  var API = '/api/app/v1';
  var TIMEOUT = 15000;

  var token = null;
  try { token = localStorage.getItem(KEY) || null; } catch (e) { token = null; }

  function base() {
    var b = window.BRAND && window.BRAND.crm && window.BRAND.crm.base;
    return typeof b === 'string' ? b : '';
  }

  function available() { return !!base(); }

  function url(path) { return base() + API + path; }

  function hasToken() { return !!token; }

  function setToken(t) {
    token = t || null;
    try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function defaultMessage(status) {
    if (status === 401) return '登录已失效，请重新登录';
    if (status === 403) return '没有权限执行这个操作';
    if (status === 404) return '内容不存在';
    if (status === 429) return '操作太频繁，请稍后再试';
    if (status >= 500) return '服务暂时不可用，请稍后重试';
    return '请求失败，请稍后重试';
  }

  // CRM 传输：有壳走 bridge.crmRequest（libbox 里做优选 IP → A 记录 → 域名），
  // 无壳（本地开发 / Studio 预览 / Site / 旧壳）回退浏览器 fetch。
  // 两条路都返回同形 {status, body}，call() 的超时/重试/401/信封逻辑因此不用分叉。
  function bridgeCrmRequest(method, path, headers, bodyText, timeout) {
    if (!window.bridge || typeof window.bridge.crmRequest !== 'function') return null;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, timeout + 1000);
      window.bridge.crmRequest({
        method: method,
        path: path,
        headers: headers,
        body: bodyText,
        timeoutMs: timeout,
      }).then(function (res) {
        clearTimeout(timer);
        if (!res || typeof res.status !== 'number' || typeof res.body !== 'string') {
          reject(new Error('invalid bridge response'));
          return;
        }
        resolve({ status: res.status, body: res.body });
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async function fetchCrmRequest(method, path, headers, bodyText, signal) {
    var res = await fetch(url(path), {
      method: method,
      headers: headers,
      body: bodyText,
      signal: signal,
      cache: 'no-store',
    });
    return { status: res.status, body: await res.text() };
  }

  async function transport(method, path, headers, bodyText, signal, timeout) {
    var bridged = bridgeCrmRequest(method, path, headers, bodyText, timeout);
    if (bridged) return bridged;
    return fetchCrmRequest(method, path, headers, bodyText, signal);
  }

  async function call(method, path, body, opts) {
    var o = opts || {};
    var headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (o.auth !== false && token) headers.authorization = 'Bearer ' + token;

    var bodyText = body === undefined ? undefined : JSON.stringify(body);
    var retries = method === 'GET' && o.retry !== false ? 2 : 0;
    var attempt = 0;

    for (;;) {
      var ac = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ac ? setTimeout(function () { ac.abort(); }, TIMEOUT) : null;
      try {
        var res = await transport(method, path, headers, bodyText, ac ? ac.signal : undefined, TIMEOUT);
        if (timer) clearTimeout(timer);
        var text = res.body;
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = null; }
        }
        if (res.status === 401) setToken(null);
        if (res.status < 200 || res.status >= 300) {
          var env = (data && data.error) || {};
          throw {
            code: env.code || 'service_unavailable',
            message: env.message || defaultMessage(res.status),
            status: res.status,
          };
        }
        if (data === null) {
          throw { code: 'service_unavailable', message: '服务返回了无法识别的内容，请稍后重试', status: res.status };
        }
        return data;
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (e && typeof e.code === 'string' && typeof e.status === 'number') throw e;
        if (attempt < retries) {
          attempt += 1;
          await sleep(250 * attempt);
          continue;
        }
        throw { code: 'service_unavailable', message: '网络不可用，请检查连接后重试', status: 0 };
      }
    }
  }

  var qs = function (o) {
    var parts = Object.keys(o || {})
      .filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  };

  window.Api = {
    available: available,
    hasToken: hasToken,
    setToken: setToken,
    clearToken: function () { setToken(null); },
    base: base,

    meta: function () { return call('GET', '/meta', undefined, { auth: false }); },

    // F1 身份
    sendCode: function (email, turnstileToken) {
      var body = { email: email };
      if (turnstileToken) body.turnstile_token = turnstileToken;
      return call('POST', '/auth/send-code', body, { auth: false });
    },
    verify: function (payload) { return call('POST', '/auth/verify', payload, { auth: false }); },
    logout: function () { return call('POST', '/auth/logout', {}).catch(function () { /* 登出幂等，失败也清本地 */ }); },

    // F2 身份与权益
    me: function () { return call('GET', '/me'); },
    subscription: function () { return call('GET', '/subscription'); },

    // F3 目录 / 报价 / 订单
    plans: function () { return call('GET', '/plans', undefined, { retry: false }); },
    quote: function (planId, promoCode) {
      var body = { plan_id: planId };
      if (promoCode) body.promo_code = promoCode;
      return call('POST', '/quote', body, { retry: false });
    },
    orders: function (limit, cursor) { return call('GET', '/orders' + qs({ limit: limit, cursor: cursor })); },
    createOrder: function (payload) { return call('POST', '/orders', payload, { retry: false }); },
    order: function (code) { return call('GET', '/orders/' + encodeURIComponent(code)); },

    // F5 促销与领取（三个入口同形）
    gifts: function (promotionId) { return call('GET', '/me/gifts' + qs({ promotion_id: promotionId })); },
    claim: function (action) {
      // claim_action 由服务端给（/me/gifts/12/claim 或 /me/rewards/88/claim）；只接受这两种形状
      if (!/^\/me\/(gifts|rewards)\/\d+\/claim$/.test(String(action || ''))) {
        return Promise.reject({ code: 'invalid_request', message: '领取入口无效，请刷新页面重试', status: 0 });
      }
      return call('POST', action, {}, { retry: false });
    },
    redeem: function (code) { return call('POST', '/redeem', { code: code }, { retry: false }); },
  };
})();
