#!/usr/bin/env node
/**
 * 仅供端到端冒烟使用：把 web/ 当静态目录伺服。
 *
 * 为什么不用现成静态服务器：不想为了一个测试给租户再装一个依赖。
 * 与真实壳的唯一差别：真壳读内置资源目录，这里走 HTTP。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web', import.meta.url));
const PORT = Number(process.env.PORT || 8123);
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';

    const abs = join(WEB, path);
    // 目录穿越防线：解析后必须仍在 web/ 之内
    if (abs !== WEB && !abs.startsWith(WEB + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
      return;
    }

    const body = await readFile(abs);
    res.writeHead(200, {
      'content-type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`[serve] ${WEB} → http://${HOST}:${PORT}/`);
});
