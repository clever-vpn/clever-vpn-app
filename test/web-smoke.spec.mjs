import { test, expect } from '@playwright/test';
import { FROZEN_BANNED } from './fake-shell.mjs';
import { openPage, createScenario, mockCrm, useBrand, BRAND, BRAND_ALT } from './harness.mjs';

/**
 * web/ 的行为门禁：假壳 + 假 CRM + 真 Chromium。
 *
 * 覆盖：10 页加载、登录 → 订阅 → 购买（stub 收银台）→ 兑换、连接四态、
 *      线路切换确认、设置/分流/地区、主题与三档视口截图、品牌替换、离线启动。
 * 不覆盖：真隧道、真机 WebView 差异（属于真机验收）。
 */

const PAGES = [
  { id: 'welcome', path: '/welcome.html', auth: false, scenario: { session: 'anon' }, ready: '.welcome-brand' },
  { id: 'login', path: '/login.html', auth: false, scenario: { session: 'anon' }, ready: '#step1' },
  { id: 'index', path: '/index.html', ready: '#recent .row' },
  { id: 'lines', path: '/lines.html', ready: '#list .row' },
  { id: 'plans', path: '/plans.html', ready: '[data-plan]' },
  { id: 'account', path: '/account.html', ready: '#email' },
  { id: 'settings', path: '/settings.html', ready: '#protocols [data-p]' },
  { id: 'split', path: '/split.html', ready: '#swIp' },
  { id: 'region', path: '/region.html', ready: '#list .row' },
  { id: 'redeem', path: '/redeem.html', ready: '#gifts' },
];

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '393x852', width: 393, height: 852, keyOnly: true },
];
const KEY_PAGES = new Set(['welcome', 'login', 'index', 'plans', 'settings', 'redeem']);

for (const p of PAGES) {
  test(`${p.id}：加载无 console error / 无横向溢出 / 有 studio 锚点`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const errors = await openPage(page, p.path, {
      auth: p.auth !== false,
      scenario: createScenario(p.scenario || {}),
    });
    await expect(page.locator(p.ready).first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${p.id} 出现横向滚动`).toBeLessThanOrEqual(1);
    expect(await page.locator('[data-studio-id]').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test(`${p.id}：三档视口 × 深浅主题截图`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const errors = await openPage(page, p.path, {
      auth: p.auth !== false,
      scenario: createScenario(p.scenario || {}),
    });
    await expect(page.locator(p.ready).first()).toBeVisible();

    for (const vp of VIEWPORTS) {
      if (vp.keyOnly && !KEY_PAGES.has(p.id)) continue;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${p.id} 在 ${vp.name} 出现横向滚动`).toBeLessThanOrEqual(1);
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(350);   // 等 0.25s 的颜色过渡走完，别把中间帧归档
        await page.screenshot({
          path: testInfo.outputPath(`${p.id}-${vp.name}-${scheme}.png`),
          fullPage: true,
        });
      }
    }
    expect(errors).toEqual([]);
  });
}

// ── 登录 → 订阅 ─────────────────────────────────────────────

test('登录：发码 → 验证码 → 主界面（会话落 localStorage）', async ({ page }) => {
  const errors = await openPage(page, '/login.html', { auth: false, scenario: createScenario({ session: 'none' }) });
  await expect(page.locator('#trialNote')).toHaveText('注册即送 7 天');

  await page.fill('#email', 'user@example.test');
  await page.click('#btnSend');
  await expect(page.locator('#step2')).toBeVisible();
  await expect(page.locator('#sentEmail')).toHaveText('user@example.test');

  await page.fill('#code', '123456');
  await page.click('#btnVerify');
  await page.waitForURL('**/index.html');
  expect(await page.evaluate(() => localStorage.getItem('app.session'))).toBe('sess_test');
  expect(errors).toEqual([]);
});

test('登录：错误码整句来自服务端信封', async ({ page }) => {
  await openPage(page, '/login.html', { auth: false, scenario: createScenario({ session: 'none' }) });
  await page.route('**/api/app/v1/auth/send-code', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'too_many_requests', message: '操作太频繁，请 1 分钟后再试' } }),
    }),
  );
  await page.fill('#email', 'user@example.test');
  await page.click('#btnSend');
  await expect(page.locator('#err')).toHaveText('操作太频繁，请 1 分钟后再试');
});

// ── 连接状态机 ──────────────────────────────────────────────

test('连接：激活 → 连接 → 已连接 → 断开；激活码不进 DOM', async ({ page }) => {
  const errors = await openPage(page, '/index.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#subbar')).toContainText('已订阅');
  await expect(page.locator('#pwr')).toHaveAttribute('data-s', 'disconnected');

  await page.click('#pwr');
  await expect(page.locator('#label')).toHaveText('已连接');
  await expect(page.locator('#time')).toBeVisible();
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#pwr')).toHaveAttribute('aria-pressed', 'true');

  const calls = await page.evaluate(() => window.__calls());
  expect(calls.map((c) => c.method)).toEqual(expect.arrayContaining(['activate', 'connect', 'on', 'state']));
  expect(calls.find((c) => c.method === 'activate').key).toBe('ACT-KEY-MUST-NOT-RENDER');
  expect(await page.content()).not.toContain('ACT-KEY-MUST-NOT-RENDER');

  await page.click('#pwr');
  await expect(page.locator('#label')).toHaveText('未连接');
  expect(await page.evaluate(() => window.__callsByMethod())).toContain('disconnect');
  expect(errors).toEqual([]);
});

for (const [code, title] of [
  ['EXPIRED', '订阅已到期'],
  ['FROZEN', '账号暂时不可用'],
  ['DEVICE_LIMIT', '设备数已达上限'],
  ['NETWORK', '网络不可达'],
  ['INTERNAL', '连接失败'],
]) {
  test(`错误码 ${code}：有文案与出口`, async ({ page }) => {
    await openPage(page, '/index.html', { scenario: createScenario({ session: 'active' }) });
    await expect(page.locator('#subbar')).toContainText('已订阅');
    await page.evaluate((c) => window.__setShell({ status: 'error', error: { code: c, message: 'x' } }), code);
    const notice = page.locator('#notice');
    await expect(notice).toContainText(title);
    await expect(notice.locator('.act')).toBeVisible();
    if (code === 'FROZEN') expect(await notice.innerText()).not.toMatch(FROZEN_BANNED);
    if (code === 'EXPIRED') await expect(notice.locator('a.act')).toHaveAttribute('href', 'plans.html');
  });
}

test('离线启动：CRM 不可达时页面照常开，已激活的隧道能连上', async ({ page }) => {
  const errors = await openPage(page, '/index.html', { scenario: createScenario({ session: 'active' }), offline: true });
  await expect(page.locator('#notice')).toContainText('暂时无法加载订阅信息');
  await page.evaluate(() => window.__activate());
  await page.click('#pwr');
  await expect(page.locator('#label')).toHaveText('已连接');
  expect(errors.filter((e) => !e.includes('net::ERR_FAILED'))).toEqual([]);
});

test('无壳时 bridge.js 的 mock 与真壳同形（本地开发/Studio 预览）', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('app.session', 'sess_mock');
      localStorage.setItem('app.session.seeded', '1');
      localStorage.setItem('app.activated', 'true');
    } catch (e) {}
  });
  await mockCrm(page, createScenario({ session: 'active' }));
  await useBrand(page, BRAND);
  await page.goto('/index.html');
  expect(await page.evaluate(() => typeof window.bridge.crmRequest)).toBe('undefined');
  await expect(page.locator('#subbar')).toContainText('已订阅');
  await expect(page.locator('#recent .row').first()).toBeVisible();
  await page.click('#pwr');
  await expect(page.locator('#label')).toHaveText('已连接', { timeout: 5000 });
  await page.click('#pwr');
  await expect(page.locator('#label')).toHaveText('未连接');
});

test('CRM 传输：有壳时走 bridge.crmRequest', async ({ page }) => {
  await openPage(page, '/index.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#subbar')).toContainText('已订阅');
  const methods = await page.evaluate(() => window.__callsByMethod());
  expect(methods).toContain('crmRequest');
});

// ── 线路 ────────────────────────────────────────────────────

test('线路：搜索 + 未连接随手切 + 已连接要确认', async ({ page }) => {
  await openPage(page, '/lines.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#list .row')).toHaveCount(6);

  await page.fill('#q', '日本');
  await expect(page.locator('#list .row')).toHaveCount(1);
  await page.fill('#q', '');

  await page.click('#list [data-pick="2"]');
  await expect(page.locator('#list [data-pick="2"]')).toHaveAttribute('aria-checked', 'true');

  await page.evaluate(() => window.__setShell({ status: 'connected', since: Date.now(), line: { id: 2, label: '日本 01' } }));
  await expect(page.locator('#dc')).toBeVisible();
  await page.click('#list [data-pick="3"]');
  await expect(page.locator('.sheet')).toBeVisible();
  await page.click('.sheet [data-act="ok"]');
  await expect(page.locator('#list [data-pick="3"]')).toHaveAttribute('aria-checked', 'true');
  const calls = await page.evaluate(() => window.__callsByMethod());
  expect(calls).toContain('disconnect');
  expect(calls).toContain('setLine');
});

// ── 套餐与购买 ──────────────────────────────────────────────

test('套餐：只渲染服务端字段，不可买的有整句原因', async ({ page }) => {
  await openPage(page, '/plans.html', { scenario: createScenario({ session: 'active' }) });
  const month = page.locator('[data-studio-id="plans.card.p_month"]');
  await expect(month).toContainText('¥12.00');
  await expect(month).toContainText('首单 8 折');
  await expect(month).toContainText('每月 100 GB · 1 台设备');
  await expect(month.locator('s')).toContainText('¥15.00');
  await expect(month.locator('button')).toHaveText('立即购买');

  const blocked = page.locator('[data-studio-id="plans.card.p_blocked"]');
  await expect(blocked.locator('button')).toBeDisabled();
  await expect(blocked).toContainText('不支持从当前套餐降档');
});

test('购买：选择支付方式 → 下单 → 打开收银台 → 轮询到已支付', async ({ page }) => {
  const sc = createScenario({ session: 'active', payPending: true });
  await openPage(page, '/plans.html', { scenario: sc });
  await page.click('[data-studio-id="plans.card.p_month"] button');

  await expect(page.locator('.sheet')).toBeVisible();
  await page.click('.sheet [data-act="alipay"]');
  await expect(page.locator('.sheet')).toContainText('应付 ¥12.00');
  await page.click('.sheet [data-act="ok"]');

  await expect(page.locator('#paybox')).toContainText('等待支付');
  const opened = await page.evaluate(() => window.__calls().filter((c) => c.method === 'open').pop());
  expect(opened.url).toBe('https://pay.acme.example/o/ord_new');
  expect(sc.lastOrder).toEqual({ order_code: 'ord_new', plan_id: 'p_month', method: 'alipay' });

  sc.paid = true;   // 用户在系统浏览器里付完款
  await expect(page.locator('#paybox')).toContainText('支付成功');
});

test('购买：匿名时按钮指向登录，不放行下单', async ({ page }) => {
  await openPage(page, '/plans.html', { auth: false, scenario: createScenario({ session: 'anon' }) });
  await expect(page.locator('[data-studio-id="plans.card.p_month"] button')).toHaveText('登录后订阅');
  await page.click('[data-studio-id="plans.card.p_month"] button');
  await page.waitForURL('**/login.html?next=plans.html');
});

// ── 账户 / 设置 / 分流 / 地区 / 兑换 ─────────────────────────

test('账户：邮箱 / 订阅 / 订单；退出登录清凭据并回欢迎页', async ({ page }) => {
  await openPage(page, '/account.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#email')).toHaveText('user@example.test');
  await expect(page.locator('#sub')).toContainText('已订阅');
  await expect(page.locator('#orders')).toContainText('月付');
  await expect(page.locator('#orders')).toContainText('¥12.00');

  await page.locator('#logout').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.click('#logout');
  await page.click('.sheet [data-act="ok"]');
  await expect(page).toHaveURL(/welcome\.html$/);
  expect(await page.evaluate(() => localStorage.getItem('app.session'))).toBeNull();
});

test('设置：协议就地生效；主题三态落盘；连接信息不编造地址', async ({ page }) => {
  await openPage(page, '/settings.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#protocols .opt')).toHaveCount(6);
  await page.click('#protocols [data-p="tcpStable"]');
  const proto = await page.evaluate(() => window.__calls().filter((c) => c.method === 'setProtocol').pop());
  expect(proto.protocol).toBe('tcpStable');

  await page.click('#themes [data-t="dark"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('app.theme'))).toBe('dark');

  await expect(page.locator('#vRelay')).toHaveText('有');
  await expect(page.locator('#vUpstream')).toHaveText('无');
});

test('分流：开关 + IP/域名落盘；带 . 的写成后缀', async ({ page }) => {
  await openPage(page, '/split.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#ipText')).toBeDisabled();
  await page.click('#swIp');
  await expect(page.locator('#ipText')).toBeEnabled();
  await page.fill('#ipText', '10.0.0.0/8\n192.168.0.0/16');
  await page.click('#swDomain');
  await page.fill('#domainText', 'example.com\n.cdn.example.com');
  await page.waitForTimeout(700);

  const call = await page.evaluate(() => window.__calls().filter((c) => c.method === 'setSplit').pop());
  expect(call.split.ip.enable).toBe(true);
  expect(call.split.ip.ip_cidr).toEqual(['10.0.0.0/8', '192.168.0.0/16']);
  expect(call.split.domain.domain).toEqual(['example.com']);
  expect(call.split.domain.domain_suffix).toEqual(['cdn.example.com']);
});

test('地区：搜索 → 选中即生效（并打开按地区分流）', async ({ page }) => {
  await openPage(page, '/region.html', { scenario: createScenario({ session: 'active' }) });
  await page.fill('#q', '日本');
  await expect(page.locator('#list .row')).toHaveCount(1);
  await page.click('#list [data-r="JP"]');
  await expect(page.locator('#list [data-r="JP"]')).toHaveAttribute('aria-checked', 'true');
  const call = await page.evaluate(() => window.__calls().filter((c) => c.method === 'setSplit').pop());
  expect(call.split.region).toEqual({ enable: true, code: 'JP' });
});

test('兑换：礼包领取 + 兑换码成功/失败都显示服务端整句', async ({ page }) => {
  await openPage(page, '/redeem.html', { scenario: createScenario({ session: 'active' }) });
  await expect(page.locator('#gifts')).toContainText('国庆福利');
  await page.click('#gifts [data-claim="0"]');
  await expect(page.locator('#result')).toContainText('已领取 7 天会员');

  await page.fill('#code', 'NOPE');
  await page.click('#btnRedeem');
  await expect(page.locator('#result')).toContainText('这个兑换码不存在，检查一下再试');

  await page.fill('#code', 'WELCOME7');
  await page.click('#btnRedeem');
  await expect(page.locator('#result')).toContainText('已兑换 国庆福利');
});

// ── 交互规格（产品级清单的机器可判项）────────────────────────

test('点按热区 ≥44×44', async ({ page }) => {
  const paths = ['/login.html', '/index.html', '/lines.html', '/plans.html', '/settings.html', '/split.html', '/region.html'];
  for (const path of paths) {
    const pg = await page.context().newPage();
    await pg.setViewportSize({ width: 393, height: 852 });
    await openPage(pg, path, { auth: path !== '/login.html', scenario: createScenario({}) });
    await pg.waitForTimeout(150);
    const small = await pg.evaluate(() => {
      const sel = '.btn, .row, .nav-btn, .tab, .link-btn, .opt, .pwr, .quick, .help';
      return [...document.querySelectorAll(sel)]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5);
        })
        .map((el) => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    });
    expect(small, `${path} 有小于 44×44 的热区`).toEqual([]);
    await pg.close();
  }
});

test('根页面没有返回，推入页有返回', async ({ page }) => {
  for (const path of ['/index.html', '/lines.html', '/plans.html', '/account.html']) {
    await openPage(page, path, { scenario: createScenario({}) });
    await expect(page.locator('.topbar a[aria-label="返回"]')).toBeHidden();
  }
  for (const path of ['/settings.html', '/split.html', '/region.html', '/redeem.html']) {
    await openPage(page, path, { scenario: createScenario({}) });
    await expect(page.locator('.topbar a[aria-label="返回"]')).toBeVisible();
  }
});

test('切换类控件有 role=radio + aria-checked', async ({ page }) => {
  for (const path of ['/lines.html', '/settings.html', '/region.html']) {
    await openPage(page, path, { scenario: createScenario({}) });
    const radios = page.locator('[role="radio"]');
    const n = await radios.count();
    expect(n, `${path} 没有单选控件`).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      await expect(radios.nth(i)).toHaveAttribute('aria-checked', /true|false/);
    }
  }
});

// ── 品牌替换 ────────────────────────────────────────────────

test('品牌替换：换一套 app.json 值，所有页面无旧串、颜色生效', async ({ page }) => {
  const old = [BRAND.name, BRAND.short_name, BRAND.tagline];
  const errors = await openPage(page, '/welcome.html', {
    auth: false,
    scenario: createScenario({ session: 'anon' }),
    brand: BRAND_ALT,
  });
  await expect(page.locator('[data-brand-name]')).toHaveText(BRAND_ALT.name);
  await expect(page.locator('[data-brand-tagline]')).toHaveText(BRAND_ALT.tagline);
  await expect(page.locator('[data-legal]')).toHaveCount(0); // terms/privacy 空 ⇒ 整块不出现
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()))
    .toBe(BRAND_ALT.color);

  for (const p of PAGES) {
    const pg = await page.context().newPage();
    const pageErrors = await openPage(pg, p.path, {
      auth: p.auth !== false,
      scenario: createScenario(p.scenario || {}),
      brand: BRAND_ALT,
    });
    await expect(pg.locator(p.ready).first()).toBeVisible();
    const text = await pg.locator('body').innerText();
    for (const s of old) expect(text, `${p.id} 残留旧品牌「${s}」`).not.toContain(s);
    expect(pageErrors, `${p.id} console error`).toEqual([]);
    await pg.close();
  }
  expect(errors).toEqual([]);
});
