// play-url 端点在 MEDIA_CDN_AUTH_ENABLED 开启时优先返回可信 CDN TypeA 短签的测试。
// mock db / auth / storage / playback-access / playback-url（仅覆盖签名相关纯函数）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./auth.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;
const SRC_PLAYBACK_ACCESS = new URL('./playback-access.js', import.meta.url).href;
const SRC_PLAYBACK_URL = new URL('./playback-url.js', import.meta.url).href;

const state = {
  publiclyReadable: true,
  cdnSigned: true,
  videoUrl: 'http://public.example/videos/tracks/1/a.mp4',
  renditionUrl: 'http://public.example/videos/tracks/1/a-720p.mp4'
};

function makeFakePool() {
  const client = {
    async query(sql) {
      if (/SELECT video_url FROM videos WHERE id\s*=\s*\$1/.test(sql)) {
        return { rows: [{ video_url: state.videoUrl }], rowCount: 1 };
      }
      if (/SELECT video_url FROM video_renditions WHERE video_id\s*=\s*\$1/.test(sql)) {
        return { rows: [{ video_url: state.renditionUrl }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return { query: client.query, connect: async () => client };
}

mock.module(SRC_DB, { namedExports: { pool: makeFakePool() } });
mock.module(SRC_AUTH, {
  namedExports: {
    optionalContentViewer(req, res, next) {
      const role = req.headers['x-test-role'];
      req.contentViewer = role ? { role, status: 'active' } : undefined;
      next();
    }
  }
});
mock.module(SRC_STORAGE, {
  namedExports: {
    createDownloadUrl: async () => 'https://signed.example/videos/tracks/1/a.mp4?sig=abc',
    getPublicUrl: (key) => `https://cos.example/${key}`,
    getKeyFromPublicUrl: (url) => String(url || '').split('public.example/')[1] || ''
  }
});
mock.module(SRC_PLAYBACK_ACCESS, {
  namedExports: { isVideoPubliclyReadable: async () => state.publiclyReadable }
});
// 覆盖签名相关纯函数：开启 CDN 鉴权，TTL 取 600，返回可控签名地址。
mock.module(SRC_PLAYBACK_URL, {
  namedExports: {
    isCdnAuthEnabled: () => true,
    getCdnAuthTtl: () => 600,
    toPlaybackUrl: (url) => state.cdnSigned ? `${url}?sign=cdn-typea-signed` : url
  }
});

const { playbackRouter } = await import('./playback.routes.js');
const app = express();
app.use('/api/playback', playbackRouter);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));

let server, base;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  mock.reset();
});

function playUrl(id, source, quality) {
  const q = [];
  if (source) q.push(`source=${source}`);
  if (quality) q.push(`quality=${quality}`);
  return `${base}/api/playback/videos/${id}/play-url${q.length ? `?${q.join('&')}` : ''}`;
}

test('CDN 鉴权开启：play-url 返回可信 CDN TypeA 短签，expiresIn 取 TTL', async () => {
  state.publiclyReadable = true;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.url, 'https://cos.example/videos/tracks/1/a.mp4?sign=cdn-typea-signed');
  assert.equal(body.data.expiresIn, 600);
});

test('CDN 鉴权开启：私密视频对学生仍 404（不改变角色权限）', async () => {
  state.publiclyReadable = false;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 404);
});

test('CDN 未产生签名时回退 COS 短签，不返回永久直链', async () => {
  state.publiclyReadable = false;
  state.cdnSigned = false;
  try {
    const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'teacher' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.url, 'https://signed.example/videos/tracks/1/a.mp4?sig=abc');
    assert.equal(body.data.expiresIn, 300);
  } finally {
    state.cdnSigned = true;
  }
});

test('CDN 鉴权开启：teacher 仍可取 CDN 短签', async () => {
  state.publiclyReadable = false;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.url, 'https://cos.example/videos/tracks/1/a.mp4?sign=cdn-typea-signed');
  assert.equal(body.data.expiresIn, 600);
});
