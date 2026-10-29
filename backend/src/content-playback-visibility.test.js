// tracks / knowledge 详情接口的分 P 播放地址清空逻辑（fail-closed）：
//   - 私密 P：返回 video_id 与 visibility='private'，但清空永久 video_url/play_url 与转码 URL，
//     交给前端经授权端点（/playback/videos/:id/play-url）播放。
//   - 公开 P 但所属视频存在任一私密宿主（共享视频）：非授权查看者同样清空（fail-closed）。
// 不连接真实数据库；mock db / auth / playback-access。storage 的 normalizePublicUrl/toPlaybackUrl
// 为纯函数（仅对 https 完整地址原样处理），可直接运行。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./auth.js', import.meta.url).href;
const SRC_PLAYBACK_ACCESS = new URL('./playback-access.js', import.meta.url).href;

const COS = 'https://gy-nodejs-study-1423556188.cos.ap-nanjing.myqcloud.com';
const CDN = 'https://media.nxhguitar.com';
const VIDEO_URL = `${COS}/videos/tracks/1/abc.mp4`;
const RENDITION_URL = `${COS}/videos/tracks/1/abc-720p.mp4`;

// 受控场景状态。
const state = {
  role: 'student', // undefined=guest, 'student', 'teacher', 'super_admin'
  parts: [],
  renditions: [],
  readableVideos: new Set()
};

function makeFakePool() {
  const client = {
    async query(sql) {
      // 详情父对象（track_point / knowledge_point）。
      if (/FROM track_points WHERE id = \$1/.test(sql) && /visibility/.test(sql)) {
        return { rows: [{ id: 1, name: 'course', cover: '', description: '', visibility: 'public', created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/FROM knowledge_points WHERE id = \$1/.test(sql)) {
        return { rows: [{ id: 1, name: 'point', cover: '', description: '', visibility: 'public', created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      // 分 P 列表（track_parts / knowledge_parts 任一，注意 SQL 可能跨行）。
      if (/FROM (?:track_parts|knowledge_parts)\s+\w+\s+LEFT JOIN videos/.test(sql)) {
        return { rows: state.parts, rowCount: state.parts.length };
      }
      // 转码清晰度。
      if (/FROM video_renditions\s+WHERE video_id = ANY/.test(sql)) {
        return { rows: state.renditions, rowCount: state.renditions.length };
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
      req.contentViewer = state.role ? { role: state.role, status: 'active' } : undefined;
      next();
    },
    requireSuperAdmin(req, res, next) { next(); }
  }
});
mock.module(SRC_PLAYBACK_ACCESS, {
  namedExports: {
    // 返回“对公开读取者可公开读取”的视频集合；任一私密宿主即不在此集合中。
    filterPubliclyReadableVideos: async (client, ids) => {
      void client; void ids;
      return state.readableVideos;
    }
  }
});

const { tracksRouter } = await import('./tracks.routes.js');
const { knowledgeRouter } = await import('./knowledge.routes.js');

const app = express();
app.use('/api/tracks', tracksRouter);
app.use('/api/knowledge', knowledgeRouter);
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

function partRow(visibility, videoId = 5) {
  return {
    id: 10, part_no: 1, title: 'P1', duration: 12,
    video_id: videoId, visibility,
    video_url: VIDEO_URL, video_cover_url: ''
  };
}
function renditionRow(videoId = 5) {
  return {
    video_id: videoId, quality: '720p', video_url: RENDITION_URL,
    file_size: 100, status: 'ready', updated_at: new Date()
  };
}

async function getDetail(kind) {
  const res = await fetch(`${base}/api/${kind}/1`);
  return res.status === 200 ? await res.json() : { status: res.status };
}

// 三种路由共用同一断言。
// 注意：8 个场景共享可变的 state，且 node:test 默认并发执行子测试，会在请求过程中互相改写
// state。用 concurrency:1 的父测试把它们串行化，确保“设置 state → 请求 → 断言”原子执行。
const KINDS = ['tracks', 'knowledge'];

test('分 P 播放地址清空（串行执行，避免 state 竞争）', { concurrency: 1 }, async (t) => {
  for (const kind of KINDS) {
    await t.test(`[${kind}] 私密 P：教师/主任也走授权端点，清空永久地址但保留 video_id/visibility`, async () => {
      state.role = 'teacher';
      state.parts = [partRow('private')];
      state.renditions = [renditionRow()];
      state.readableVideos = new Set([5]);
      const body = await getDetail(kind);
      assert.equal(body.status ?? 200, 200);
      const part = body.data.parts[0];
      assert.equal(part.video_id, 5, '应保留 video_id 供前端授权播放');
      assert.equal(part.visibility, 'private', '应标记为需授权');
      assert.equal(part.video_url, '', '私密 P 应清空 video_url');
      assert.equal(part.play_url, '', '私密 P 应清空 play_url');
      assert.equal(part.renditions[0].video_url, '', '私密 P 应清空转码地址');
      assert.equal(part.renditions[0].play_url, '');
    });

    await t.test(`[${kind}] 公开 P 但视频存在私密宿主（共享）：非授权查看者 fail-closed 清空`, async () => {
      state.role = 'student';
      state.parts = [partRow('public')]; // P 自身 public
      state.renditions = [renditionRow()];
      state.readableVideos = new Set(); // video 5 不在可读集合（有私密宿主）
      const body = await getDetail(kind);
      assert.equal(body.status ?? 200, 200);
      const part = body.data.parts[0];
      assert.equal(part.video_id, 5, '应保留 video_id 供前端授权播放');
      assert.equal(part.visibility, 'private', '共享私密应标记为需授权');
      assert.equal(part.video_url, '', '共享私密应清空 video_url');
      assert.equal(part.play_url, '', '共享私密应清空 play_url');
      assert.equal(part.renditions[0].video_url, '');
    });

    await t.test(`[${kind}] 公开 P 且视频无私密宿主：保留永久 CDN 播放地址`, async () => {
      state.role = 'student';
      state.parts = [partRow('public')];
      state.renditions = [renditionRow()];
      state.readableVideos = new Set([5]); // video 5 可读
      const body = await getDetail(kind);
      assert.equal(body.status ?? 200, 200);
      const part = body.data.parts[0];
      assert.equal(part.visibility, 'public', '纯公开 P 应保留 public');
      assert.ok(part.video_url.startsWith(COS), 'video_url 应保留 COS 原值');
      assert.ok(part.play_url.startsWith(CDN), 'play_url 应转换为 CDN');
      assert.ok(part.renditions[0].video_url.startsWith(COS));
      assert.ok(part.renditions[0].play_url.startsWith(CDN));
    });

    await t.test(`[${kind}] 游客访问“共享私密”的公开 P：不暴露存在性之外的永久地址（清空）`, async () => {
      state.role = undefined; // 游客
      state.parts = [partRow('public')];
      state.renditions = [renditionRow()];
      state.readableVideos = new Set(); // 共享私密宿主 → 不可读
      const body = await getDetail(kind);
      assert.equal(body.status ?? 200, 200);
      const part = body.data.parts[0];
      assert.equal(part.video_id, 5);
      assert.equal(part.visibility, 'private', '共享私密对游客也应标记为需授权');
      assert.equal(part.video_url, '', '游客不应拿到任何可播放永久地址');
      assert.equal(part.play_url, '');
    });
  }
});
