/* ==========================================================================
   原型的假后端 —— 移植时**整个文件替换**成真的 api.js（fetch CRM + bridge@1）
   页面代码不需要改，因为它们只调用 MOCK.* 和 window.bridge.* 这两层。
   --------------------------------------------------------------------------
   里面有三类东西：
     1. 会话/订阅状态（模拟 session_token + platform_token）
     2. window.bridge —— 按 bridge@1 契约做的最小假实现
     3. 调试条：右上角一键切换六种状态（正式包里没有）
   ========================================================================== */
(function () {
  'use strict';

  /* ── 1. 状态 ─────────────────────────────────────────────── */
  // anon 未登录 / nosub 已登录未订阅 / active 生效中
  // expired 已过期 / frozen 被冻结 / limit 设备超限
  // sub = 当前主订阅（决定 /plans 的 action：buy / renewal / upgrade / blocked）
  var STATES = {
    anon: { session: false, status: 'none' },
    nosub: { session: true, status: 'none' },
    active: {
      session: true, status: 'active', expires: '2027-10-21',
      sub: { plan_id: 'p_365d_100g_3d', kind: 'period', price_minor: 9900, paid_minor: 9900, term_days: 365, expires: '2027-10-21' },
    },
    traffic: {
      session: true, status: 'active', expires: null,
      sub: { plan_id: 'p_200g_365d', kind: 'traffic', price_minor: 6000, paid_minor: 6000, term_days: 365, expires: null, remaining_gb: 120, traffic_gb: 200 },
    },
    expired: {
      session: true, status: 'inactive', reason: 'EXPIRED', expires: '2026-09-30',
      sub: { plan_id: 'p_365d_100g_3d', kind: 'period', price_minor: 9900, paid_minor: 9900, term_days: 365, expires: '2026-09-30' },
    },
    frozen: {
      session: true, status: 'inactive', reason: 'FROZEN', expires: '2027-01-01',
      sub: { plan_id: 'p_365d_100g_3d', kind: 'period', price_minor: 9900, paid_minor: 9900, term_days: 365, expires: '2027-01-01' },
    },
    limit: {
      session: true, status: 'active', reason: 'DEVICE_LIMIT', expires: '2027-10-21',
      sub: { plan_id: 'p_365d_100g_3d', kind: 'period', price_minor: 9900, paid_minor: 9900, term_days: 365, expires: '2027-10-21' },
    },
  };
  var LABEL = {
    anon: '未登录',
    nosub: '已登录·未订阅',
    active: '生效中',
    traffic: '流量包生效中',
    expired: '已过期',
    frozen: '已冻结',
    limit: '设备超限',
  };

  var key = localStorage.getItem('proto.state') || 'anon';
  if (!STATES[key]) key = 'anon';
  var S = Object.assign(
    {
      id: key,
      email: 'bolinwu@hotmail.com',
      user: { name: 'Bolin' },
    },
    (localStorage.getItem('proto.expires') ? { expires: localStorage.getItem('proto.expires') } : {}),
    STATES[key],
  );
  // 原型里"买过"之后重启仍然生效（真实产品这条来自 CRM 的 /subscription）
  var savedSub = null;
  try { savedSub = JSON.parse(localStorage.getItem('proto.sub') || 'null'); } catch (e) { savedSub = null; }
  if (savedSub) {
    S.sub = savedSub;
    S.status = 'active';
    S.reason = undefined;
    S.expires = savedSub.expires;
  }
  // 「锁定」= 能进界面，但任何操作都要先去订阅
  S.locked = S.session && S.status !== 'active';
  S.reasonText = {
    EXPIRED: '订阅已到期，续费后可继续使用',
    FROZEN: '账号暂时不可用，请联系客服',
    DEVICE_LIMIT: '这台设备超出了账号允许的数量',
  }[S.reason] || '';

  function setState(name) {
    localStorage.setItem('proto.state', name);
    location.reload();
  }
  function login(referral) {
    // 登录成功 = 同时拿到 session 与 platform_token；这里默认给"未订阅"
    // 邀请码只在建号那一刻生效（app-crm 契约 §2.9.3），老用户传了也忽略
    var ref = String(referral || '').trim();
    if (ref) localStorage.setItem('proto.referral', ref);
    localStorage.removeItem('proto.conn');   // 换账号 / 重新登录不该继承上一条隧道
    localStorage.setItem('proto.state', 'nosub');
    location.href = 'index.html';
  }

  /* 兑换码（app-crm 契约 §2.9.7）：POST /redeem {code}
     失败一律 200 + ok:false + reason，不抛 5xx；猜码过频 429。
     原型里用几个固定码演示成功/失败两种分支。 */
  var REDEEM_CODES = {
    GUOQING7: { name: '国庆福利', rewards: { days: 7, gb: 0, reset_month: false } },
    HELLO20: { name: '新人礼包', rewards: { days: 7, gb: 20, reset_month: false } },
  };
  var redeemFails = 0;

  // 用本地年月日拼日期：toISOString() 是 UTC，东八区会凭空少一天
  function addDays(dateStr, n) {
    var d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    d.setDate(d.getDate() + n);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function redeem(code) {
    var c = String(code || '').trim().toUpperCase();
    if (!c) return Promise.resolve({ ok: false, reason: '请输入兑换码' });
    if (redeemFails >= 5) {
      return Promise.resolve({ ok: false, reason: '尝试次数过多，请稍后再试' });
    }
    if (c === 'EXPIRED') return Promise.resolve({ ok: false, reason: '这个兑换码已结束' });
    if (c === 'USEDUP') return Promise.resolve({ ok: false, reason: '这个兑换码已经被领完了' });

    var hit = REDEEM_CODES[c];
    if (!hit) {
      redeemFails += 1;
      return Promise.resolve({ ok: false, reason: '兑换码无效' });
    }

    // 记账：礼包只改权益（天数 / 流量 / 重置本月），不改金额
    var opened = S.status === 'none';
    var expires = addDays(opened ? null : S.expires, hit.rewards.days || 0);
    S.expires = expires;
    if (opened) S.status = 'active';
    localStorage.setItem('proto.expires', expires);

    return Promise.resolve({
      ok: true,
      promotion_name: hit.name,
      applied: hit.rewards,
      opened: opened,                 // true = 本次用载体套餐新开户
      expires_at: expires,
      remaining_gb: hit.rewards.gb ? hit.rewards.gb : (opened ? null : 25.5),
    });
  }
  function logout() {
    localStorage.removeItem('proto.conn');
    localStorage.setItem('proto.state', 'anon');
    location.replace(LANDING);
  }

  /* ── 2. 假数据 ───────────────────────────────────────────── */
  var DATA = {
    /* 套餐目录（形状 = app-crm 契约 §2.4.7 / §2.9.3）
       promo 是 CRM 内部数据，接口返回的是算好的 promo_price_minor / promo_badge，
       不会把 audience 这种东西给客户端。 */
    plans: [
      { plan_id: 'p_30d_100g_1d', name: '月付', kind: 'period', price_minor: 1500,
        currency: 'CNY', licence_limit: 1, term_days: 30, monthly_quota_gb: 100,
        line_ids: [], payment_methods: ['alipay', 'wechat'],
        store_product_id: { apple: 'vpn.period.100g.month', google: 'vpn_period_100g_month' },
        promo: { audience: 'new', price_minor: 1200, badge: '首单 8 折' } },
      { plan_id: 'p_365d_100g_3d', name: '年付', kind: 'period', price_minor: 9900,
        currency: 'CNY', licence_limit: 3, term_days: 365, monthly_quota_gb: 100,
        line_ids: [], payment_methods: ['alipay', 'wechat'],
        store_product_id: { apple: 'vpn.period.100g.year', google: 'vpn_period_100g_year' } },
      { plan_id: 'p_730d_unlim_3d', name: '两年 · 不限量', kind: 'period', price_minor: 16800,
        currency: 'CNY', licence_limit: 3, term_days: 730, monthly_quota_gb: null,
        line_ids: [], payment_methods: ['alipay'], store_product_id: null },
      { plan_id: 'p_200g_365d', name: '200GB 流量包', kind: 'traffic', price_minor: 6000,
        currency: 'CNY', licence_limit: 1, traffic_gb: 200, validity_days: 365,
        line_ids: [], payment_methods: ['alipay'],
        store_product_id: { apple: 'vpn.traffic.200g' } },
      { plan_id: 'a_50g', name: '50GB 加油包', kind: 'addon', price_minor: 2000,
        currency: 'CNY', licence_limit: 1, traffic_gb: 50,
        line_ids: [], payment_methods: ['alipay', 'wechat'], store_product_id: null },
    ],
    perks: ['全球高速线路', '一号 3 台设备', '不限流量', '随时取消'],
    /* 线路：真实来源是 cf-api 的 GET /api/key-lines（客户端经 kit 的 Libbox.getLinesJSON() 拿到）。
       字段只有 id / label / traffic_factor / is_default / icon / icon_kind 这些，
       **没有"出口型/功能型"这种分类**，界面也不该发明分类。 */
    lines: [
      { id: 1, label: '香港 01', icon: 'HK', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false, isDefault: true },
      { id: 2, label: '日本 01', icon: 'JP', iconKind: 'flag', factor: 1, hasRelay: true, hasUpstream: false },
      { id: 3, label: '美国 01', icon: 'US', iconKind: 'flag', factor: 2, hasRelay: true, hasUpstream: true },
      { id: 4, label: 'TikTok 专用', icon: 'streaming', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
      { id: 5, label: 'ChatGPT', icon: 'ai', iconKind: 'service', factor: 3, hasRelay: true, hasUpstream: true },
      { id: 6, label: '游戏加速', icon: 'gaming', iconKind: 'service', factor: 2, hasRelay: true, hasUpstream: false },
    ],
    sub: { plan: '按年', expires: '2027-10-21', devices: 1, limit: 3 },
    // 设置页「连接信息」用的假值（真实值来自 kit 的 ConnInfo）—— 只给排障看
    conn: { relay: '103.86.48.12:443', upstream: 'socks5://203.0.113.24:1080' },
  };

  /* ── 线路的选择（跨页面保持）─────────────────────────── */
  var LINE_KEY = 'proto.line';
  function allLines() { return DATA.lines; }
  function currentLine() {
    var id = parseInt(localStorage.getItem(LINE_KEY) || '0', 10);
    return (
      DATA.lines.filter(function (l) { return l.id === id; })[0] ||
      DATA.lines.filter(function (l) { return l.isDefault; })[0] ||
      DATA.lines[0]
    );
  }
  function setLine(id) { localStorage.setItem(LINE_KEY, String(id)); }

  /* 下面这几个是**原型兜底占位**（浏览器里没有壳、取不到 kit:// ）。
     真机上页面只写名字，图形由壳从 kit 的 line_icons/ 返回，页面不自己画图标。
     名字必须用 kit 里真实存在的：ai / gaming / streaming / general / … */
  var SERVICE_ICONS = {
    general: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
    streaming: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z"/>',
    ai: '<path d="M12 3.2l2.3 5.3 5.3 2.3-5.3 2.3L12 18.4l-2.3-5.3L4.4 10.8l5.3-2.3z"/>',
    gaming: '<rect x="2.5" y="8" width="19" height="9" rx="4.5"/><path d="M7.5 11v3M6 12.5h3M15.8 11.6h.01M17.8 13.4h.01"/>',
  };

  /* 图标的图形**不归页面管**：kit 里已经带了 line_icons（三端各自打包），
     壳把它挂在 `kit://line-icon/<kind>/<name>` 上，页面只写名字（见 BRIDGE.md §6）。
       iconKind: 'service' → line_icons/services/<icon>.svg（缺失用 default）
       其它（或空）        → line_icons/countries/<两位国家码小写>.svg
     壳会先注入 window.KIT_ICON_BASE；没有它（浏览器里跑原型）就用内置占位，
     不自己发明图标形态。 */
  var KIT_ICON_BASE = window.KIT_ICON_BASE || '';

  function lineIcon(line) {
    var isService = line.iconKind === 'service';
    var kind = isService ? 'service' : 'flag';
    var box = '<span class="mono' + (isService ? ' svc' : '') + '">';
    if (KIT_ICON_BASE) {
      return box + '<img src="' + KIT_ICON_BASE + '/' + kind + '/' +
        encodeURIComponent(line.icon || '') + '" alt="" onerror="MOCK.iconFallback(this)">' + '</span>';
    }
    if (isService) {
      return box + '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        (SERVICE_ICONS[line.icon] || SERVICE_ICONS.general) + '</svg></span>';
    }
    return box + (line.icon || '').toUpperCase() + '</span>';
  }

  /** 壳取不到某张图时的兜底（保持列表不缺图标），只在真机上会走到 */
  function iconFallback(img) {
    var box = img.parentNode;
    if (!box) return;
    var name = (img.getAttribute('src') || '').split('/').pop().toLowerCase();
    img.remove();
    var glyph = SERVICE_ICONS[name];
    if (glyph) {
      box.classList.add('svc');
      box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + glyph + '</svg>';
      return;
    }
    box.textContent = name.slice(0, 2).toUpperCase();
  }

  /** 列表里只给用户看「流量系数」——中继 / 下游代理是排障信息，不在这里出现 */
  function lineFactor(line) { return 'x' + line.factor; }
  function money(minor) {
    if (minor == null) return '—';
    var v = minor / 100;
    return '¥' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
  }

  /* ── 2.1 设置（协议 / 分流）───────────────────────────────
     真实 App 里这两块由 kit 的 UserInfo / Split 持有并落盘；这里存 localStorage，
     目的只是让页面之间保持一致（设置页改完 → 回主页仍是新值）。*/
  var PROTOCOLS = [
    { id: 'auto', name: '自动', desc: '自动选择协议（默认）' },
    { id: 'udp_tunnel', name: 'UDP 隧道', desc: 'UDP 隧道模式' },
    { id: 'udp_fast', name: 'UDP 极速', desc: 'UDP 极速模式' },
    { id: 'udp_stable', name: 'UDP 稳定', desc: 'UDP 稳定模式' },
    { id: 'tcp_fast', name: 'TCP 极速', desc: 'TCP 极速模式' },
    { id: 'tcp_stable', name: 'TCP 稳定', desc: 'TCP 稳定模式' },
  ];
  // 真实产品这里是"国家和地区"全表（四十多项），所以地区选择必须是可搜索的独立页
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
  var DEFAULT_SETTINGS = {
    protocol: 'auto',
    split: {
      region: { on: true, code: 'CN' },
      ip: { on: false, text: '' },
      domain: { on: false, text: '' },
      regex: { text: '' },
      advanced: false,
    },
  };
  var SETTINGS_KEY = 'proto.settings';
  var settings = (function () {
    var base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return base;
    if (PROTOCOLS.some(function (p) { return p.id === saved.protocol; })) base.protocol = saved.protocol;
    var s = saved.split || {};
    ['region', 'ip', 'domain'].forEach(function (k) {
      if (s[k] && typeof s[k] === 'object') Object.assign(base.split[k], s[k]);
    });
    if (s.regex && typeof s.regex.text === 'string') base.split.regex.text = s.regex.text;
    if (typeof s.advanced === 'boolean') base.split.advanced = s.advanced;
    if (!REGIONS.some(function (r) { return r.code === base.split.region.code; })) base.split.region.code = 'CN';
    return base;
  })();
  function saveSettings(patch) {
    if (patch) Object.assign(settings, patch);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  /* ── 2.5 套餐动作与报价（扮演 CRM）────────────────────────────
     ⚠️ 下面 view() / quote() 是**服务端**逻辑：app-crm 契约 §2.4.8 的判定表 +
     §2.9.3 的促销口径。真实 App 里一行都不许有 —— 能不能买、多少钱、为什么不能，
     全部由 CRM 通过 action / reason / payable_minor / POST /quote 给出。 */

  function everPaid() {
    return !!S.sub;   // S.sub 已包含"刚买过"的覆盖（proto.sub），不要读静态预设
  }
  function planById(id) {
    return DATA.plans.filter(function (p) { return p.plan_id === id; })[0];
  }
  function liveSub() {
    return S.sub && S.status === 'active' ? S.sub : null;
  }
  function badgeText(pr) {
    var pre = { all: '', new: '限新用户', existing: '限续费用户' }[pr.audience] || '';
    return pre ? pre + ' · ' + pr.badge : pr.badge;
  }
  function promoOf(plan) {
    var pr = plan.promo;
    if (!pr) return { price: null, badge: null };
    var ok = pr.audience === 'all' || (pr.audience === 'new' && !everPaid());
    return { price: ok ? pr.price_minor : null, badge: ok ? badgeText(pr) : null };
  }
  function nextExpiry(plan, sub) {
    if (plan.kind === 'period') return addDays(sub.expires, plan.term_days);
    if (plan.kind === 'traffic') return plan.validity_days ? addDays(null, plan.validity_days) : null;
    return null;
  }

  // §2.4.8 判定表：一个 action 回答"点了会发生什么"
  function view(plan) {
    var promo = promoOf(plan);
    var out = {
      promo_price_minor: promo.price,
      promo_badge: promo.badge,
      payable_minor: null,
      next_expires_at: null,
      action: 'buy',
      reason: null,
    };
    var sub = liveSub();
    var cur = sub ? planById(sub.plan_id) : null;

    if (!S.session) {
      out.action = 'login_required';
      out.reason = '登录后即可购买';
    } else if (plan.kind === 'addon') {
      if (!sub) { out.action = 'blocked'; out.reason = '需要先有周期套餐'; }
      else if (sub.kind !== 'period') { out.action = 'blocked'; out.reason = '加量包只能挂在周期套餐上'; }
      else if (cur && cur.monthly_quota_gb == null) { out.action = 'blocked'; out.reason = '不限量套餐不需要加量包'; }
      else out.action = 'buy';
    } else if (!sub) {
      out.action = 'buy';
    } else if (cur && cur.plan_id === plan.plan_id) {
      out.action = 'renewal';
      out.next_expires_at = nextExpiry(plan, sub);
    } else if (cur && plan.price_minor > cur.price_minor) {
      out.action = 'upgrade';
    } else {
      out.action = 'blocked';
      out.reason = '不支持降档';
    }

    if (out.action === 'buy' || out.action === 'renewal') {
      out.payable_minor = promo.price != null ? promo.price : plan.price_minor;
      // 匿名时 payable 只给 audience=all 的活动（其余 null：不知道"你"是谁）
      if (!S.session && !(plan.promo && plan.promo.audience === 'all')) out.payable_minor = null;
    }
    return out;
  }

  // GET /plans：商品字段 + 这个人此刻的 action；promo 这种内部字段不外泄
  function publicPlan(p) {
    var v = view(p);
    return {
      plan_id: p.plan_id, name: p.name, kind: p.kind,
      price_minor: p.price_minor, currency: p.currency,
      licence_limit: p.licence_limit,
      term_days: p.term_days || null,
      monthly_quota_gb: p.monthly_quota_gb === undefined ? null : p.monthly_quota_gb,
      traffic_gb: p.traffic_gb || null,
      validity_days: p.validity_days || null,
      line_ids: p.line_ids,
      // 契约 v20 §2.4.0：客户端按壳上报的 store 取其一，不做矩阵运算
      payment_methods: p.payment_methods || null,
      store_product_id: p.store_product_id || null,
      promo_price_minor: v.promo_price_minor,
      promo_badge: v.promo_badge,
      payable_minor: v.payable_minor,
      action: v.action,
      reason: v.reason,
      next_expires_at: v.next_expires_at,
    };
  }
  function plans() {
    return Promise.resolve(DATA.plans.map(publicPlan));
  }

  // GET /payment-methods：按用户白名单算；这里所有登录用户都有这两种。
  // 契约 v20 起不再返回 channel —— 所有支付方式必然走网页收银台。
  function paymentMethods() {
    if (!S.session) return Promise.resolve([]);
    return Promise.resolve([
      { id: 'alipay', label: '支付宝' },
      { id: 'wechat', label: '微信支付' },
    ]);
  }

  // 残值：period 按剩余小时，traffic 按剩余 GB（§2.4.8）；向下取整到分
  function remainingRatio(sub) {
    if (sub.kind === 'period') {
      var end = new Date(sub.expires + 'T00:00:00').getTime();
      var hours = Math.max(0, Math.floor((end - Date.now()) / 3600000));
      return Math.min(1, hours / (sub.term_days * 24));
    }
    if (sub.kind === 'traffic') return Math.min(1, (sub.remaining_gb || 0) / sub.traffic_gb);
    return 0;
  }

  // POST /quote：唯一的应付金额来源（升级尤其必须走这里，列表不给钱）
  function quote(planId) {
    var plan = planById(planId);
    var v = view(plan);
    if (v.action === 'blocked' || v.action === 'login_required') {
      return Promise.resolve({ action: v.action, allowed: false, reason: v.reason, currency: plan.currency });
    }
    var sub = liveSub();
    var paid = sub ? sub.paid_minor : null;
    var residual = v.action === 'upgrade' && sub ? Math.round(paid * remainingRatio(sub)) : 0;
    var payable = Math.max(0, (v.payable_minor != null ? v.payable_minor : plan.price_minor) - residual);
    return Promise.resolve({
      action: v.action, allowed: true, reason: null, currency: plan.currency,
      price_minor: plan.price_minor, paid_minor: paid, residual_minor: residual,
      payable_minor: payable, expires_at: v.next_expires_at,
      quoted_at: new Date().toISOString(), quote_ttl_s: 900,
    });
  }

  // 原型：跳过收银台直接落账（真实路径是 POST /orders → pay_url → 轮询）
  function purchase(planId) {
    var plan = planById(planId);
    var v = view(plan);
    var sub = S.sub;
    var next;
    if (plan.kind === 'addon' && sub) {
      // 加量包：只加额度，不动到期日
      next = Object.assign({}, sub, { remaining_gb: (sub.remaining_gb || 0) + plan.traffic_gb });
    } else if (v.action === 'renewal' && sub) {
      next = Object.assign({}, sub, {
        expires: nextExpiry(plan, sub),
        paid_minor: sub.paid_minor + (v.payable_minor || 0),
      });
    } else {
      next = {
        plan_id: plan.plan_id, kind: plan.kind, price_minor: plan.price_minor,
        paid_minor: v.payable_minor || plan.price_minor,
        term_days: plan.term_days || 0,
        expires: plan.kind === 'traffic'
          ? (plan.validity_days ? addDays(null, plan.validity_days) : null)
          : addDays(null, plan.term_days),
      };
      if (plan.kind === 'traffic') { next.traffic_gb = plan.traffic_gb; next.remaining_gb = plan.traffic_gb; }
      if (plan.kind === 'period') next.monthly_quota_gb = plan.monthly_quota_gb;
    }
    localStorage.setItem('proto.sub', JSON.stringify(next));
    localStorage.setItem('proto.state', 'active');
    localStorage.removeItem('proto.expires');
    location.reload();
  }

  /* ── 3. window.bridge（按 bridge@1 契约的假实现）───────────── */
  // 连接状态跨页面保持（真壳里 state() 本来就会返回真实状态，刷新不会变）
  var CONN_KEY = 'proto.conn';
  function loadConn() {
    try {
      var v = JSON.parse(localStorage.getItem(CONN_KEY) || 'null');
      if (v && v.status === 'connected') return v;
    } catch (e) { /* 忽略 */ }
    return null;
  }
  function saveConn() {
    localStorage.setItem(CONN_KEY, JSON.stringify({ status: bstate.status, since: bstate.since, serverName: bstate.serverName }));
  }
  var savedConn = loadConn();
  var bstate = savedConn
    ? { status: 'connected', error: null, since: savedConn.since, serverName: savedConn.serverName, bytesIn: 1024 * 1024 * 3.4, bytesOut: 1024 * 512 }
    : { status: 'disconnected', error: null, since: null, serverName: null, bytesIn: 0, bytesOut: 0 };
  var listeners = [];
  function emit() {
    listeners.forEach(function (cb) {
      try { cb(Object.assign({}, bstate)); } catch (e) { /* 页面自己处理 */ }
    });
  }
  window.bridge = {
    state: function () {
      return Promise.resolve(Object.assign({}, bstate));
    },
    connect: function (cfg) {
      if (S.status !== 'active') {
        var e = new Error('没有可用的订阅');
        e.code = S.reason || 'EXPIRED';
        bstate.status = 'error';
        bstate.error = { code: e.code, message: e.message };
        emit();
        return Promise.reject(e);
      }
      if (S.reason === 'DEVICE_LIMIT') {
        var e2 = new Error('设备数已达上限');
        e2.code = 'DEVICE_LIMIT';
        bstate.status = 'error';
        bstate.error = { code: 'DEVICE_LIMIT', message: e2.message };
        emit();
        return Promise.reject(e2);
      }
      bstate.status = 'connecting';
      bstate.error = null;
      emit();
      return new Promise(function (resolve) {
        setTimeout(function () {
          bstate.status = 'connected';
          bstate.since = Date.now();
          bstate.serverName = (cfg && cfg.serverName) || currentLine().label;
          bstate.bytesIn = 1024 * 1024 * 3.4;
          bstate.bytesOut = 1024 * 512;
          saveConn();
          emit();
          resolve(Object.assign({}, bstate));
        }, 1200);
      });
    },
    disconnect: function () {
      bstate.status = 'disconnected';
      bstate.since = null;
      bstate.error = null;
      saveConn();
      emit();
      return Promise.resolve(Object.assign({}, bstate));
    },
    // bridge@1 的可选能力：壳用系统浏览器打开外部页面（客服/官网/支付）。
    // 只收 https；浏览器里没有壳，就退化成新标签页。
    open: function (url) {
      if (!/^https:\/\//i.test(url || '')) {
        return Promise.reject({ code: 'INTERNAL', message: '只允许 https 链接' });
      }
      window.open(url, '_blank', 'noopener');
      return Promise.resolve({ opened: url });
    },
    on: function (evt, cb) {
      if (evt === 'state') listeners.push(cb);
    },
  };

  /* ── 4. 守卫 ─────────────────────────────────────────────── */
  // 未登录时落到哪一页。两个变体都做出来了，改这一行就能对比：
  //   'welcome.html' → 先一屏欢迎（品牌 + 一句话 + 开始使用），再登录
  //   'login.html'   → 直接进登录（少一次点击，但少了价值主张）
  var LANDING = 'welcome.html';
  function requireLogin() {
    if (!S.session) location.replace(LANDING);
  }
  function allowAnon() {}

  /* ── 5. 锁定态：除白名单外，任何点击都去订阅页 ────────────── */
  function guardClicks() {
    document.addEventListener(
      'click',
      function (e) {
        if (!S.locked) return;
        if (document.body.hasAttribute('data-allow')) return; // 设置 / 分流这类本地页
        if (e.target.closest('[data-allow]')) return; // 底部导航 / 位置列表 / 退出
        if (e.target.closest('.devbar')) return; // 调试条
        var a = e.target.closest('a[href]');
        if (a && /plans\.html|account\.html/.test(a.getAttribute('href'))) return;
        e.preventDefault();
        e.stopPropagation();
        location.href = 'plans.html';
      },
      true,
    );
  }

  /* ── 5.5 商店轨道：这个 App 是从哪装进来的（bridge@2 capabilities）──
     **不是编译期属性**：同一个 apk 既能从 Play 装、也能侧载；同一个 macOS 包
     既能从 App Store 装、也能 dmg 直装。所以只有壳知道答案，UI 只读不猜
     （app-crm.md §2.4.0 / BRIDGE.md §1）。

     原型用 localStorage 模拟"壳上报的能力"，配 devbar 切换，遍历两条路径：
       'apple_iap' | 'google_play'  ⇒ 商店内购（store_product_id）
       'web_checkout'               ⇒ 网页收银台（payment_methods） */
  var RAIL_KEY = 'proto.rail';
  function rail() {
    return localStorage.getItem(RAIL_KEY) || 'web_checkout';
  }

  /* ── 6. 底部导航（4 项，图标内联 SVG）────────────────────── */
  var ICONS = {
    connect: '<path d="M12 3v9"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/>',
    lines:
      '<path d="M6.5 3.5v11a3 3 0 0 0 3 3h5a3 3 0 0 1 3 3"/><circle cx="6.5" cy="3.5" r="2"/><circle cx="17.5" cy="20.5" r="2"/>',
    plans: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10.5h18"/>',
    account: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.6 3.8-5.6 7.5-5.6s6.9 2 7.5 5.6"/>',
  };
  var TABS = [
    { id: 'connect', href: 'index.html', label: '连接' },
    { id: 'lines', href: 'lines.html', label: '线路' },
    { id: 'plans', href: 'plans.html', label: '套餐' },
    { id: 'account', href: 'account.html', label: '账户' },
  ];
  function renderTabs() {
    var nav = document.querySelector('nav[data-tabs]');
    if (!nav) return;
    // 没登录时不显示底部导航：匿名访客只是来看价格的，不该看到"连接/位置/账户"
    if (!S.session) {
      nav.remove();
      document.body.style.paddingBottom = '0';
      return;
    }
    var active = nav.getAttribute('data-tabs');
    nav.className = 'tabs';
    nav.innerHTML = TABS.map(function (t) {
      return (
        '<a class="tab' + (t.id === active ? ' on' : '') + '" href="' + t.href + '" data-allow>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[t.id] + '</svg>' +
        '<span>' + t.label + '</span></a>'
      );
    }).join('');
  }

  /* ── 7. 调试条（正式包删掉）──────────────────────────────── */
  function renderDevbar() {
    if (/[?&]nodev/.test(location.search)) return;
    var bar = document.createElement('div');
    bar.className = 'devbar';
    bar.innerHTML =
      '<div class="menu">' +
      Object.keys(STATES)
        .map(function (k) {
          return '<button data-s="' + k + '"' + (k === S.id ? ' class="on"' : '') + '>' + LABEL[k] + '</button>';
        })
        .join('') +
      '<button data-t="theme">明/暗</button><button data-t="brand">换主色</button>' +
      '<button data-t="rail">壳能力：' + (rail() === 'web_checkout' ? '无商店' : rail() === 'apple_iap' ? 'App Store' : 'Play') + '</button></div>' +
      '<button class="toggle" aria-label="切换原型状态">⚙</button>';
    bar.querySelector('.toggle').onclick = function () { bar.classList.toggle('open'); };
    bar.querySelectorAll('[data-s]').forEach(function (b) {
      b.onclick = function () {
        setState(b.getAttribute('data-s'));
      };
    });
    bar.querySelector('[data-t]').onclick = function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    };    // 证明「初级定制」成立：只换一个变量，全站跟着变
    var palettes = ['#3b82f6', '#10b981', '#f43f5e'];
    var pi = 0;
    // 商店轨道 —— 真实产品由 bridge.capabilities().store 决定，这里预览两条路径
    bar.querySelector('[data-t="rail"]').onclick = function () {
      localStorage.setItem(RAIL_KEY, rail() === 'web_checkout' ? 'apple_iap' : 'web_checkout');
      location.reload();
    };
    bar.querySelector('[data-t="brand"]').onclick = function () {
      pi = (pi + 1) % palettes.length;
      document.documentElement.style.setProperty('--brand', palettes[pi]);
    };    document.body.appendChild(bar);
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderTabs();
    renderDevbar();
    guardClicks();
  });

  window.MOCK = {
    S: S,
    DATA: DATA,
    money: money,
    requireLogin: requireLogin,
    allowAnon: allowAnon,
    login: login,
    redeem: redeem,
    rail: rail,
    paymentMethods: paymentMethods,
    plans: plans,
    quote: quote,
    purchase: purchase,
    logout: logout,
    setState: setState,
    states: STATES,
    label: LABEL,
    // 设置（协议 / 分流）：页面读写这两样，不自己碰 localStorage
    SETTINGS: settings,
    PROTOCOLS: PROTOCOLS,
    REGIONS: REGIONS,
    saveSettings: saveSettings,
    // 线路
    lines: allLines,
    currentLine: currentLine,
    setLine: setLine,
    lineIcon: lineIcon,
    iconFallback: iconFallback,
    lineFactor: lineFactor
  };
})();
