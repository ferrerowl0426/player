import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPlaybackUrl,
  isCdnEnabled,
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
