(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = MOCK.S, D = MOCK.DATA;
  var status = 'disconnected';
  var tick = null;

  /* ── 顶部提示条：未订阅 / 过期 / 冻结 ─────────────────────── */
  function paintNotice() {
    var box = $('notice');
    if (!S.session) return;
    if (S.status === 'active' && !S.reason) { box.innerHTML = ''; return; }

    var kind = '', text = '', act = '';
    if (S.status === 'none') {
      text = '订阅后即可连接';
      act = '<a class="act" href="plans.html">选择套餐</a>';
    } else if (S.reason === 'EXPIRED') {
      kind = 'warn';
      text = S.reasonText + '（到期 ' + (S.expires || '') + '）';
      act = '<a class="act" href="plans.html">续费</a>';
    } else if (S.reason === 'FROZEN') {
      kind = 'bad';
      text = S.reasonText;
      var u = window.BRAND.links.support;
      act = u ? '<a class="act" href="' + u + '">客服</a>' : '';
    }
    box.innerHTML = '<div class="alert ' + kind + '"><span>' + text + '</span>' + act + '</div>';
  }

  /* ── 大圆钮 + 文案 ────────────────────────────────────────── */
  function paint() {
    var connected = status === 'connected';
    $('pwr').setAttribute('data-s', status);
    $('stats').hidden = !connected;

    // 计时只在已连接时出现，并且和"已连接"同一行；
    // 线路名不在这里重复（下面有线路卡片），"点击开始"这种废话也不写。
    $('time').hidden = !connected;

    if (status === 'connecting') {
      $('label').textContent = '连接中…';
      clearInterval(tick);
      tick = null;
    } else if (connected) {
      $('label').textContent = '已连接';
      startClock();
    } else {
      $('label').textContent = '未连接';
      clearInterval(tick);
      tick = null;
    }
    renderRecent();   // 锁定态跟着连接状态走
  }

  function startClock() {
    clearInterval(tick);
    var paintTime = function () {
      var s = Math.floor((Date.now() - (window.__since || Date.now())) / 1000);
      var hh = String(Math.floor(s / 3600)).padStart(2, '0');
      var mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      var ss = String(s % 60).padStart(2, '0');
      $('time').textContent = hh + ':' + mm + ':' + ss;
    };
    paintTime();
    tick = setInterval(paintTime, 1000);
  }

  function paintBytes(s) {
    var kb = function (n) {
      if (!n) return '0 KB';
      if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
      return Math.round(n / 1024) + ' KB';
    };
    $('down').textContent = kb(s.bytesIn);
    $('up').textContent = kb(s.bytesOut);
  }

  /* ── 交互 ─────────────────────────────────────────────────── */
  $('pwr').onclick = function () {
    if (S.locked) { location.href = 'plans.html'; return; }
    if (status === 'connected' || status === 'connecting') {
      // 不依赖 disconnect 的返回值：契约里 state() 才是真相
      window.bridge
        .disconnect()
        .then(function () { return window.bridge.state(); })
        .then(function (s) { status = s.status; paint(); });
      return;
    }
    window.bridge
      .connect({ serverName: MOCK.currentLine().label })
      .then(function (s) {
        status = s.status;
        window.__since = s.since;
        paint();
        paintBytes(s);
      })
      .catch(function () {
        status = 'disconnected';
        paint();
        $('notice').innerHTML =
          '<div class="alert bad"><span>连接失败，请稍后再试</span></div>';
      });
  };

  window.bridge.on('state', function (s) {
    status = s.status;
    if (s.since) window.__since = s.since;
    paint();
    paintBytes(s);
  });

  /* ── 最近使用（线路）─────────────────────────────────────────
     这里只做"切换"，不下钻 ⇒ 行尾不放 ›（› 的语义是打开新内容），
     当前那条打勾，其余靠"整行可点"本身表达可切换。
     已连接时切换要确认：换线路 = 断开 + 重连（bridge@1 没有原子"换线"），
     不能在用户只是"浏览一下"的时候把连接悄悄断掉。 */
  var CHECK = '<span class="chk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4 10-10"/></svg></span>';

  function renderRecent() {
    // 当前线路永远排第一：否则它不在"最近三条"里时，勾选标记看不见
    var cur = MOCK.currentLine();
    var rest = D.lines.filter(function (l) { return l.id !== cur.id; });
    $('recent').innerHTML = [cur].concat(rest)
      .slice(0, 3)
      .map(function (l) {
        var on = l.id === cur.id;
        return (
          '<button class="row" data-pick="' + l.id + '" role="radio" aria-checked="' + on + '">' +
          MOCK.lineIcon(l) +
          '<span class="grow">' + l.label + '</span>' +
          '<span class="val">' + MOCK.lineFactor(l) + '</span>' +
          (on ? CHECK : '') +
          '</button>'
        );
      })
      .join('');

    $('recent').querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        if (S.locked) { location.href = 'plans.html'; return; }
        var id = Number(b.getAttribute('data-pick'));
        if (id === MOCK.currentLine().id) return;
        if (status === 'connecting') return;      // 正在连：忽略点击
        if (status !== 'connected') {
          MOCK.setLine(id);
          paintLocation();
          renderRecent();
          return;
        }

        // 已连接：换线路 = 断开 + 重连，先确认再断
        var target = D.lines.filter(function (l) { return l.id === id; })[0];
        UI.confirm({
          title: '切换到 ' + target.label,
          message: '当前连接会断开。',
          ok: '切换',
        }).then(function (yes) {
          if (!yes) return;
          window.bridge.disconnect().then(function () {
            status = 'disconnected';
            MOCK.setLine(id);
            paintLocation();
            paint();
          });
        });
      };
    });
  }
  renderRecent();

  function paintLocation() {
    var line = MOCK.currentLine();
    $('curLine').innerHTML = MOCK.lineIcon(line) + '<span class="quick-name">' + line.label + '</span>';
  }

  paintNotice();
  paintLocation();
  paint();
  window.bridge.state().then(function (s) {
    status = s.status === 'error' ? 'disconnected' : s.status;
    if (s.since) window.__since = s.since;   // 刷新后计时从真实起点算，不要归零
    paint();
    paintBytes(s);                           // 刷新后也立刻显示真实流量，而不是 0 KB
  });
})();
