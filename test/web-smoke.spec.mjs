import { test, expect } from '@playwright/test';
import { FAKE_SHELL, FROZEN_BANNED } from './fake-shell.mjs';

/**
 * web/ 的行为冒烟：用假壳驱动，验证 UI 是否按 `bridge@1` 契约工作。
 *
 * 覆盖：加载即问 state()、连接/断开的状态流转、5 个错误码的文案、
 *      三档视口不溢出、无 console error / pageerror。
 * 不覆盖：真隧道、真机 WebView 差异、托盘/窗口（那些属 T2 真机验收）。
 */

async function openApp(page, viewport) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  if (viewport) await page.setViewportSize(viewport);
  await page.addInitScript(FAKE_SHELL);
  await page.goto('/');
  return errors;
}

test('加载后调用 state()，初始状态为「已断开」', async ({ page }) => {
  const errors = await openApp(page);

  await expect(page.locator('#state')).toHaveText('已断开');
  const calls = await page.evaluate(() => window.__callsByMethod());
  expect(calls, '事件不会重放，加载必须问一次 state()').toContain('state');
  expect(calls, '必须订阅 state 事件').toContain('on');
  expect(errors).toEqual([]);
});

test('连接 → 已连接 → 断开：只经过 bridge 的 3 个方法', async ({ page }) => {
  const errors = await openApp(page);

  await page.locator('#pwr').click();
  await expect(page.locator('#state')).toHaveText('已连接');
  await expect(page.locator('#pwr')).toHaveText('断开');

  await page.locator('#pwr').click();
  await expect(page.locator('#state')).toHaveText('已断开');

  const calls = await page.evaluate(() => window.__callsByMethod());
  expect(calls.filter((c) => c === 'connect')).toHaveLength(1);
  expect(calls.filter((c) => c === 'disconnect')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('切节点后重新连接（连接中 → 已连接）', async ({ page }) => {
  const errors = await openApp(page);

  await page.locator('#pwr').click();
  await expect(page.locator('#state')).toHaveText('已连接');

  await page.locator('.srv[data-id="jp"]').click();
  await expect(page.locator('#state')).toHaveText('已连接');
  await expect(page.locator('#sub')).toContainText('日本 02');

  const calls = await page.evaluate(() => window.__callsByMethod());
  expect(calls.filter((c) => c === 'connect')).toHaveLength(2);
  expect(errors).toEqual([]);
});

const ERROR_CASES = [
  ['EXPIRED', '账号已过期'],
  ['FROZEN', '当前不可用'],
  ['DEVICE_LIMIT', '设备数已满'],
  ['NETWORK', '网络不可达'],
  ['INTERNAL', '连接失败'],
];

for (const [code, title] of ERROR_CASES) {
  test(`错误码 ${code} → 展示对应文案`, async ({ page }) => {
    const errors = await openApp(page);

    await page.evaluate(
      (c) => window.__setShell({ status: 'error', error: { code: c, message: '' } }),
      code,
    );

    const notice = page.locator('#notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(title);

    if (code === 'FROZEN') {
      expect(await notice.innerText(), 'FROZEN 必须中性文案').not.toMatch(FROZEN_BANNED);
    }
    expect(errors).toEqual([]);
  });
}

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 640 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`布局不横向溢出 + 截图 ${vp.name}`, async ({ page }, testInfo) => {
    const errors = await openApp(page, { width: vp.width, height: vp.height });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${vp.name} 出现横向滚动`).toBeLessThanOrEqual(1);

    await page.screenshot({ path: testInfo.outputPath(`${vp.name}-light.png`), fullPage: true });

    await page.locator('#themeBtn').click();
    await page.screenshot({ path: testInfo.outputPath(`${vp.name}-dark.png`), fullPage: true });

    expect(errors).toEqual([]);
  });
}
