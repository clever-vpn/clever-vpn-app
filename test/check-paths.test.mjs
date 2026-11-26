import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

/**
 * path-whitelist 的三条正例 + 越界反例（验收 U1-a）。
 * 用真 git 仓库跑：规则是"分支前缀 ↔ 允许路径"，mock 掉 git 就等于没测。
 */

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts/check-paths.mjs');

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(dir, rel, text = 'x\n') {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'app-paths-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'ci@example.test']);
  git(dir, ['config', 'user.name', 'ci']);
  write(dir, 'app.json', JSON.stringify({ name: 'A', short_name: 'A', color: '#123456', crm: { base: 'https://a.example', id: '' } }, null, 2));
  write(dir, 'web/index.html', '<!doctype html><html lang="zh-CN"><head><meta name="viewport"></head><body></body></html>');
  write(dir, 'scripts/build.mjs', '// upstream\n');
  write(dir, 'template.json', '{}\n');
  write(dir, 'assets/icon.txt', 'x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function branch(dir, name, files) {
  git(dir, ['checkout', '-q', '-b', name, 'main']);
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', name]);
}

function run(dir, headBranch) {
  return spawnSync(process.execPath, [SCRIPT, '--base', 'main', '--head', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_HEAD_REF: headBranch },
  });
}

test('studio/design/*：改 web/ 通过', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/design/aaaa', { 'web/welcome.html': '<!doctype html><html lang="zh-CN"><head><meta name="viewport"></head></html>' });
    const r = run(dir, 'studio/design/aaaa');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /通过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('studio/design/*：改 crm.* 被拦下', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/design/bbbb', {
      'app.json': JSON.stringify({ name: 'A', short_name: 'A', color: '#123456', crm: { base: 'https://evil.example', id: '' } }, null, 2),
    });
    const r = run(dir, 'studio/design/bbbb');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /crm-locked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('studio/design/*：改 scripts/ 被拦下', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/design/cccc', { 'scripts/build.mjs': '// hijacked\n' });
    const r = run(dir, 'studio/design/cccc');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /forbidden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('studio/config/*：只改 app.json（可改 crm）通过', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/config/dddd', {
      'app.json': JSON.stringify({ name: 'A', short_name: 'A', color: '#123456', crm: { base: 'https://b.example', id: '' } }, null, 2),
    });
    const r = run(dir, 'studio/config/dddd');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('studio/config/*：改 web/ 被拦下', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/config/eeee', { 'web/index.html': '<!doctype html><html lang="zh-CN"><head><meta name="viewport"></head><p>x</p></html>' });
    const r = run(dir, 'studio/config/eeee');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /outside/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('studio/onboard/*：带 app.lock.json + web/ 通过', () => {
  const dir = repo();
  try {
    branch(dir, 'studio/onboard/ffff', {
      'app.lock.json': JSON.stringify({ lock_version: 1, bundle_id: { android: 'com.a.b', ios: 'com.a.b', macos: 'com.a.b', windows: 'com.a.b' } }, null, 2),
      'web/index.html': '<!doctype html><html lang="zh-CN"><head><meta name="viewport"></head><p>onboard</p></html>',
    });
    const r = run(dir, 'studio/onboard/ffff');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('非 studio 分支：只提示、不拦截（上游要能改 scripts/）', () => {
  const dir = repo();
  try {
    branch(dir, 'feat/upstream', { 'scripts/build.mjs': '// upstream change\n' });
    const r = run(dir, 'feat/upstream');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /仅提示/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('基线缺失：退出码 2（不是"通过"）', () => {
  const dir = repo();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--base', 'nope', '--head', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
