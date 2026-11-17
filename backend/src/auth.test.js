// auth.js 鉴权回查版本测试：mock db.js 的 pool，覆盖 resolveAdminSession / requireUser
// 在 auth_version 缺失或匹配时的放行与拒绝。mock 行真实携带 auth_version。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const SRC_DB = new URL('./db.js', import.meta.url).href;

process.env.JWT_SECRET = 'test-secret';

let adminRow = null;
let userRow = null;
const fakePool = {
  async query(sql, params) {
    if (/FROM admins WHERE id = \$1/.test(sql)) {
      return { rows: adminRow ? [adminRow] : [], rowCount: adminRow ? 1 : 0 };
    }
    if (/FROM users WHERE id = \$1/.test(sql)) {
      return { rows: userRow ? [userRow] : [], rowCount: userRow ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./auth.js');
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

function adminToken(overrides = {}) {
  return jwt.sign({ type: 'admin', adminId: 1, username: 'a', role: 'super_admin', status: 'active', authVersion: 0, ...overrides }, 'test-secret');
}
function userToken(overrides = {}) {
  return jwt.sign({ type: 'user', userId: 2, role: 'user', status: 'active', authVersion: 0, ...overrides }, 'test-secret');
}

test('resolveAdminSession：版本匹配且 active → 返回会话', async () => {
  adminRow = { id: 1, username: 'a', account: 'a', nickname: 'a', role: 'super_admin', status: 'active', auth_version: 0 };
  const res = makeRes();
  const session = await mod.resolveAdminSession({ cookies: { admin_token: adminToken() } }, res, () => {});
  assert.ok(session);
  assert.equal(session.role, 'super_admin');
  assert.equal(res.cleared.length, 0);
});

test('resolveAdminSession：auth_version 不匹配 → 401 且清 Cookie', async () => {
  adminRow = { id: 1, username: 'a', account: 'a', nickname: 'a', role: 'super_admin', status: 'active', auth_version: 5 };
  const res = makeRes();
  const session = await mod.resolveAdminSession({ cookies: { admin_token: adminToken({ authVersion: 0 }) } }, res, () => {});
  assert.equal(session, null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.cleared.includes('admin_token'), true);
});

test('resolveAdminSession：token 缺 authVersion（迁移前旧 token） → 401', async () => {
  adminRow = { id: 1, username: 'a', account: 'a', nickname: 'a', role: 'super_admin', status: 'active', auth_version: 0 };
  const old = jwt.sign({ type: 'admin', adminId: 1, username: 'a', role: 'super_admin', status: 'active' }, 'test-secret');
  const res = makeRes();
  const session = await mod.resolveAdminSession({ cookies: { admin_token: old } }, res, () => {});
  assert.equal(session, null);
  assert.equal(res.statusCode, 401);
});

test('requireUser：版本匹配且 active → 放行并设置 req.user', async () => {
  userRow = { id: 2, status: 'active', is_active: true, auth_version: 0 };
  let called = false;
  const res = makeRes();
  await mod.requireUser({ cookies: { user_token: userToken() } }, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test('requireUser：auth_version 不匹配 → 401 拒绝', async () => {
  userRow = { id: 2, status: 'active', is_active: true, auth_version: 2 };
  let called = false;
  const res = makeRes();
  await mod.requireUser({ cookies: { user_token: userToken({ authVersion: 0 }) } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('requireUser：停用用户 → 403', async () => {
  userRow = { id: 2, status: 'disabled', is_active: false, auth_version: 0 };
  let called = false;
  const res = makeRes();
  await mod.requireUser({ cookies: { user_token: userToken() } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
