#!/usr/bin/env node
/**
 * 打印某个平台的 kit 版本（给壳的 ci 脚本 / 发布流程 / 本地用）。
 *
 *   node scripts/kit-version.mjs --platform android
 *   node scripts/kit-version.mjs --platform apple
 *   node scripts/kit-version.mjs --platform windows
 *
 * 退出码：0 = 打印成功；2 = 用法/配置错误（原因是可行动的）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_PLATFORMS, parseKitVersions } from './lib/kit-versions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--platform');
const platform = i >= 0 ? argv[i + 1] : '';

if (!KIT_PLATFORMS.includes(platform)) {
  console.error(`✗ --platform 必须是 ${KIT_PLATFORMS.join(' / ')}（收到 ${platform || '空'}）`);
  process.exit(2);
}

let text;
try {
  text = readFileSync(join(ROOT, 'shells', 'versions.json'), 'utf8');
} catch {
  console.error('✗ 找不到 shells/versions.json');
  process.exit(2);
}

const parsed = parseKitVersions(text);
if (!parsed.ok) {
  console.error(`✗ ${parsed.error}`);
  process.exit(2);
}

process.stdout.write(parsed.versions[platform] + '\n');
