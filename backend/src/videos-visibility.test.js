// 针对 videos.routes.js 的可见性门禁测试：旧视频关联 track_parts / knowledge_parts 时检查
// “父课程 + P”交集；私密关联仅有效 teacher / super_admin 可见。不连接真实数据库。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DB = new URL('./db.js', import.meta.url).href;

process.env.JWT_SECRET = 'test-secret';

const STUDENT_VIEWER = { role: 'user', status: 'active' };
const TEACHER_VIEWER = { role: 'teacher', status: 'active' };

let videoRow = { id: 1, title: 'v', video_url: '', cover_url: '', description: '', created_at: new Date() };
let associations = [];
const fakePool = {
  async query(sql, params) {
    if (/FROM videos\s+WHERE id = \$1/.test(sql)) return { rows: [videoRow], rowCount: 1 };
    if (/FROM track_parts tp JOIN track_points/.test(sql) || /FROM knowledge_parts kp JOIN knowledge_points/.test(sql)) {
      return { rows: associations, rowCount: associations.length };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./videos.routes.js');
});
test.after(() => { mock.reset(); });
test.beforeEach(() => { associations = []; });

function extractGetDetailHandler(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === '/:id' && route.methods.get) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error('GET /:id handler not found');
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { this.ended = true; return this; }
  };
}

// ---------- 纯函数门禁逻辑 ----------

test('isVideoAccessible：无关联（独立旧视频）永远可访问', () => {
  assert.equal(mod.isVideoAccessible([], STUDENT_VIEWER), true);
  assert.equal(mod.isVideoAccessible([], TEACHER_VIEWER), true);
});

test('isVideoAccessible：父 public 且 P public -> 学生可访问', () => {
  associations = [{ course_visibility: 'public', part_visibility: 'public' }];
  assert.equal(mod.isVideoAccessible(associations, STUDENT_VIEWER), true);
});

test('isVideoAccessible：父 private -> 学生不可访问，教师可访问', () => {
  associations = [{ course_visibility: 'private', part_visibility: 'private' }];
  assert.equal(mod.isVideoAccessible(associations, STUDENT_VIEWER), false);
  assert.equal(mod.isVideoAccessible(associations, TEACHER_VIEWER), true);
});

test('isVideoAccessible：父 public 但 P private -> 学生不可访问', () => {
  associations = [{ course_visibility: 'public', part_visibility: 'private' }];
  assert.equal(mod.isVideoAccessible(associations, STUDENT_VIEWER), false);
});

test('isVideoAccessible：共享视频任一私密宿主即 fail-closed（OR 改为 every）', () => {
  // 同一视频被两个宿主关联：一个完全公开，一个私密。任一私密即视为私密。
  associations = [
    { course_visibility: 'public', part_visibility: 'public' },
    { course_visibility: 'private', part_visibility: 'private' }
  ];
  assert.equal(mod.isVideoAccessible(associations, STUDENT_VIEWER), false, '学生应被拒绝');
  assert.equal(mod.isVideoAccessible(associations, TEACHER_VIEWER), true, '教师仍可访问');
});

test('buildVideoCourseAssociationQuery：覆盖 track_parts 与 knowledge_parts 两类关联', () => {
  const sql = mod.buildVideoCourseAssociationQuery();
  assert.ok(/FROM track_parts tp JOIN track_points c/.test(sql), '缺少 track_parts 关联');
  assert.ok(/FROM knowledge_parts kp JOIN knowledge_points c/.test(sql), '缺少 knowledge_parts 关联');
});

// ---------- 详情 handler 端到端门禁 ----------

async function runDetailHandler(viewer) {
  const handler = extractGetDetailHandler(mod.videoRouter);
  const req = { params: { id: '1' }, query: {}, contentViewer: viewer, user: { type: 'user' }, admin: null };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  return res;
}

test('GET /:id：独立旧视频对学生返回 200', async () => {
  associations = [];
  const res = await runDetailHandler(STUDENT_VIEWER);
  assert.equal(res.statusCode, 200);
});

test('GET /:id：私密关联视频对学生返回 404（隐藏存在性）', async () => {
  associations = [{ course_visibility: 'private', part_visibility: 'private' }];
  const res = await runDetailHandler(STUDENT_VIEWER);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.message, '视频不存在');
});

test('GET /:id：私密关联视频对教师返回 200', async () => {
  associations = [{ course_visibility: 'private', part_visibility: 'private' }];
  const res = await runDetailHandler(TEACHER_VIEWER);
  assert.equal(res.statusCode, 200);
});

test('GET /:id：父 public 但 P private 的学生返回 404', async () => {
  associations = [{ course_visibility: 'public', part_visibility: 'private' }];
  const res = await runDetailHandler(STUDENT_VIEWER);
  assert.equal(res.statusCode, 404);
});

test('GET /:id：共享视频任一私密宿主对学生 404（fail-closed）', async () => {
  associations = [
    { course_visibility: 'public', part_visibility: 'public' },
    { course_visibility: 'private', part_visibility: 'private' }
  ];
  const res = await runDetailHandler(STUDENT_VIEWER);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body?.message, '视频不存在');
});

test('GET /:id：共享视频任一私密宿主对教师 200', async () => {
  associations = [
    { course_visibility: 'public', part_visibility: 'public' },
    { course_visibility: 'private', part_visibility: 'private' }
  ];
  const res = await runDetailHandler(TEACHER_VIEWER);
  assert.equal(res.statusCode, 200);
});
