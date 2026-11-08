/* ==========================================================================
   品牌垫片 —— 样板里**唯一**依赖 window.BRAND 的地方。
   --------------------------------------------------------------------------
   生产环境：`web/_brand.js` 由 scripts/build.mjs 从 app.json 生成（构建产物）。
   原型环境：没有构建步骤，所以下面 `FALLBACK` 给一份兜底值。

   移植时怎么用：
     · 想保留"改 app.json 就生效" → 原样搬走这个文件
     · 想完全自己控制品牌    → 删掉这个文件，把颜色写进 app.css 的变量区
   ========================================================================== */
(function () {
  // ↓↓↓ 移植到真实项目时删掉这段兜底（那时 _brand.js 一定存在）
  var FALLBACK = {
    name: '妙连VPN',
    short_name: '妙连',
    color: '',
    // 下面这些都是「值」：改 app.json 就生效，不用碰 HTML
    tagline: '门内安全，门外自由。',
    // 界面里的品牌标记。空 = 用内置的单色 SVG；
    // 生产里它是构建产物 URL（app.json 的 logo → web/_brand-logo.svg）
    logo: '',
    crm: { base: '', id: '' },
    // 演示地址；生产里为空的那一项整块不显示（不留死链）
    links: {
      terms: 'https://miaolianvpn.example.com/terms',
      privacy: 'https://miaolianvpn.example.com/privacy',
      support: 'https://miaolianvpn.example.com/help',
      website: 'https://miaolianvpn.example.com',
    },
  };

  var B = window.BRAND || FALLBACK;
  B.links = B.links || {};

  // 主色 → CSS 变量。这是"初级定制"的全部技术含量：一个值，全站生效
  if (B.color) document.documentElement.style.setProperty('--brand', B.color);

  window.BRAND = B;

  // 默认标记：内联 SVG（取自 cf-dashboard/public/img/brand/logo-small-red.svg，64×64 单色）
  // 单色 + fill=currentColor ⇒ 亮色跟随主色、暗色转白，同一份图形两套主题都正确
  var MARK =
    '<svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="M32 56C25.6348 56 19.5303 53.4714 15.0294 48.9706C10.5286 44.4697 8.00001 38.3652 8.00001 32C8.00001 25.6348 10.5286 19.5303 15.0294 15.0294C19.5303 10.5286 25.6348 8 32 8C38.3652 8 44.4697 10.5286 48.9706 15.0294C53.4714 19.5303 56 25.6348 56 32C56 38.3652 53.4714 44.4697 48.9706 48.9706C44.4697 53.4714 38.3652 56 32 56ZM32 5.33334C28.4981 5.33334 25.0305 6.02309 21.7951 7.36322C18.5598 8.70334 15.6201 10.6676 13.1438 13.1438C8.14286 18.1448 5.33334 24.9276 5.33334 32C5.33334 39.0724 8.14286 45.8552 13.1438 50.8562C15.6201 53.3324 18.5598 55.2967 21.7951 56.6368C25.0305 57.9769 28.4981 58.6667 32 58.6667C39.0725 58.6667 45.8552 55.8572 50.8562 50.8562C55.8572 45.8552 58.6667 39.0724 58.6667 32C58.6667 28.4981 57.9769 25.0305 56.6368 21.7951C55.2967 18.5598 53.3324 15.6201 50.8562 13.1438C48.38 10.6676 45.4403 8.70334 42.2049 7.36322C38.9696 6.02309 35.5019 5.33334 32 5.33334ZM27.8733 14V16.6227H19.5368V47.3195L27.8733 47.3264V49.9805L43.0947 47.2464L43.1104 16.7531L27.8733 14ZM30.3979 30.7859C30.9091 30.7859 31.3235 31.3251 31.3235 31.9901C31.3235 32.6555 30.9093 33.1947 30.3979 33.1947C29.8864 33.1947 29.4723 32.6555 29.4723 31.9901C29.4723 31.3251 29.8867 30.7859 30.3979 30.7859ZM22.012 44.8464V19.0979H27.8733V44.8509L22.012 44.8464Z"/></svg>';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-brand-name]').forEach(function (el) {
      el.textContent = B.name || '';
    });
    document.querySelectorAll('[data-brand-tagline]').forEach(function (el) {
      el.textContent = B.tagline || '';
    });
    document.querySelectorAll('[data-brand-short]').forEach(function (el) {
      // 只取首字：22px 的方块里放两个字就满了
      el.textContent = (B.short_name || B.name || 'A').slice(0, 1);
    });
    // 标记：app.json 配了 logo 就用那份文件，否则用样板自带的单色矢量标记
    document.querySelectorAll('[data-brand-logo]').forEach(function (el) {
      if (B.logo) {
        el.innerHTML = '<img src="' + B.logo + '" alt="' + (B.name || '') + '">';
        return;
      }
      el.innerHTML = MARK;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', B.name || '');
    });
    // 链接：没配就整块不显示（不留死链）
    document.querySelectorAll('[data-link]').forEach(function (el) {
      var url = B.links[el.getAttribute('data-link')];
      if (!url) { el.remove(); return; }
      el.href = url;
      // 页脚官网只写域名（把整条 https:// 摆出来像调试信息）
      if (el.hasAttribute('data-link-host')) {
        el.textContent = url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      }
      // 外链交给壳开：WebView 自己不许导航（BRIDGE.md §5）。
      // 壳没有 open 能力时保留 href + target，由壳的外链拦截接手。
      if (/^https:/i.test(url)) {
        el.addEventListener('click', function (ev) {
          if (window.bridge && typeof window.bridge.open === 'function') {
            ev.preventDefault();
            window.bridge.open(url);
          }
        });
      }
    });
  });
})();
