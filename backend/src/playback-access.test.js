import test from 'node:test';
import assert from 'node:assert/strict';
import { isVideoPubliclyReadable, needsAuthorization, serializePlaybackTarget, filterPubliclyReadableVideos } from './playback-access.js';

const STAFF = { role: 'super_admin', status: 'active' };
const TEACHER = { role: 'teacher', status: 'active' };
const STUDENT = { role: 'user', status: 'active' };
const GUEST = { role: 'user', status: 'active' };

test('isVideoPubliclyReadable：公开视频返回 true，私密视频返回 false', async () => {
  // isVideoPubliclyReadable 内部：
  //   1) SELECT 1 FROM videos WHERE id=$1（探测存在）
  //   2) canReadContentObject('video', id, guest) → SELECT 1 FROM videos v WHERE v.id=$1 AND NOT EXISTS(...)
  // 公开：探测有行，且 video 分支 SQL 返回一行（无任何私密宿主）。
  const publicClient = {
    query: async (sql) => {
      if (/NOT EXISTS/.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/FROM videos WHERE id = \$1/.test(sql)) return { rowCount: 1, rows: [{ id: 1 }] };
      return { rows: [] };
    }
  };
  assert.equal(await isVideoPubliclyReadable(publicClient, 1), true);

  // 私密：video 分支的 NOT EXISTS 命中私密宿主 → 空 rows。
  const privateClient = {
    query: async (sql) => {
      if (/NOT EXISTS/.test(sql)) return { rows: [] };
      if (/FROM videos WHERE id = \$1/.test(sql)) return { rowCount: 1, rows: [{ id: 2 }] };
      return { rows: [] };
    }
  };
  assert.equal(await isVideoPubliclyReadable(privateClient, 2), false);
});

test('isVideoPubliclyReadable：视频不存在返回 false', async () => {
  const client = { query: async () => ({ rowCount: 0, rows: [] }) };
  assert.equal(await isVideoPubliclyReadable(client, 999), false);
});

test('needsAuthorization：公开对象无需授权，私密对象仅教师/主任需授权', () => {
  assert.equal(needsAuthorization(true, STUDENT), false);
  assert.equal(needsAuthorization(true, STAFF), false);
  assert.equal(needsAuthorization(false, STUDENT), false); // 学生不能看私密
  assert.equal(needsAuthorization(false, GUEST), false);
  assert.equal(needsAuthorization(false, TEACHER), true);
  assert.equal(needsAuthorization(false, STAFF), true);
});

test('serializePlaybackTarget：公开下发永久地址；私密教师给授权端点；私密学生清空', () => {
  const publicTarget = serializePlaybackTarget({
    publiclyReadable: true, viewer: STUDENT,
    publicUrl: 'https://cos/a.mp4', playUrl: 'https://cdn/a.mp4'
  });
  assert.equal(publicTarget.url, 'https://cos/a.mp4');
  assert.equal(publicTarget.playUrl, 'https://cdn/a.mp4');
  assert.equal(publicTarget.authorized, false);

  const privateStaff = serializePlaybackTarget({
    publiclyReadable: false, viewer: STAFF,
    publicUrl: 'https://cos/b.mp4', playUrl: 'https://cdn/b.mp4',
    authorizeEndpoint: '/api/playback/videos/2/play-url'
  });
  assert.equal(privateStaff.url, '');
  assert.equal(privateStaff.playUrl, '');
  assert.equal(privateStaff.authorized, true);
  assert.equal(privateStaff.authorizeEndpoint, '/api/playback/videos/2/play-url');

  const privateStudent = serializePlaybackTarget({
    publiclyReadable: false, viewer: STUDENT,
    publicUrl: 'https://cos/c.mp4', playUrl: 'https://cdn/c.mp4',
    authorizeEndpoint: '/api/playback/videos/3/play-url'
  });
  assert.equal(privateStudent.url, '');
  assert.equal(privateStudent.playUrl, '');
  assert.equal(privateStudent.authorized, false);
  assert.equal(privateStudent.authorizeEndpoint, '');
});

// filterPubliclyReadableVideos：共享视频任一私密宿主即视为不可公开（fail-closed）。
// 命中 UNION ALL 两类宿主（track_parts / knowledge_parts）任一私密记录即被剔除。
test('filterPubliclyReadableVideos：空输入返回空集', async () => {
  const client = { query: async () => ({ rows: [], rowCount: 0 }) };
  const r = await filterPubliclyReadableVideos(client, []);
  assert.ok(r instanceof Set);
  assert.equal(r.size, 0);
});

test('filterPubliclyReadableVideos：全部公开宿主的视频被保留', async () => {
  const client = {
    async query(sql) {
      assert.ok(/UNION ALL/.test(sql), '应拼接 track_parts 与 knowledge_parts 两类宿主');
      assert.ok(/track_parts/.test(sql) && /knowledge_parts/.test(sql));
      return { rows: [], rowCount: 0 };
    }
  };
  const r = await filterPubliclyReadableVideos(client, [10, 20, 30]);
  assert.deepEqual([...r].sort((a, b) => a - b), [10, 20, 30]);
});

test('filterPubliclyReadableVideos：任一私密宿主（track 或 knowledge）的视频被剔除', async () => {
  const client = {
    async query(sql) {
      assert.ok(/UNION ALL/.test(sql));
      // 模拟“video_id=20 在任一宿主上为私密”。
      return { rows: [{ video_id: 20 }], rowCount: 1 };
    }
  };
  const r = await filterPubliclyReadableVideos(client, [10, 20, 30]);
  assert.deepEqual([...r].sort((a, b) => a - b), [10, 30]);
});

test('filterPubliclyReadableVideos：knowledge 宿主私密同样剔除（SQL 同时覆盖两类）', async () => {
  let capturedSql = '';
  const client = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [{ video_id: 10 }], rowCount: 1 };
    }
  };
  const r = await filterPubliclyReadableVideos(client, [10, 20]);
  assert.ok(/FROM knowledge_parts x JOIN knowledge_points c/.test(capturedSql), 'SQL 应覆盖 knowledge 宿主');
  assert.deepEqual([...r].sort((a, b) => a - b), [20]);
});
