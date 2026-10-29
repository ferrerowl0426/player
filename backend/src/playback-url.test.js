import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  toPlaybackUrl,
  isCdnEnabled,
  isCdnAuthEnabled,
  getCdnAuthTtl,
  getTrustedCdnOrigins,
  validateCdnAuthConfiguration,
  DEFAULT_COS_ORIGIN,
  DEFAULT_CDN_ORIGIN
} from './playback-url.js';

const COS = DEFAULT_COS_ORIGIN;
const CDN = DEFAULT_CDN_ORIGIN;

test('转换默认 COS 源域名到 CDN，路径保持原样', () => {
  const input = `${COS}/videos/abc.mp4`;
  assert.equal(toPlaybackUrl(input), `${CDN}/videos/abc.mp4`);
});

test('保留路径中的查询与编码', () => {
  const input = `${COS}/videos/a%20b.mp4?foo=bar&baz=qux`;
  assert.equal(toPlaybackUrl(input), `${CDN}/videos/a%20b.mp4?foo=bar&baz=qux`);
});

test('其它域名不转换', () => {
  const input = 'https://other.example.com/videos/abc.mp4';
  assert.equal(toPlaybackUrl(input), input);
});

test('已是 CDN 域名的不再二次转换', () => {
  const input = `${CDN}/videos/abc.mp4`;
  assert.equal(toPlaybackUrl(input), input);
});

test('带 COS 签名参数的 URL 不转换', () => {
  const input = `${COS}/videos/abc.mp4?q-sign-algorithm=sha1&q-signature=xyz`;
  assert.equal(toPlaybackUrl(input), input);
});

test('空值 / 非字符串原样返回', () => {
  assert.equal(toPlaybackUrl(''), '');
  assert.equal(toPlaybackUrl(undefined), '');
  assert.equal(toPlaybackUrl(null), '');
});

test('子域名后缀伪装不转换', () => {
  const input = `${COS}.evil.com/videos/abc.mp4`;
  assert.equal(toPlaybackUrl(input), input);
});

test('MEDIA_CDN_ENABLED=false 时关闭转换', () => {
  const prev = process.env.MEDIA_CDN_ENABLED;
  process.env.MEDIA_CDN_ENABLED = 'false';
  try {
    assert.equal(isCdnEnabled(), false);
    assert.equal(toPlaybackUrl(`${COS}/videos/abc.mp4`), `${COS}/videos/abc.mp4`);
  } finally {
    if (prev === undefined) delete process.env.MEDIA_CDN_ENABLED;
    else process.env.MEDIA_CDN_ENABLED = prev;
  }
});

test('未设置环境变量时默认开启', () => {
  const prev = process.env.MEDIA_CDN_ENABLED;
  delete process.env.MEDIA_CDN_ENABLED;
  try {
    assert.equal(isCdnEnabled(), true);
    assert.equal(toPlaybackUrl(`${COS}/videos/abc.mp4`), `${CDN}/videos/abc.mp4`);
  } finally {
    if (prev !== undefined) process.env.MEDIA_CDN_ENABLED = prev;
  }
});

test('options.enabled 可强制覆盖开关', () => {
  assert.equal(toPlaybackUrl(`${COS}/videos/abc.mp4`, { enabled: false }), `${COS}/videos/abc.mp4`);
  assert.equal(toPlaybackUrl(`${COS}/videos/abc.mp4`, { enabled: true }), `${CDN}/videos/abc.mp4`);
});

test('options 可覆盖源/目标域名', () => {
  assert.equal(
    toPlaybackUrl('https://src.example.com/x/y', {
      cosOrigin: 'https://src.example.com',
      cdnOrigin: 'https://dst.example.com'
    }),
    'https://dst.example.com/x/y'
  );
});

// ---------- 腾讯云 CDN TypeA 签名（MEDIA_CDN_AUTH_*） ----------

test('isCdnAuthEnabled：默认关闭，仅显式 true/1/yes/on 开启', () => {
  assert.equal(isCdnAuthEnabled({}), false);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: '' }), false);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: 'true' }), true);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: '1' }), true);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: 'YES' }), true);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: 'on' }), true);
  assert.equal(isCdnAuthEnabled({ MEDIA_CDN_AUTH_ENABLED: 'false' }), false);
});

test('getCdnAuthTtl：默认 300，非法值回退 300', () => {
  assert.equal(getCdnAuthTtl({}), 300);
  assert.equal(getCdnAuthTtl({ MEDIA_CDN_AUTH_TTL_SECONDS: '' }), 300);
  assert.equal(getCdnAuthTtl({ MEDIA_CDN_AUTH_TTL_SECONDS: '600' }), 600);
  assert.equal(getCdnAuthTtl({ MEDIA_CDN_AUTH_TTL_SECONDS: '0' }), 300);
  assert.equal(getCdnAuthTtl({ MEDIA_CDN_AUTH_TTL_SECONDS: '-5' }), 300);
  assert.equal(getCdnAuthTtl({ MEDIA_CDN_AUTH_TTL_SECONDS: 'abc' }), 300);
});

test('getTrustedCdnOrigins：默认含默认 CDN，可追加', () => {
  const base = getTrustedCdnOrigins({});
  assert.ok(base.includes(DEFAULT_CDN_ORIGIN));
  const extended = getTrustedCdnOrigins({ MEDIA_CDN_TRUSTED_DOMAINS: 'https://a.example.com, https://b.example.com ' });
  assert.ok(extended.includes(DEFAULT_CDN_ORIGIN));
  assert.ok(extended.includes('https://a.example.com'));
  assert.ok(extended.includes('https://b.example.com'));
});

test('toPlaybackUrl：开启 CDN 鉴权时为可信 CDN 域名附加 TypeA 签名', () => {
  const input = `${CDN}/videos/a.mp4`;
  const result = toPlaybackUrl(input, { cdnAuthEnabled: true, cdnAuthKey: 'secretkey' });
  const parsed = new URL(result);
  assert.ok(parsed.searchParams.has('sign'), '应追加 sign 参数');
  const sign = parsed.searchParams.get('sign');
  const [timestamp, rand, uid, hash] = sign.split('-');
  assert.equal(uid, '0', 'uid 固定为 0');
  const expectedHash = crypto.createHash('md5')
    .update(`${parsed.pathname}-${timestamp}-${rand}-0-secretkey`)
    .digest('hex');
  assert.equal(hash, expectedHash, 'sign 后缀 md5 应与官方算法一致');
});

test('toPlaybackUrl：TypeA 签名结构与算法一致（TTL 不进入 sign，uid 固定 0）', () => {
  const input = `${CDN}/videos/a.mp4`;
  const result = toPlaybackUrl(input, { cdnAuthEnabled: true, cdnAuthKey: 'k', cdnAuthTtl: 600 });
  const sign = new URL(result).searchParams.get('sign');
  const parts = sign.split('-');
  assert.equal(parts.length, 4, 'sign 应为 timestamp-rand-0-hash，不含 TTL 字段');
  assert.equal(parts[2], '0', 'uid 固定为 0');
  const [timestamp, rand, , hash] = parts;
  const expectedHash = crypto.createHash('md5')
    .update(`${new URL(result).pathname}-${timestamp}-${rand}-0-k`)
    .digest('hex');
  assert.equal(hash, expectedHash, 'hash 应由 uri-timestamp-rand-0-key 计算，TTL 不在其中');
});

test('toPlaybackUrl：COS 签名 URL（q-sign）不被改写或签名；普通 COS 公开地址会先转 CDN 再签名', () => {
  // COS 私有读短签（q-sign-*）是另一条签名路径，不应被改写或附加 CDN sign。
  const cosSigned = `${COS}/videos/a.mp4?q-sign-algorithm=sha1&q-signature=xyz`;
  assert.equal(toPlaybackUrl(cosSigned, { cdnAuthEnabled: true, cdnAuthKey: 'k' }), cosSigned);
  // 普通 COS 公开地址：CDN 转换默认开启，会先转成可信 CDN 域名，再被 TypeA 签名（不再是 COS 原值）。
  const cosPublic = `${COS}/videos/a.mp4`;
  const r = toPlaybackUrl(cosPublic, { cdnAuthEnabled: true, cdnAuthKey: 'k' });
  assert.ok(r.startsWith(CDN), '普通 COS 公开地址应转成 CDN');
  assert.ok(new URL(r).searchParams.has('sign'), '转换后的 CDN 地址应被 TypeA 签名');
});

test('toPlaybackUrl：非可信域名即使开启鉴权也不签名', () => {
  const input = 'https://other.example.com/videos/a.mp4';
  assert.equal(toPlaybackUrl(input, { cdnAuthEnabled: true, cdnAuthKey: 'k' }), input);
});

test('toPlaybackUrl：已是 CDN 且带 sign 不再重复签名', () => {
  const input = `${CDN}/videos/a.mp4?sign=old-sign-value`;
  assert.equal(toPlaybackUrl(input, { cdnAuthEnabled: true, cdnAuthKey: 'k' }), input);
});

test('toPlaybackUrl：开启鉴权但缺 key 时 fail-fast 抛错', () => {
  assert.throws(
    () => toPlaybackUrl(`${CDN}/videos/a.mp4`, { cdnAuthEnabled: true, cdnAuthKey: '' }),
    /MEDIA_CDN_AUTH_KEY/
  );
});

test('validateCdnAuthConfiguration：默认关闭不抛错', () => {
  assert.deepEqual(validateCdnAuthConfiguration({}), { enabled: false, ttl: 300 });
});

test('validateCdnAuthConfiguration：开启且 key 合法返回 enabled', () => {
  const r = validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: 'abc123' });
  assert.equal(r.enabled, true);
  assert.equal(r.ttl, 300);
});

test('validateCdnAuthConfiguration：开启但 key 缺失/非法抛错', () => {
  assert.throws(
    () => validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: '' }),
    /MEDIA_CDN_AUTH_KEY/
  );
  assert.throws(
    () => validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: 'ab' }),
    /MEDIA_CDN_AUTH_KEY/
  );
  assert.throws(
    () => validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: 'a'.repeat(41) }),
    /MEDIA_CDN_AUTH_KEY/
  );
});

test('validateCdnAuthConfiguration：开启且 TTL 非法抛错', () => {
  assert.throws(
    () => validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: 'abc123', MEDIA_CDN_AUTH_TTL_SECONDS: '0' }),
    /MEDIA_CDN_AUTH_TTL_SECONDS/
  );
  assert.throws(
    () => validateCdnAuthConfiguration({ MEDIA_CDN_AUTH_ENABLED: 'true', MEDIA_CDN_AUTH_KEY: 'abc123', MEDIA_CDN_AUTH_TTL_SECONDS: '99999999' }),
    /MEDIA_CDN_AUTH_TTL_SECONDS/
  );
});
