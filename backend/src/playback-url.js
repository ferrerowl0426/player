// 纯函数工具：把默认 COS 源域名的公开访问地址转换为 CDN 播放地址。
//
// 设计目标：
//   1) 兼容式新增播放字段——原 video_url / videoUrl 仍保留 COS 原值，
//      额外提供 play_url / playUrl 指向 CDN，前端可逐步切换、互不影响。
//   2) 只“精确”转换默认 COS 源域名，路径与查询原样保留（不重新编码）。
//   3) 其它域名、带 COS 签名参数的 URL 一律不转换，避免签名失效或误伤。
//   4) 通过独立环境变量 MEDIA_CDN_ENABLED 关闭；默认开启，不读 .env，
//      仅直接读取已存在的 process.env。
//
// 本模块无任何副作用：不连接数据库、不加载 .env、不修改任何全局状态，
// 便于单元测试与在各只读返回格式中独立调用。

export const DEFAULT_COS_ORIGIN = 'https://gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com';
export const DEFAULT_CDN_ORIGIN = 'https://media.nxhguitar.com';

// COS 签名 URL 常见的查询参数片段，命中即视为“签名 URL”而跳过转换。
const SIGNED_QUERY_MARKERS = ['q-sign-', 'x-cos-', 'signature=', 'sign='];

// 是否启用 CDN 播放地址转换。
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

// 判断源域名之后的部分是否像“签名 URL”（仅当包含常见 COS 签名查询参数时）。
function looksSigned(rest) {
  const queryIndex = rest.indexOf('?');
  if (queryIndex === -1) {
    return false;
  }
  const query = rest.slice(queryIndex + 1).toLowerCase();
  return SIGNED_QUERY_MARKERS.some((marker) => query.includes(marker));
}

/**
 * 把一个 URL 转换为 CDN 播放地址（仅当命中默认 COS 源域名且未关闭时）。
 *
 * @param {string} url 原始地址（通常为 normalizePublicUrl 之后的公开地址）
 * @param {object} [options]
 * @param {string} [options.cosOrigin] 覆盖默认 COS 源域名
 * @param {string} [options.cdnOrigin] 覆盖默认 CDN 域名
 * @param {boolean} [options.enabled] 覆盖环境变量开关（测试或强制时使用）
 * @returns {string} 转换后的地址；不满足转换条件时原样返回
 */
export function toPlaybackUrl(url, options = {}) {
  const cosOrigin = options.cosOrigin ?? DEFAULT_COS_ORIGIN;
  const cdnOrigin = options.cdnOrigin ?? DEFAULT_CDN_ORIGIN;
  const enabled = options.enabled ?? isCdnEnabled();

  const text = String(url ?? '').trim();
  if (!text || !enabled) {
    return text;
  }

  // 只转换以默认 COS 源域名开头的地址；其它域名（含已是 CDN 域名）原样返回。
  if (!text.startsWith(cosOrigin)) {
    return text;
  }

  const rest = text.slice(cosOrigin.length);
  // 防御子域名后缀伪装（如 example.cos...myqcloud.com.evil.com）。
  // 合法地址在源域名后必须是路径（以 / 开头）或整串就是源域名本身。
  if (rest !== '' && !rest.startsWith('/')) {
    return text;
  }

  // 签名 URL 不转换，避免改写 origin 后查询签名失效。
  if (looksSigned(rest)) {
    return text;
  }

  // 路径与查询保持原样，不重新编码。
  return `${cdnOrigin}${rest}`;
}
