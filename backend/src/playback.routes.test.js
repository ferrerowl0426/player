// 视频播放短期授权端点的真实 HTTP 传输测试（mock db / auth / storage / playback-access）。
// 覆盖：匿名/学生访问私密视频 404、teacher/super_admin 可获短期签名、公开视频也可取签名、
// 非法 quality/source 400、签名失败 500、HEAD 同授权、no-store。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./auth.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;
const SRC_PLAYBACK_ACCESS = new URL('./playback-access.js', import.meta.url).href;

// 可变场景状态。
const state = {
  publiclyReadable: true, // isVideoPubliclyReadable 返回值
  videoUrl: 'http://public.example/videos/tracks/1/a.mp4', // videos 表 video_url
  renditionUrl: 'http://public.example/videos/tracks/1/a-720p.mp4' // renditions 表 video_url
};
const storageState = { fail: false };

function makeFakePool() {
  const client = {
    async query(sql, params) {
      // getKeyFromPublicUrl 依赖 storage.js 的 config；这里由 playback-access mock 决定公开性。
      // videos 表查询
      if (/SELECT video_url FROM videos WHERE id\s*=\s*\$1/.test(sql)) {
        return { rows: [{ video_url: state.videoUrl }], rowCount: 1 };
      }
      // video_renditions 查询
      if (/SELECT video_url FROM video_renditions WHERE video_id\s*=\s*\$1/.test(sql)) {
        return { rows: [{ video_url: state.renditionUrl }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return { query: client.query, connect: async () => client };
}

function viewerFromRole(role) {
  if (role === 'teacher') return { role: 'teacher', status: 'active' };
  if (role === 'super_admin') return { role: 'super_admin', status: 'active' };
  if (role === 'student') return { role: 'user', status: 'active' };
  return undefined;
}

mock.module(SRC_DB, { namedExports: { pool: makeFakePool() } });
mock.module(SRC_AUTH, {
  namedExports: {
    optionalContentViewer(req, res, next) {
      req.contentViewer = viewerFromRole(req.headers['x-test-role']);
      next();
    }
  }
});
mock.module(SRC_STORAGE, {
  namedExports: {
    createDownloadUrl: async () => {
      if (storageState.fail) throw new Error('COS internal error');
      return 'https://signed.example/videos/tracks/1/a.mp4?sig=abc';
    },
    getKeyFromPublicUrl: (url) => String(url || '').split('public.example/')[1] || ''
  }
});
mock.module(SRC_PLAYBACK_ACCESS, {
  namedExports: {
    isVideoPubliclyReadable: async () => state.publiclyReadable
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

test('匿名/学生访问私密视频被拒绝（404 fail-closed）', async () => {
  state.publiclyReadable = false;
  for (const role of ['student', '']) {
    const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': role } });
    assert.equal(res.status, 404, `role=${role}`);
  }
});

test('teacher / super_admin 可获取私密视频短期签名 URL', async () => {
  state.publiclyReadable = false;
  for (const role of ['teacher', 'super_admin']) {
    const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': role } });
    assert.equal(res.status, 200, `role=${role}`);
    const body = await res.json();
    assert.equal(body.data.id, 1);
    assert.match(body.data.url, /signed\.example/);
    assert.equal(body.data.expiresIn, 300);
  }
});

test('公开视频任意登录者也可取签名（保持行为一致）', async () => {
  state.publiclyReadable = true;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 200);
});

test('rendition 源可获取清晰度签名', async () => {
  state.publiclyReadable = true;
  const res = await fetch(playUrl(1, 'rendition', '720p'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.source, 'rendition');
  assert.equal(body.data.quality, '720p');
});

test('非法 source / quality 返回 400', async () => {
  state.publiclyReadable = true;
  assert.equal((await fetch(playUrl(1, 'bad'), { headers: { 'x-test-role': 'student' } })).status, 400);
  assert.equal((await fetch(playUrl(1, 'video', '480p'), { headers: { 'x-test-role': 'student' } })).status, 400);
});

test('签名失败返回 500 通用文案，不泄露底层错误', async () => {
  state.publiclyReadable = true;
  storageState.fail = true;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.message, /播放地址生成失败/);
  storageState.fail = false;
});

test('HEAD 与 GET 同授权，且响应带 no-store / Vary', async () => {
  state.publiclyReadable = true;
  const res = await fetch(playUrl(1, 'video'), { headers: { 'x-test-role': 'student' } });
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.match(res.headers.get('cache-control'), /private/);
  assert.match(res.headers.get('vary'), /Cookie/);

  const head = await fetch(playUrl(1, 'video'), { method: 'HEAD', headers: { 'x-test-role': 'student' } });
  assert.equal(head.status, 200);
});
