import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseKitVersions } from '../scripts/lib/kit-versions.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const VALID = JSON.stringify({ android: '2.1.8', apple: '2.1.9', windows: '2.1.7' });

test('真实文件合法', () => {
  const text = readFileSync(`${REPO}/shells/versions.json`, 'utf8');
  const parsed = parseKitVersions(text);
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.versions, { android: '2.1.8', apple: '2.1.9', windows: '2.1.7' });
});

test('缺键 / 多键都拒绝', () => {
  assert.equal(parseKitVersions(JSON.stringify({ android: '1.0.0', apple: '1.0.0' })).ok, false);
  assert.equal(parseKitVersions(JSON.stringify({ android: '1.0.0', apple: '1.0.0', windows: '1.0.0', ios: '1.0.0' })).ok, false);
});

test('非语义化版本 / 占位值都拒绝', () => {
  assert.equal(parseKitVersions(JSON.stringify({ android: '2.1', apple: '1.0.0', windows: '1.0.0' })).ok, false);
  assert.equal(parseKitVersions(JSON.stringify({ android: '0.0.0', apple: '1.0.0', windows: '1.0.0' })).ok, false);
  assert.equal(parseKitVersions('{}').ok, false);
  assert.equal(parseKitVersions('not json').ok, false);
});

test('CLI 打印单个平台；未知平台退出 2', () => {
  const ok = spawnSync(process.execPath, ['scripts/kit-version.mjs', '--platform', 'apple'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), '2.1.9');

  const bad = spawnSync(process.execPath, ['scripts/kit-version.mjs', '--platform', 'ios'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--platform 必须是/);
});

test('版本矩阵只有这里一处（壳的 ci 从它读，不写死在项目文件里）', () => {
  const parsed = parseKitVersions(VALID);
  assert.equal(parsed.ok, true);
});
