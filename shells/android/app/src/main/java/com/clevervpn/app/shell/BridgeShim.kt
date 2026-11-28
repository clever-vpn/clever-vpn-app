package com.clevervpn.app.shell

/**
 * 注进页面的 `window.bridge` shim（document-start）。
 *
 * transport 走 WebMessageListener：`window.bridgeNative.postMessage(jsonString)`；
 * 壳的响应经 `window.bridgeNative.onmessage` → `__bridgeReceive` 回投。
 * 方法名单必须与 `BridgeDispatcher.METHODS` 一致。
 */
object BridgeShim {
    val SOURCE: String = """
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
              window.bridgeNative.postMessage(JSON.stringify({ id: id, method: method, args: args === undefined ? null : args }));
            });
          }

          window.__bridgeReceive = function (payload) {
            var msg = typeof payload === 'string' ? JSON.parse(payload) : payload;
            if (!msg || typeof msg !== 'object') return;
            if (msg.event) {
              if (msg.event === 'state') {
                listeners.slice().forEach(function (cb) {
                  try { cb(msg.payload); } catch (e) { /* 页面自己的错误 */ }
                });
              }
              return;
            }
            var entry = pending[msg.id];
            if (!entry) return;
            delete pending[msg.id];
            if (msg.ok) entry.resolve(msg.result);
            else entry.reject({ code: (msg.error && msg.error.code) || 'INTERNAL', message: (msg.error && msg.error.message) || '' });
          };

          if (window.bridgeNative) {
            window.bridgeNative.onmessage = function (event) {
              window.__bridgeReceive(event.data);
            };
          }

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
    """.trimIndent()
}
