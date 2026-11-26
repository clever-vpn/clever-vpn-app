import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * build.mjs 的坏配置 fixtures：
 * 验收要求「故意改错 icon / logo / color 各报一条」——这里把三处都做成可重复的断言。
 * 有真实目录 + 真跑子进程，因为构建门的价值就在"它真的会失败"。
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));

const COPY = [
  'app.json',
  'app.lock.json',
  'template.json',
  'kit/kit.version',
  'assets/icon.png',
  'assets/logo.svg',
  'web/index.html',
  'scripts/build.mjs',
  'scripts/lib/web-check.mjs',
];

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'app-build-'));
  for (const rel of COPY) {
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(REPO, rel), to);
  }
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
}

function editJson(dir, file, fn) {
  const p = join(dir, file);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  fn(data);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

test('基线配置：build --check 通过', () => {
  const dir = tempRepo();
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('color 写错：#rrggbb 之外的值被拦下', () => {
  const dir = tempRepo();
  try {
    editJson(dir, 'app.json', (a) => { a.color = 'blue'; });
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /color 必须是 #rrggbb/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('icon 写错：不是 1024×1024 被拦下', () => {
  const dir = tempRepo();
  try {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(512, 16);
    png.writeUInt32BE(512, 20);
    png[25] = 2;
    writeFileSync(join(dir, 'assets/icon.png'), png);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /必须是 1024×1024/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logo 写错：指向不存在的文件被拦下', () => {
  const dir = tempRepo();
  try {
    editJson(dir, 'app.json', (a) => { a.logo = 'assets/nope.svg'; });
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /logo 指向的文件不存在/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('template.json 版本不符：构建拒绝', () => {
  const dir = tempRepo();
  try {
    editJson(dir, 'template.json', (t) => { t.studio_contract = 3; });
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /studio_contract 必须是 4/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
