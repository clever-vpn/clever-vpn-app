/**
 * kit 版本矩阵（`shells/versions.json`）的唯一解析与校验。
 *
 * 纯函数：CLI、测试、各壳的 ci 脚本都走这里，避免三处各写一套 JSON 解析。
 * 形状只有一个方向：**三个平台，各一个语义化版本**。
 */

export const KIT_PLATFORMS = ['android', 'apple', 'windows'];

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * @param {string} text `shells/versions.json` 的正文
 * @returns {{ok:true, versions:Record<string,string>} | {ok:false, error:string}}
 */
export function parseKitVersions(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `shells/versions.json 不是合法 JSON：${e.message}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'shells/versions.json 必须是对象' };
  }
  const keys = Object.keys(data).sort();
  const expected = [...KIT_PLATFORMS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return {
      ok: false,
      error: `shells/versions.json 只接受 ${expected.join(' / ')} 三个键（当前 ${keys.join(' / ') || '空'}）`,
    };
  }
  for (const platform of KIT_PLATFORMS) {
    const value = data[platform];
    if (typeof value !== 'string' || !SEMVER.test(value)) {
      return { ok: false, error: `shells/versions.json 的 ${platform} 必须是 x.y.z（当前 ${JSON.stringify(value)}）` };
    }
    if (value === '0.0.0') {
      return { ok: false, error: `shells/versions.json 的 ${platform} 还是占位值 0.0.0` };
    }
  }
  return { ok: true, versions: data };
}
