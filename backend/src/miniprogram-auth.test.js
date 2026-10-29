// 针对 miniprogram.auth.js 的测试：学生登录保留，但停用学生必须被拒绝；并校验 studentToViewer。
// 不连接真实数据库，mock db.js 的 pool。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';

const SRC_DB = new URL('./db.js', import.meta.url).href;

process.env.JWT_SECRET = 'test-secret';

let studentRow = null;
const fakePool = {
  async query(sql, params) {
    if (/FROM users u\s+LEFT JOIN teaching_classes/.test(sql)) {
      return { rows: studentRow ? [studentRow] : [], rowCount: studentRow ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./miniprogram.auth.js');
});
test.after(() => { mock.reset(); });

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    cleared: [],
    status(c) { this.statusCode = c; return this; },
    json(p) { if (this.body === undefined) this.body = p; return this; },
    clearCookie(name) { this.cleared.push(name); return this; }
  };
}

function tokenFor(userId = 1) {
  return jwt.sign({ type: 'user', userId, role: 'user', status: 'active' }, 'test-secret');
}

test('requireMiniStudent：无 token 返回 401', async () => {
  studentRow = { id: 1, status: 'active', is_active: true };
  let called = false;
  const res = makeRes();
  await mod.requireMiniStudent({ headers: {}, cookies: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('requireMiniStudent：停用学生返回 403 且拒绝放行', async () => {
  studentRow = { id: 1, status: 'disabled', is_active: false };
  let called = false;
  const res = makeRes();
  await mod.requireMiniStudent({ headers: { authorization: `Bearer ${tokenFor()}` }, cookies: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error?.code, 'ACCOUNT_DISABLED');
  assert.equal(called, false);
});

test('requireMiniStudent：is_active=false 但无 status 字段也视为停用', async () => {
  studentRow = { id: 1, is_active: false };
  let called = false;
  const res = makeRes();
  await mod.requireMiniStudent({ headers: { authorization: `Bearer ${tokenFor()}` }, cookies: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
});

test('requireMiniStudent：有效学生放行并设置 req.student', async () => {
  studentRow = { id: 1, status: 'active', is_active: true, username: 's1', account: 's1', nickname: '学生1', class_id: 7 };
  let called = false;
  const req = { headers: { authorization: `Bearer ${tokenFor()}` }, cookies: {} };
  const res = makeRes();
  await mod.requireMiniStudent(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.student?.id, '1');
  assert.equal(req.student?.status, 'active');
});

test('requireMiniStudent：学生不存在返回 401', async () => {
  studentRow = null;
  let called = false;
  const res = makeRes();
  await mod.requireMiniStudent({ headers: { authorization: `Bearer ${tokenFor()}` }, cookies: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('studentToViewer：把 active 学生映射为 user viewer，停用映射为 disabled', () => {
  assert.deepEqual(mod.studentToViewer({ status: 'active' }), { role: 'user', status: 'active' });
  assert.deepEqual(mod.studentToViewer({ status: 'disabled' }), { role: 'user', status: 'disabled' });
  assert.equal(mod.studentToViewer(undefined), undefined);
});
