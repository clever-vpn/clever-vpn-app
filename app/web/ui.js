/* 页面公共层：品牌注入 / 主题 / 底部导航 / 确认弹窗 / toast / 格式化 / 启动守卫。
 *
 * 依赖顺序（每个页面的 <head>）：_brand.js → icons.js → bridge.js → api.js → ui.js
 * 页面的业务脚本只通过 UI.page(fn) 注册，启动后再跑。
 */
(function () {
  'use strict';

  var B = window.BRAND || {};
  if (!B.links) B.links = {};
  window.BRAND = B;

  // 主题必须在 body 之前落到 <html>，否则会闪一下白。
  try {
    var savedTheme = localStorage.getItem('app.theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  } catch (e) { /* 隐私模式忽略 */ }

  if (B.color) document.documentElement.style.setProperty('--brand', B.color);

  var MARK = '<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="M32 56C25.6348 56 19.5303 53.4714 15.0294 48.9706C10.5286 44.4697 8.00001 38.3652 8.00001 32C8.00001 25.6348 10.5286 19.5303 15.0294 15.0294C19.5303 10.5286 25.6348 8 32 8C38.3652 8 44.4697 10.5286 48.9706 15.0294C53.4714 19.5303 56 25.6348 56 32C56 38.3652 53.4714 44.4697 48.9706 48.9706C44.4697 53.4714 38.3652 56 32 56ZM32 5.33334C28.4981 5.33334 25.0305 6.02309 21.7951 7.36322C18.5598 8.70334 15.6201 10.6676 13.1438 13.1438C8.14286 18.1448 5.33334 24.9276 5.33334 32C5.33334 39.0724 8.14286 45.8552 13.1438 50.8562C15.6201 53.3324 18.5598 55.2967 21.7951 56.6368C25.0305 57.9769 28.4981 58.6667 32 58.6667C39.0725 58.6667 45.8552 55.8572 50.8562 50.8562C55.8572 45.8552 58.6667 39.0724 58.6667 32C58.6667 28.4981 57.9769 25.0305 56.6368 21.7951C55.2967 18.5598 53.3324 15.6201 50.8562 13.1438C48.38 10.6676 45.4403 8.70334 42.2049 7.36322C38.9696 6.02309 35.5019 5.33334 32 5.33334ZM27.8733 14V16.6227H19.5368V47.3195L27.8733 47.3264V49.9805L43.0947 47.2464L43.1104 16.7531L27.8733 14ZM30.3979 30.7859C30.9091 30.7859 31.3235 31.3251 31.3235 31.9901C31.3235 32.6555 30.9093 33.1947 30.3979 33.1947C29.8864 33.1947 29.4723 32.6555 29.4723 31.9901C29.4723 31.3251 29.8867 30.7859 30.3979 30.7859ZM22.012 44.8464V19.0979H27.8733V44.8509L22.012 44.8464Z"/></svg>';

  var ERROR_COPY = {
    EXPIRED: { title: '订阅已到期', text: '续费后可继续使用。', action: '去续费', href: 'plans.html' },
    FROZEN: { title: '账号暂时不可用', text: '请联系客服处理。', action: '联系客服', support: true },
    DEVICE_LIMIT: { title: '设备数已达上限', text: '请联系客服处理。', action: '联系客服', support: true },
    NETWORK: { title: '网络不可达', text: '检查网络后再试一次。', action: '重试', retry: true },
    INTERNAL: { title: '连接失败', text: '稍后再试一次。', action: '重试', retry: true },
  };

  // 国家和地区（分流 → 地区）。客户端只负责呈现与搜索；选中值进 bridge 的 split.region.code。
  var REGIONS = [
    { code: 'CN', name: '中国' }, { code: 'HK', name: '中国香港' },
    { code: 'MO', name: '中国澳门' }, { code: 'TW', name: '中国台湾' },
    { code: 'JP', name: '日本' }, { code: 'KR', name: '韩国' },
    { code: 'SG', name: '新加坡' }, { code: 'MY', name: '马来西亚' },
    { code: 'TH', name: '泰国' }, { code: 'VN', name: '越南' },
    { code: 'PH', name: '菲律宾' }, { code: 'ID', name: '印度尼西亚' },
    { code: 'IN', name: '印度' }, { code: 'AE', name: '阿联酋' },
    { code: 'TR', name: '土耳其' }, { code: 'IL', name: '以色列' },
    { code: 'KZ', name: '哈萨克斯坦' }, { code: 'AU', name: '澳大利亚' },
    { code: 'NZ', name: '新西兰' }, { code: 'US', name: '美国' },
    { code: 'CA', name: '加拿大' }, { code: 'MX', name: '墨西哥' },
    { code: 'BR', name: '巴西' }, { code: 'AR', name: '阿根廷' },
    { code: 'CL', name: '智利' }, { code: 'GB', name: '英国' },
    { code: 'IE', name: '爱尔兰' }, { code: 'FR', name: '法国' },
    { code: 'DE', name: '德国' }, { code: 'NL', name: '荷兰' },
    { code: 'BE', name: '比利时' }, { code: 'CH', name: '瑞士' },
    { code: 'AT', name: '奥地利' }, { code: 'SE', name: '瑞典' },
    { code: 'NO', name: '挪威' }, { code: 'DK', name: '丹麦' },
    { code: 'FI', name: '芬兰' }, { code: 'PL', name: '波兰' },
    { code: 'CZ', name: '捷克' }, { code: 'ES', name: '西班牙' },
    { code: 'IT', name: '意大利' }, { code: 'PT', name: '葡萄牙' },
    { code: 'GR', name: '希腊' }, { code: 'RO', name: '罗马尼亚' },
    { code: 'RU', name: '俄罗斯' }, { code: 'UA', name: '乌克兰' },
    { code: 'ZA', name: '南非' }, { code: 'EG', name: '埃及' },
    { code: 'NG', name: '尼日利亚' },
  ];

  function regionName(code) {
    var hit = REGIONS.filter(function (r) { return r.code === code; })[0];
    return hit ? hit.name : (code || '');
  }

  var TABS = [
    { id: 'connect', href: 'index.html', label: '连接' },
    { id: 'lines', href: 'lines.html', label: '线路' },
    { id: 'plans', href: 'plans.html', label: '套餐' },
    { id: 'account', href: 'account.html', label: '账户' },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hostOf(url) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  function openLink(url) {
    if (!url) return;
    if (window.bridge && typeof bridge.open === 'function') {
      bridge.open(url).catch(function () { window.open(url, '_blank', 'noopener'); });
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  // ── 品牌 ──────────────────────────────────────────────────
  function applyBrand() {
    var name = B.name || '';
    document.querySelectorAll('[data-brand-name]').forEach(function (el) { el.textContent = name; });
    document.querySelectorAll('[data-brand-tagline]').forEach(function (el) { el.textContent = B.tagline || ''; });
    document.querySelectorAll('[data-brand-short]').forEach(function (el) {
      el.textContent = (B.short_name || B.name || 'A').slice(0, 1);
    });
    document.querySelectorAll('[data-brand-logo]').forEach(function (el) {
      if (B.logo) {
        el.innerHTML = '<img src="' + esc(B.logo) + '" alt="' + esc(name) + '">';
      } else {
        el.innerHTML = MARK;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', name);
      }
    });

    // 法务小字：两段都空就整块不出现；只有一段时也不留孤零零的“与”
    document.querySelectorAll('[data-legal]').forEach(function (el) {
      var parts = [];
      if (B.links.terms) parts.push('<a data-ext href="' + esc(B.links.terms) + '" target="_blank" rel="noopener">服务条款</a>');
      if (B.links.privacy) parts.push('<a data-ext href="' + esc(B.links.privacy) + '" target="_blank" rel="noopener">隐私政策</a>');
      if (!parts.length) { el.remove(); return; }
      el.innerHTML = '继续即表示同意 ' + parts.join(' 与 ');
    });

    // 外链：空值 = 整块不出现；有值 = 一律系统浏览器
    document.querySelectorAll('[data-link]').forEach(function (el) {
      var url = B.links[el.getAttribute('data-link')];
      if (!url) { el.remove(); return; }
      el.setAttribute('data-brand-url', url);
      if (el.tagName === 'A') el.setAttribute('href', url);
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        openLink(url);
      });
    });

    // 只显示域名的地方（官网）：找最近的 [data-link] 拿 URL，不动兄弟节点
    document.querySelectorAll('[data-link-host]').forEach(function (el) {
      var owner = el.closest('[data-link]');
      var url = (owner && owner.getAttribute('data-brand-url')) || B.links[el.getAttribute('data-link-host')];
      if (url) el.textContent = hostOf(url);
    });

    var pageTitle = document.title;
    if (name && pageTitle.indexOf(name) < 0) {
      document.title = pageTitle ? pageTitle + ' · ' + name : name;
    }
  }

  // ── 主题 ──────────────────────────────────────────────────
  function theme() {
    try { return localStorage.getItem('app.theme') || 'auto'; } catch (e) { return 'auto'; }
  }
  function setTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
    try {
      if (v === 'light' || v === 'dark') localStorage.setItem('app.theme', v);
      else localStorage.removeItem('app.theme');
    } catch (e) { /* 忽略 */ }
  }

  // ── 底部导航 ──────────────────────────────────────────────
  function renderTabs() {
    var nav = document.querySelector('nav[data-tabs]');
    if (!nav) return;
    if (!window.Api || !Api.hasToken()) {
      nav.remove();
      document.body.classList.add('no-tabs');
      return;
    }
    var active = nav.getAttribute('data-tabs');
    nav.className = 'tabs';
    nav.innerHTML = TABS.map(function (t) {
      return '<a class="tab' + (t.id === active ? ' on' : '') + '" href="' + t.href + '"' +
        (t.id === active ? ' aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + (window.ICONS[t.id] || '') + '</svg>' +
        '<span>' + t.label + '</span></a>';
    }).join('');
  }

  // ── 确认弹窗（iOS alert 版式）──────────────────────────────
  var sheetHost = null;
  var sheetSettle = null;
  var lastFocus = null;

  function buildSheet() {
    sheetHost = document.createElement('div');
    sheetHost.className = 'sheet-host';
    sheetHost.hidden = true;
    sheetHost.innerHTML =
      '<div class="sheet-mask" data-mask></div>' +
      '<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheetTitle" aria-describedby="sheetMsg" tabindex="-1">' +
      '<div class="sheet-body"><h2 id="sheetTitle"></h2><p id="sheetMsg"></p></div>' +
      '<div class="sheet-opts" hidden></div>' +
      '<div class="sheet-acts">' +
      '<button class="sheet-btn" type="button" data-act="cancel"></button>' +
      '<button class="sheet-btn ok" type="button" data-act="ok"></button>' +
      '</div></div>';
    document.body.appendChild(sheetHost);
    sheetHost.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (btn) {
        var act = btn.getAttribute('data-act');
        closeSheet(act === 'ok' ? true : act === 'cancel' ? false : act);
        return;
      }
      if (e.target.hasAttribute('data-mask')) closeSheet(false);
    });
    document.addEventListener('keydown', function (e) {
      if (sheetHost && !sheetHost.hidden && e.key === 'Escape') closeSheet(false);
    });
  }

  function closeSheet(value) {
    if (!sheetHost || sheetHost.hidden) return;
    sheetHost.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    var fn = sheetSettle;
    sheetSettle = null;
    if (fn) fn(value);
  }

  function confirm(opts) {
    if (!sheetHost) buildSheet();
    var o = opts || {};
    lastFocus = document.activeElement;
    sheetHost.querySelector('#sheetTitle').textContent = o.title || '';
    sheetHost.querySelector('#sheetMsg').textContent = o.message || '';
    sheetHost.querySelector('[data-act="ok"]').textContent = o.ok || '确定';
    sheetHost.querySelector('[data-act="cancel"]').textContent = o.cancel || '取消';

    var optsBox = sheetHost.querySelector('.sheet-opts');
    var acts = sheetHost.querySelector('.sheet-acts');
    if (o.options && o.options.length) {
      optsBox.innerHTML = o.options.map(function (op) {
        return '<button class="sheet-btn sheet-opt" data-act="' + esc(op.id) + '">' + esc(op.label) + '</button>';
      }).join('');
      optsBox.hidden = false;
      acts.hidden = true;
    } else {
      optsBox.innerHTML = '';
      optsBox.hidden = true;
      acts.hidden = false;
    }

    sheetHost.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    sheetHost.querySelector('.sheet').focus({ preventScroll: true });
    return new Promise(function (resolve) { sheetSettle = resolve; });
  }

  // ── toast ─────────────────────────────────────────────────
  function toast(message, tone) {
    var host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (tone ? ' ' + tone : '');
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 220);
    }, 2400);
  }

  // ── 格式化 ────────────────────────────────────────────────
  function money(minor, currency) {
    if (minor == null || Number.isNaN(Number(minor))) return '—';
    var cur = currency || window.__currency || 'CNY';
    try {
      return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: cur }).format(Number(minor) / 100);
    } catch (e) {
      return cur + ' ' + (Number(minor) / 100).toFixed(2);
    }
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** ISO → 本地日期（不要用 toISOString，会按 UTC 少一天） */
  function date(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function duration(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
  }

  function bytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return Math.round(v) + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function errText(err, fallback) {
    return (err && err.message) || fallback || '操作失败，请稍后重试';
  }

  /** 线路图标：真壳注入 KIT_ICON_BASE 时用 kit 的图；没有就用内置占位（页面不自己画一套） */
  function lineIcon(line) {
    if (!line) return '';
    var svc = line.iconKind === 'service';
    var box = '<span class="mono' + (svc ? ' svc' : '') + '">';
    if (window.KIT_ICON_BASE && line.icon) {
      return box + '<img src="' + esc(window.KIT_ICON_BASE + '/' + (svc ? 'service' : 'flag') + '/' +
        encodeURIComponent(line.icon)) + '" alt="" data-fallback="' + esc(line.icon) + '"></span>';
    }
    if (svc) {
      return box + '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        ((window.ICONS.services[line.icon]) || window.ICONS.services.general) + '</svg></span>';
    }
    return box + esc((line.icon || '--').toUpperCase()) + '</span>';
  }

  // 壳取不到某张图时保持列表不缺图标（只在真机上会走到）
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
    var box = img.parentNode;
    var name = (img.getAttribute('data-fallback') || '--').toLowerCase();
    img.remove();
    var glyph = window.ICONS.services[name];
    if (glyph) {
      box.className = 'mono svc';
      box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + glyph + '</svg>';
      return;
    }
    box.textContent = name.slice(0, 2).toUpperCase();
  }, true);

  // ── 启动 ──────────────────────────────────────────────────
  var pages = [];
  var started = false;

  function start() {
    if (started) return;
    started = true;
    renderTabs();
    var subs = pages.slice();
    pages.length = 0;
    subs.forEach(function (fn) {
      try { fn(); } catch (e) { toast(errText(e), 'bad'); }
    });
  }

  function boot() {
    applyBrand();
    var auth = document.body.getAttribute('data-auth') || 'any';

    if (auth === 'out' && window.Api && Api.hasToken()) {
      location.replace('index.html');
      return;
    }
    if (auth === 'in' && window.Api && !Api.hasToken()) {
      // 已激活的隧道允许离线进主界面（契约 §6：CRM 不可达时照常连接）
      if (window.bridge) {
        bridge.state().then(function (s) { if (s && s.activated) start(); else location.replace('welcome.html'); },
          function () { location.replace('welcome.html'); });
        return;
      }
    }
    start();
  }

  window.UI = {
    brand: B,
    esc: esc,
    openLink: openLink,
    confirm: confirm,
    toast: toast,
    money: money,
    date: date,
    duration: duration,
    bytes: bytes,
    errText: errText,
    lineIcon: lineIcon,
    regions: REGIONS,
    regionName: regionName,
    hostOf: hostOf,
    theme: theme,
    setTheme: setTheme,
    errorCopy: function (code) { return ERROR_COPY[code] || ERROR_COPY.INTERNAL; },
    page: function (fn) {
      if (started) fn();
      else pages.push(fn);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
