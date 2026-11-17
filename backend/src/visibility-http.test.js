// Real HTTP transport against production Express routers; controlled DB/auth boundaries.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
let visibility = 'private';
let publicMembers = true;
const client = { async query(sql) {
  if (/FROM prerequisites/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
  if (/UPDATE track_points c SET visibility/.test(sql)) return { rows: [{ id: 1, visibility: 'private' }], rowCount: 1 };
  return { rows: [{ id: 1, name: 'course', visibility: 'public' }], rowCount: 1 };
}, release() {} };
mock.module(new URL('./db.js', import.meta.url).href, { namedExports: { pool: { connect: async () => client,   query: async (sql) => {
  if (/FROM track_points WHERE/.test(sql)) return { rows: [{ id: 1, name: 'course', visibility }], rowCount: 1 };
  if (/SELECT tp.id, tp.part_no/.test(sql)) return { rows: [{ id: 1, visibility: 'public' }], rowCount: 1 };
  // 合集存在性查询：findCollection 需返回合集，便于走完详情流程。
  if (/FROM track_collections WHERE id = \$1/.test(sql)) return { rows: [{ id: 1, name: 'collection', cover: '', description: '', updated_at: new Date() }], rowCount: 1 };
  // 合集公开成员判定（下推 SQL）：无公开成员时返回空，模拟合集不可见。
  if (/SELECT 1\s+FROM track_collection_items ci/.test(sql)) {
    return publicMembers ? { rows: [{ one: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
} } } });
mock.module(new URL('./auth.js', import.meta.url).href, { namedExports: {
  optionalContentViewer(req, res, next) { req.contentViewer = { role: req.headers['x-test-role'] || 'student', status: 'active' }; next(); },
  requireSuperAdmin(req, res, next) { if (req.headers['x-test-role'] !== 'super_admin') return res.status(403).json({ message: 'forbidden' }); req.admin = { adminId: 1 }; next(); }
} });
process.env.CONTENT_PRIVACY_MODE = 'local-preview';
delete process.env.NODE_ENV;
const { tracksRouter } = await import('./tracks.routes.js');
const app = express(); app.use(express.json()); app.use('/tracks', tracksRouter);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise((r) => server.close(r)); mock.reset(); });
test('HTTP guest/student cannot read private course', async () => {
  visibility = 'private';
  for (const role of ['', 'student']) assert.equal((await fetch(`${base}/tracks/1`, { headers: { 'x-test-role': role } })).status, 404);
});
test('HTTP teacher and director can read private course', async () => {
  visibility = 'private';
  for (const role of ['teacher', 'super_admin']) assert.equal((await fetch(`${base}/tracks/1`, { headers: { 'x-test-role': role } })).status, 200);
});
test('HTTP student cannot write, director may write (private no longer blocked by prerequisite conflict)', async () => {
  const body = JSON.stringify({ name: 'edited' });
  assert.equal((await fetch(`${base}/tracks/1`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', 'x-test-role': 'student' } })).status, 403);
  // 私密变为常规业务：即便存在前置引用，主任（super_admin）编辑课程也不再被 PREREQUISITE_CONFLICT 阻断。
  assert.equal((await fetch(`${base}/tracks/1`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', 'x-test-role': 'super_admin' } })).status, 200);
});

test('HTTP PATCH course returns refreshed derived visibility', async () => {
  const body = JSON.stringify({ name: 'edited' });
  const res = await fetch(`${base}/tracks/1`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', 'x-test-role': 'super_admin' } });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.visibility, 'private', '刷新后应为 private（mock refresh 固定返回 private）');
});

// 合集详情：游客/学生无公开成员 -> 404；管理身份仍可读取空合集。
test('HTTP student cannot read collection with no public members -> 404', async () => {
  publicMembers = false;
  const res = await fetch(`${base}/tracks/collections/1`, { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 404);
});

test('HTTP student can read collection when it has public members -> 200', async () => {
  publicMembers = true;
  const res = await fetch(`${base}/tracks/collections/1`, { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 200);
});

test('HTTP teacher/director can read empty collection -> 200', async () => {
  publicMembers = false;
  for (const role of ['teacher', 'super_admin']) {
    const res = await fetch(`${base}/tracks/collections/1`, { headers: { 'x-test-role': role } });
    assert.equal(res.status, 200, `role ${role} 应可读空合集`);
  }
});
