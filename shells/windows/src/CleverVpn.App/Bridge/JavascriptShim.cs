namespace CleverVpn.App.Bridge;

/// <summary>
/// 注进页面**之前**的 `window.bridge` shim（document-start）。
///
/// 它只做 transport：把 14 个方法翻成 `{id,method,args}` 交给 WebView2，
/// 把壳的 `{id,ok,result|error}` 翻回 Promise，把 `{event,payload}` 派发给 `on('state')`。
/// 方法名单必须与 `CleverVpn.Core.Bridge.BridgeDispatcher.Methods` 一致（测试会钉住）。
/// </summary>
public static class JavascriptShim
{
    public const string Source = """
        (function () {
          'use strict';
          if (window.bridge) return;

          var seq = 0;
          var pending = Object.create(null);
          var listeners = [];

          function send(method, args) {
            return new Promise(function (resolve, reject) {
              var id = String(++seq);
              pending[id] = { resolve: resolve, reject: reject };
              window.chrome.webview.postMessage({ id: id, method: method, args: args === undefined ? null : args });
            });
          }

          window.chrome.webview.addEventListener('message', function (event) {
            var msg = event.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.event) {
              if (msg.event === 'state') {
                listeners.slice().forEach(function (cb) {
                  try { cb(msg.payload); } catch (e) { /* 页面自己的错误不影响别的订阅者 */ }
                });
              }
              return;
            }
            var entry = pending[msg.id];
            if (!entry) return;
            delete pending[msg.id];
            if (msg.ok) entry.resolve(msg.result);
            else entry.reject({ code: (msg.error && msg.error.code) || 'INTERNAL', message: (msg.error && msg.error.message) || '' });
          });

          window.bridge = {
            capabilities: function () { return send('capabilities', null); },
            activate: function (key) { return send('activate', { key: key }); },
            deactivate: function () { return send('deactivate', null); },
            lines: function (opts) { return send('lines', opts && opts.refresh ? { refresh: true } : null); },
            setLine: function (id) { return send('setLine', { id: id }); },
            connect: function () { return send('connect', null); },
            disconnect: function () { return send('disconnect', null); },
            state: function () { return send('state', null); },
            settings: function () { return send('settings', null); },
            setProtocol: function (protocol) { return send('setProtocol', { protocol: protocol }); },
            setSplit: function (split) { return send('setSplit', { split: split }); },
            open: function (url) { return send('open', { url: url }); },
            crmRequest: function (req) { return send('crmRequest', req); },
            on: function (evt, cb) {
              if (evt === 'state' && typeof cb === 'function') listeners.push(cb);
            }
          };
        })();
        """;
}
