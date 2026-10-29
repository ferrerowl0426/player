// Real HTTP transport against production Express routers; controlled DB/auth boundaries.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
let visibility = 'private';
const client = { async query(sql) {
  if (/FROM prerequisites/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
  if (/UPDATE track_points c SET visibility/.test(sql)) return { rows: [{ id: 1, visibility: 'private' }], rowCount: 1 };
  return { rows: [{ id: 1, name: 'course', visibility: 'public' }], rowCount: 1 };
}, release() {} };
mock.module(new URL('./db.js', import.meta.url).href, { namedExports: { pool: { connect: async () => client, query: async (sql) => {
  if (/FROM track_points WHERE/.test(sql)) return { rows: [{ id: 1, name: 'course', visibility }], rowCount: 1 };
  if (/SELECT tp.id, tp.part_no/.test(sql)) return { rows: [{ id: 1, visibility: 'public' }], rowCount: 1 };
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
test('HTTP student cannot write, director conflict returns 409', async () => {
  const body = JSON.stringify({ name: 'edited' });
  assert.equal((await fetch(`${base}/tracks/1`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', 'x-test-role': 'student' } })).status, 403);
  assert.equal((await fetch(`${base}/tracks/1`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json', 'x-test-role': 'super_admin' } })).status, 409);
});
