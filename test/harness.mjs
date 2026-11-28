import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Playwright 的角色：
 *   · 模拟壳（shells/mock/bridge.js，与 Studio 预览同一份）→ 断言 UI 与壳的交互
 *   · 假 CRM（同一套 /api/app/v1 端点与信封）→ 断言 UI 只渲染服务端字段
 *   · 品牌注入（拦截 _brand.js）→ 断言"只改 app.json 就能换品牌"
 */

/** 模拟壳的源码：CI 从仓库读，不经过网络 */
const MOCK_SHELL = readFileSync(fileURLToPath(new URL('../shells/mock/bridge.js', import.meta.url)), 'utf8');

/** 冒烟用的壳配置：默认未激活（页面自己调 activate），连接正常 */
export const MOCK_SHELL_CONFIG = {
  shell: true,
  platform: 'windows',
  store: null,
  connect: 'ok',
  activated: false,
  lines: 'normal',
  traffic: true,
  protocol: 'auto',
};

/** 必须中性的错误文案（BRIDGE.md §3：FROZEN 不得对用户定性） */
export const FROZEN_BANNED = /违规|封禁|作弊|滥用|违反/;

const PORT = Number(process.env.PORT || 8123);
export const ORIGIN = `http://127.0.0.1:${PORT}`;

/** 一套"一般租户"的品牌值（与仓库里 app.json 的 Next VPN 完全不同，便于断言无残留） */
export const BRAND = {
  name: 'Acme VPN',
  short_name: 'Acme',
  tagline: '一键连接全球',
  color: '#1e88e5',
  logo: '_brand-logo.svg',
  crm: { base: ORIGIN, id: '8f3a1c2e-1b2c-4d5e-8f90-123456789abc' },
  links: {
    terms: 'https://acme.example/terms',
    privacy: 'https://acme.example/privacy',
    support: 'https://acme.example/support',
    website: 'https://acme.example',
  },
};

/** 第二套品牌值（品牌替换用） */
export const BRAND_ALT = {
  name: 'Nordlys',
  short_name: 'Nord',
  tagline: '安静地穿过边界',
  color: '#0f9d58',
  logo: '_brand-logo.svg',
  crm: { base: ORIGIN, id: '8f3a1c2e-1b2c-4d5e-8f90-123456789abc' },
  links: {
    terms: '',
    privacy: '',
    support: '',
    website: 'https://nordlys.example',
  },
};

export function createScenario(over = {}) {
  return {
    session: 'active',
    email: 'user@example.test',
    paid: true,
    redeemCode: 'WELCOME7',
    orders: [
      {
        order_code: 'ord_old',
        title: '月付',
        amount_text: '¥12.00',
        status: 'paid',
        status_text: '已生效',
        tag: '已完成',
        tag_tone: 'success',
        next_poll_after_ms: null,
        created_at: '2026-11-01T03:00:00.000Z',
        paid_at: '2026-11-01T03:01:00.000Z',
      },
    ],
    ...over,
  };
}

function subscriptionOf(sc) {
  const base = {
    status: 'active',
    reason: null,
    status_text: '订阅生效中',
    tag: '已订阅',
    tag_tone: 'success',
    kind: 'period',
    plan_id: 'p_month',
    expires_at: '2027-10-21T00:00:00.000Z',
    licence_limit: 3,
    unlimited: false,
    remaining_gb: 88.5,
    next_reset_at: '2026-12-21T00:00:00.000Z',
    code: 'ACT-KEY-MUST-NOT-RENDER',
  };
  if (sc.session === 'none') {
    return { ...base, status: 'none', status_text: '还没有订阅', tag: null, tag_tone: null, kind: null, plan_id: null, expires_at: null, licence_limit: null, remaining_gb: null, next_reset_at: null, code: null };
  }
  if (sc.session === 'provisioning') return { ...base, status: 'provisioning', status_text: '正在开通，请稍候', tag: '开通中', tag_tone: 'info' };
  if (sc.session === 'expired') {
    return { ...base, status: 'inactive', reason: 'expired', status_text: '订阅已到期，续费后可继续使用', tag: '已过期', tag_tone: 'warn' };
  }
  if (sc.session === 'exhausted') {
    return { ...base, status: 'inactive', reason: 'exhausted', status_text: '本周期流量已用完', tag: '流量用完', tag_tone: 'warn' };
  }
  if (sc.session === 'frozen') {
    return { ...base, status: 'inactive', reason: 'frozen', status_text: '账号暂时不可用，请联系客服', tag: '已暂停', tag_tone: 'muted' };
  }
  return base;
}

function plansOf(sc) {
  const logged = sc.session !== 'anon';
  return [
    {
      plan_id: 'p_month',
      name: '月付',
      kind: 'period',
      kind_label: '按时长',
      specs: ['每月 100 GB', '1 台设备'],
      price_minor: 1500,
      display_price_minor: 1200,
      compare_at_price_minor: 1500,
      currency: 'CNY',
      licence_limit: 1,
      term_days: 30,
      monthly_quota_gb: 100,
      traffic_gb: null,
      validity_days: null,
      payment_methods: [{ id: 'alipay', label: '支付宝' }, { id: 'wechat', label: '微信支付' }],
      store_product_id: { apple: 'acme.month' },
      promo_badge: '首单 8 折',
      action: logged ? 'buy' : 'login_required',
      buyable: true,
      reason: null,
      next_expires_at: null,
      cta: logged ? '立即购买' : '登录后订阅',
      price_note: logged ? '实付价格' : '登录后查看实付价',
    },
    {
      plan_id: 'p_year',
      name: '年付',
      kind: 'period',
      kind_label: '按时长',
      specs: ['每月 300 GB', '3 台设备'],
      price_minor: 9900,
      display_price_minor: 9900,
      compare_at_price_minor: null,
      currency: 'CNY',
      licence_limit: 3,
      term_days: 365,
      monthly_quota_gb: 300,
      traffic_gb: null,
      validity_days: null,
      payment_methods: [{ id: 'alipay', label: '支付宝' }],
      store_product_id: null,
      promo_badge: null,
      action: sc.session === 'active' ? 'renewal' : 'buy',
      buyable: true,
      reason: null,
      next_expires_at: '2028-10-21T00:00:00.000Z',
      cta: sc.session === 'active' ? '续订' : '立即购买',
      price_note: sc.session === 'active' ? '续订价' : '实付价格',
    },
    {
      plan_id: 'p_blocked',
      name: '两年 · 不限量',
      kind: 'period',
      kind_label: '按时长',
      specs: ['不限流量', '3 台设备'],
      price_minor: 16800,
      display_price_minor: 16800,
      compare_at_price_minor: null,
      currency: 'CNY',
      licence_limit: 3,
      term_days: 730,
      monthly_quota_gb: null,
      traffic_gb: null,
      validity_days: null,
      payment_methods: [],
      store_product_id: null,
      promo_badge: null,
      action: 'blocked',
      buyable: false,
      reason: '不支持从当前套餐降档',
      next_expires_at: null,
      cta: '不可购买',
      price_note: '不可购买',
    },
  ];
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function json(route, status, body) {
  return route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
}

/** 给页面挂上 CRM 路由；scenario 是可变对象，测试中途可改（如 pay 前 paid=false） */
export async function mockCrm(page, scenario) {
  const sc = scenario || createScenario();
  await page.route('**/api/app/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    const path = new URL(req.url()).pathname.replace(/^\/api\/app\/v1/, '');
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } })();
    const sub = subscriptionOf(sc);

    if (method === 'GET' && path === '/meta') {
      return json(route, 200, {
        crm_version: '2.0.0',
        crm_id: '8f3a1c2e-1b2c-4d5e-8f90-123456789abc',
        currency: 'CNY',
        turnstile_site_key: '',
        trial_text: '注册即送 7 天',
      });
    }
    if (method === 'POST' && path === '/auth/send-code') return json(route, 200, { ok: true, cooldown: 60 });
    if (method === 'POST' && path === '/auth/verify') {
      sc.session = 'active';
      return json(route, 200, { session_token: 'sess_test', user: { id: 1, uuid: 'u-1', email: body.email || sc.email, name: null } });
    }
    if (method === 'POST' && path === '/auth/logout') return json(route, 200, { ok: true });
    if (method === 'GET' && path === '/me') {
      return json(route, 200, { user: { id: 1, uuid: 'u-1', email: sc.email, name: null }, referral: null });
    }
    if (method === 'GET' && path === '/subscription') return json(route, 200, sub);
    if (method === 'GET' && path === '/plans') return json(route, 200, plansOf(sc));
    if (method === 'POST' && path === '/quote') {
      return json(route, 200, {
        action: 'buy',
        payable_minor: 1200,
        discount_minor: 300,
        discount_label: '新人券 −¥3.00',
        residual_minor: 0,
        paid_minor: null,
        promo_code: null,
      });
    }
    if (method === 'POST' && path === '/orders') {
      sc.paid = sc.payPending ? false : true;
      sc.lastOrder = { order_code: 'ord_new', plan_id: body.plan_id, method: body.payment_method };
      return json(route, 201, {
        order_code: 'ord_new',
        pay_url: 'https://pay.acme.example/o/ord_new',
        amount_minor: 1200,
        currency: 'CNY',
        expires_at: '2026-11-26T23:00:00.000Z',
      });
    }
    if (method === 'GET' && path.startsWith('/orders/')) {
      const code = decodeURIComponent(path.slice('/orders/'.length));
      const paid = code === 'ord_new' ? sc.paid : true;
      return json(route, 200, {
        order_code: code,
        status: paid ? 'paid' : 'pending',
        amount_minor: 1200,
        discount_minor: 300,
        currency: 'CNY',
        pay_url: paid ? null : 'https://pay.acme.example/o/' + code,
        expires_at: '2026-11-26T23:00:00.000Z',
        paid_at: paid ? '2026-11-26T22:00:00.000Z' : null,
        created_at: '2026-11-26T21:00:00.000Z',
      });
    }
    if (method === 'GET' && path === '/orders') return json(route, 200, { items: sc.orders, next_cursor: null });
    if (method === 'GET' && path === '/me/gifts') {
      return json(route, 200, {
        items: [
          {
            type: 'promotion',
            promotion_id: 1,
            title: '国庆福利',
            badge: '限时',
            rewards_text: '+7 天',
            state: 'available',
            status_text: '可领取',
            remaining: null,
            ends_at: null,
            claimable: true,
            claim_action: '/me/gifts/1/claim',
          },
          {
            type: 'referral_reward',
            reward_id: 88,
            title: '邀请奖励',
            badge: null,
            rewards_text: '+10 GB',
            state: 'available',
            status_text: '可领取',
            remaining: null,
            ends_at: null,
            claimable: true,
            claim_action: '/me/rewards/88/claim',
          },
        ],
        available_count: 2,
        empty_text: '暂时没有可领取的礼包。',
      });
    }
    if (method === 'POST' && /^\/me\/(gifts|rewards)\/\d+\/claim$/.test(path)) {
      return json(route, 200, {
        ok: true,
        state: 'granted',
        title: '国庆福利',
        result_text: '已领取 7 天会员',
        applied: { days: 7, gb: 0 },
        expires_at: '2027-10-28T00:00:00.000Z',
        remaining_gb: null,
      });
    }
    if (method === 'POST' && path === '/redeem') {
      const code = String(body.code || '').trim().toUpperCase();
      if (code === sc.redeemCode) {
        return json(route, 200, {
          ok: true,
          state: 'granted',
          title: '兑换成功',
          result_text: '已兑换 国庆福利',
          applied: { days: 7, gb: 20 },
          expires_at: '2027-10-28T00:00:00.000Z',
          remaining_gb: null,
        });
      }
      return json(route, 200, {
        ok: false,
        state: 'invalid_code',
        title: '兑换码无效',
        result_text: '这个兑换码不存在，检查一下再试',
        applied: { days: 0, gb: 0 },
        expires_at: null,
        remaining_gb: null,
      });
    }

    return json(route, 404, { error: { code: 'not_found', message: '内容不存在' } });
  });
}

/** 拦截 _brand.js，等价于"租户只改了 app.json" */
export async function useBrand(page, brand = BRAND) {
  await page.route('**/_brand.js', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      body: `window.BRAND = ${JSON.stringify(brand)};\n`,
    }),
  );
}

/**
 * 打开一页并把测试环境铺好。
 * 返回 console error / pageerror / 本地 4xx 的收集数组（空 = 干净）。
 */
export async function openPage(page, path, opts = {}) {
  const errors = [];

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.startsWith(ORIGIN)) errors.push(`http ${r.status()} ${u}`);
  });

  await page.addInitScript((cfg) => { window.__MOCK_SHELL_CONFIG = cfg; }, MOCK_SHELL_CONFIG);
  await page.addInitScript(MOCK_SHELL);
  if (opts.auth !== false) {
    // 只种一次：登出后应用会清 token，后续导航不能再被测试塞回去
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem('app.session.seeded')) {
          localStorage.setItem('app.session', 'sess_test');
          localStorage.setItem('app.session.seeded', '1');
        }
      } catch (e) {}
    });
  }
  if (opts.theme) {
    await page.addInitScript((t) => { try { localStorage.setItem('app.theme', t); } catch (e) {} }, opts.theme);
  }

  if (opts.offline) {
    await page.route('**/api/app/v1/**', (route) => route.abort());
  } else {
    await mockCrm(page, opts.scenario || createScenario());
  }
  await useBrand(page, opts.brand || BRAND);

  await page.goto(path, { waitUntil: 'load' });
  return errors;
}
