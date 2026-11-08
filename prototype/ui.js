/* ==========================================================================
   系统级确认弹窗（iOS alert 样式）—— 纯 DOM，无依赖，file:// 可用
   --------------------------------------------------------------------------
   唯一用途：**需要用户明确同意才能继续的动作**。目前只有一处：
   已连接时更换线路（= 断开 + 重连，bridge@1 没有原子换线）。
   用法：
     UI.confirm({ title, message, ok, cancel }).then(function (yes) { ... })
   取消 / 点遮罩 / Esc 都 resolve(false)。
   ========================================================================== */
(function () {
  'use strict';

  var host = null;
  var settle = null;
  var lastFocus = null;

  function build() {
    host = document.createElement('div');
    host.className = 'sheet-host';
    host.hidden = true;
    host.innerHTML =
      '<div class="sheet-mask" data-mask></div>' +
      '<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheetTitle" aria-describedby="sheetMsg" tabindex="-1">' +
      '<div class="sheet-body">' +
      '<h2 id="sheetTitle"></h2>' +
      '<p id="sheetMsg"></p>' +
      '</div>' +
      '<div class="sheet-opts" hidden></div>' +
      '<div class="sheet-acts">' +
      '<button class="sheet-btn" type="button" data-act="cancel"></button>' +
      '<button class="sheet-btn ok" type="button" data-act="ok"></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(host);

    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b) {
        var act = b.getAttribute('data-act');
        close(act === 'ok' ? true : act === 'cancel' ? null : act);
        return;
      }
      if (e.target.hasAttribute('data-mask')) close(null);
    });
    document.addEventListener('keydown', function (e) {
      if (host.hidden) return;
      if (e.key === 'Escape') close(false);
    });
  }

  function close(value) {
    if (host.hidden) return;
    host.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    var fn = settle;
    settle = null;
    if (fn) fn(value);
  }

  function confirm(opts) {
    if (!host) build();
    var o = opts || {};
    lastFocus = document.activeElement;

    var okBtn = host.querySelector('.sheet [data-act="ok"]');
    var cancelBtn = host.querySelector('.sheet [data-act="cancel"]');
    host.querySelector('#sheetTitle').textContent = o.title || '';
    host.querySelector('#sheetMsg').textContent = o.message || '';
    okBtn.textContent = o.ok || '确定';
    cancelBtn.textContent = o.cancel || '取消';

    // options 模式：竖向列出可选项（如支付方式），点哪个 resolve 哪个 id
    var optsBox = host.querySelector('.sheet-opts');
    var acts = host.querySelector('.sheet-acts');
    if (o.options && o.options.length) {
      optsBox.innerHTML = o.options.map(function (op) {
        return '<button class="sheet-btn sheet-opt" data-act="' + op.id + '">' + op.label + '</button>';
      }).join('');
      optsBox.hidden = false;
      acts.hidden = true;
    } else {
      optsBox.innerHTML = '';
      optsBox.hidden = true;
      acts.hidden = false;
    }

    host.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    // 焦点进弹窗本身（不是按钮）：读屏会读出整段，键盘 Tab 再落到"取消"；
    // 不直接 focus 按钮是为了不给指针用户画一个假的"选中"高亮
    host.querySelector('.sheet').focus({ preventScroll: true });

    return new Promise(function (resolve) { settle = resolve; });
  }

  window.UI = { confirm: confirm };
})();
