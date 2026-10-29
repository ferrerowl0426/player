// 纯函数工具：把默认 COS 源域名的公开访问地址转换为 CDN 播放地址。
//
// 设计目标：
//   1) 兼容式新增播放字段——原 video_url / videoUrl 仍保留 COS 原值，
//      额外提供 play_url / playUrl 指向 CDN，前端可逐步切换、互不影响。
//   2) 只“精确”转换默认 COS 源域名，路径与查询原样保留（不重新编码）。
//   3) 其它域名、带 COS 签名参数的 URL 一律不转换，避免签名失效或误伤。
//   4) 可选腾讯云 CDN TypeA 签名（MEDIA_CDN_AUTH_ENABLED 开启时）：仅对“可信 CDN 域名”
//      签名，覆盖已是 CDN 的输入；不改写 COS 签名 URL（COS 短签走 /playback 端点）。
//   5) 通过独立环境变量读取，默认关闭 CDN 签名；本模块无任何副作用：不连接数据库、
//      不加载 .env、不修改任何全局状态，便于单元测试与在各只读返回格式中独立调用。
//
// 重要（云端鉴权未完成）：MEDIA_CDN_AUTH_ENABLED 仅生成“应用侧”的 TypeA 签名参数，
// 仍需在腾讯云 CDN 控制台为对应域名开启 TypeA 鉴权并配置“相同 key 与有效期”才会真正生效。
// 没有在控制台开启前，开启本开关会导致所有播放地址 403。详见 README。

import crypto from 'node:crypto';

export const DEFAULT_COS_ORIGIN = 'https://gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com';
export const DEFAULT_CDN_ORIGIN = 'https://media.nxhguitar.com';

// COS 签名 URL 常见的查询参数片段，命中即视为“签名 URL”而跳过转换。
// 注意：sign= 也在其中——既是腾讯云 TypeA 签名的参数名，也是判断“已签过”的依据，避免重复签名。
const SIGNED_QUERY_MARKERS = ['q-sign-', 'x-cos-', 'signature=', 'sign='];

// 是否启用 CDN 播放地址转换（把 COS 源转成 CDN 域名）。
// 默认开启；仅当 MEDIA_CDN_ENABLED 显式为 false / 0 / no / off（大小写不敏感）时关闭。
// 注意：这里直接读 process.env，不主动加载 .env，避免引入 dotenv 副作用。
export function isCdnEnabled() {
  const value = process.env.MEDIA_CDN_ENABLED;
  if (value === undefined || value === null) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') {
    return true;
  }
  return !['false', '0', 'no', 'off'].includes(normalized);
}

// 是否开启 CDN TypeA 签名。
// 默认【关闭】——绝不默认启用（COS 短签仍是默认播放路径），也绝不在此处生成或写入真实密钥。
export function isCdnAuthEnabled(env = process.env) {
  const value = env.MEDIA_CDN_AUTH_ENABLED;
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

// CDN TypeA 签名有效期（秒）。默认 300。
// 必须与腾讯云 CDN 控制台“鉴权有效期”配置一致，否则签名未到客户端就已过期或长期有效。
export function getCdnAuthTtl(env = process.env) {
  const raw = env.MEDIA_CDN_AUTH_TTL_SECONDS;
  if (raw === undefined || raw === '') {
    return 300;
  }
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    return 300;
  }
  return Math.floor(number);
}

// 可信 CDN 域名白名单（origin 形式，含协议）。仅这些域名会被 TypeA 签名覆盖。
// 默认包含 DEFAULT_CDN_ORIGIN；可用 MEDIA_CDN_TRUSTED_DOMAINS 追加（逗号分隔）。
export function getTrustedCdnOrigins(env = process.env) {
  const origins = [DEFAULT_CDN_ORIGIN];
  const configured = env.MEDIA_CDN_TRUSTED_DOMAINS;
  if (configured) {
    for (const entry of configured.split(',')) {
      const trimmed = entry.trim();
      if (trimmed && !origins.includes(trimmed)) {
        origins.push(trimmed);
      }
    }
  }
  return origins;
}

function isTrustedCdnUrl(url, env = process.env) {
  try {
    const parsed = new URL(url);
    return getTrustedCdnOrigins(env).includes(parsed.origin);
  } catch {
    return false;
  }
}

function hasCdnSignParam(url) {
  try {
    return new URL(url).searchParams.has('sign');
  } catch {
    return false;
  }
}

// 判断源域名之后的部分是否像“签名 URL”（仅当包含常见 COS 签名查询参数时）。
function looksSigned(rest) {
  const queryIndex = rest.indexOf('?');
  if (queryIndex === -1) {
    return false;
  }
  const query = rest.slice(queryIndex + 1).toLowerCase();
  return SIGNED_QUERY_MARKERS.some((marker) => query.includes(marker));
}

// 腾讯云 CDN TypeA 鉴权：sign = md5(uri-timestamp-rand-0-key)。
//   uri      : 请求路径（含前导 /，不含查询串）
//   timestamp: 当前 Unix 秒级时间戳（运行时 Date.now()，不硬编码）
//   rand     : 随机非负整数（crypto 生成，不硬编码）
//   uid      : 固定 0
//   key      : MEDIA_CDN_AUTH_KEY
// 最终请求地址追加 ?sign=timestamp-rand-0-md5hash。有效期由 CDN 控制台配置决定。
function signCdnUrl(url, key) {
  const parsed = new URL(url);
  const timestamp = Math.floor(Date.now() / 1000);
  const rand = crypto.randomInt(0, 100);
  const input = `${parsed.pathname}-${timestamp}-${rand}-0-${key}`;
  const md5hash = crypto.createHash('md5').update(input).digest('hex');
  const sign = `${timestamp}-${rand}-0-${md5hash}`;
  parsed.searchParams.set('sign', sign);
  return parsed.toString();
}

/**
 * 把一个 URL 转换为 CDN 播放地址，并按需在可信 CDN 域名上附加 TypeA 签名。
 *
 * 转换规则（仅当命中默认 COS 源域名且未关闭时）：
 *   - COS 源 -> CDN 域名（路径/查询原样保留）。
 *   - 已是可信 CDN 域名：保持原样（覆盖“已是 CDN”的输入）。
 *   - 其它域名 / 带 COS 签名参数 / 已带 sign：原样返回，不转换、不重复签名。
 *
 * TypeA 签名（仅当 isCdnAuthEnabled 为真时）：
 *   - 仅对“可信 CDN 域名”的 URL 签名（不含 sign 参数时）。
 *   - 不触碰任何 COS 签名 URL（COS 短签由 /playback 端点签发）。
 *
 * @param {string} url 原始地址（通常为 normalizePublicUrl 之后的公开地址）
 * @param {object} [options]
 * @param {string} [options.cosOrigin] 覆盖默认 COS 源域名
 * @param {string} [options.cdnOrigin] 覆盖默认 CDN 域名
 * @param {boolean} [options.enabled] 覆盖 CDN 转换开关（测试或强制时使用）
 * @param {boolean} [options.cdnAuthEnabled] 覆盖 CDN 签名开关
 * @param {string} [options.cdnAuthKey] 覆盖 CDN 签名 key
 * @param {number} [options.cdnAuthTtl] 覆盖 CDN 签名有效期（秒）
 * @param {object} [options.env] 覆盖环境变量来源（用于测试）
 * @returns {string} 转换/签名后的地址；不满足转换条件时原样返回
 */
export function toPlaybackUrl(url, options = {}) {
  const cosOrigin = options.cosOrigin ?? DEFAULT_COS_ORIGIN;
  const cdnOrigin = options.cdnOrigin ?? DEFAULT_CDN_ORIGIN;
  const enabled = options.enabled ?? isCdnEnabled();
  const env = options.env ?? process.env;
  const cdnAuthEnabled = options.cdnAuthEnabled ?? isCdnAuthEnabled(env);
  const cdnAuthKey = options.cdnAuthKey ?? env.MEDIA_CDN_AUTH_KEY;
  const cdnAuthTtl = options.cdnAuthTtl ?? getCdnAuthTtl(env);

  const text = String(url ?? '').trim();
  if (!text) {
    return text;
  }

  // 1) 决定候选 URL：COS 源转换、或已是可信 CDN、或其它原样返回。
  let candidate = text;
  if (enabled && text.startsWith(cosOrigin)) {
    const rest = text.slice(cosOrigin.length);
    // 防御子域名后缀伪装（如 example.cos...myqcloud.com.evil.com）。
    // 合法地址在源域名后必须是路径（以 / 开头）或整串就是源域名本身。
    if (rest !== '' && !rest.startsWith('/')) {
      return text;
    }
    // 签名 URL 不转换，避免改写 origin 后查询签名失效。
    if (!looksSigned(rest)) {
      candidate = `${cdnOrigin}${rest}`;
    }
  }

  // 2) 仅对可信 CDN 域名做 TypeA 签名；已签过（含 sign）则跳过，避免重复签名。
  if (cdnAuthEnabled && isTrustedCdnUrl(candidate, env) && !hasCdnSignParam(candidate)) {
    if (!cdnAuthKey) {
      throw new Error('MEDIA_CDN_AUTH_ENABLED 已开启，但 MEDIA_CDN_AUTH_KEY 缺失，无法签发 CDN 地址');
    }
    candidate = signCdnUrl(candidate, cdnAuthKey);
  }

  return candidate;
}

/**
 * 启动期 fail-fast 校验：MEDIA_CDN_AUTH_ENABLED 开启时必须提供合法 key 与有效期。
 * 默认关闭，不抛错。返回 { enabled, ttl } 供调用方参考。
 * 注意：仅校验“应用侧”配置；CDN 控制台是否开启 TypeA 及 key/有效期是否一致，需人工确认。
 *
 * @param {object} [env=process.env]
 */
export function validateCdnAuthConfiguration(env = process.env) {
  const enabled = isCdnAuthEnabled(env);
  if (!enabled) {
    return { enabled: false, ttl: getCdnAuthTtl(env) };
  }
  const key = env.MEDIA_CDN_AUTH_KEY || '';
  if (!/^[a-zA-Z0-9]{6,40}$/.test(key)) {
    throw new Error('MEDIA_CDN_AUTH_ENABLED 已开启，但 MEDIA_CDN_AUTH_KEY 缺失或不符合 6-40 位字母数字要求');
  }
  const ttlRaw = env.MEDIA_CDN_AUTH_TTL_SECONDS;
  if (ttlRaw !== undefined && ttlRaw !== '') {
    const number = Number(ttlRaw);
    if (!Number.isInteger(number) || number <= 0 || number > 31536000) {
      throw new Error('MEDIA_CDN_AUTH_TTL_SECONDS 必须是 1-31536000 之间的正整数');
    }
  }
  return { enabled: true, ttl: getCdnAuthTtl(env) };
}
