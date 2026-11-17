// password-service 单元测试：用 fake pool 模拟真实事务（connect/query/release），
// 覆盖本人改密（原子 hash + 版本递增、root 禁改、旧密码错 400、长度、新旧不同）
// 与管理员固定密码重置（固定 Nxh123456、root 禁重置、禁自重置、递增失效旧 token）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  changeOwnPassword,
  resetPasswordAsAdmin,
  validatePasswordLength,
  FIXED_RESET_PASSWORD,
  isRootAdmin
} from './password-service.js';

function makeFakePool(store) {
  return {
    async connect() {
      return {
        async query(sql, params = []) {
          const s = String(sql).trim();
          if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(s)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM admins WHERE id = \$1 FOR UPDATE/.test(s)) {
            const row = store.admins.get(Number(params[0]));
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }
          if (/FROM users WHERE id = \$1 FOR UPDATE/.test(s)) {
            const row = store.users.get(Number(params[0]));
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }
          const upd = s.match(/UPDATE (admins|users) SET password_hash = \$1, auth_version = auth_version \+ 1 WHERE id = \$2 AND auth_version = \$3/);
          if (upd) {
            const table = upd[1];
            const map = table === 'admins' ? store.admins : store.users;
            const row = map.get(Number(params[1]));
            if (row && Number(row.auth_version) === Number(params[2])) {
              row.password_hash = params[0];
              row.auth_version = Number(row.auth_version) + 1;
              return { rows: [row], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

function makeStore(overrides = {}) {
  const toMap = (obj) => new Map(Object.entries(obj || {}).map(([k, v]) => [Number(k), v]));
  return {
    admins: toMap(overrides.admins),
    users: toMap(overrides.users)
  };
}

const OLD = 'oldPass123';
const NEW = 'newPass456';

function adminRow({ id = 1, username = 'teacher1', role = 'teacher', auth_version = 0 } = {}) {
  return { id, username, role, password_hash: bcrypt.hashSync(OLD, 10), auth_version };
}
function userRow({ id = 1, auth_version = 0 } = {}) {
  return { id, password_hash: bcrypt.hashSync(OLD, 10), auth_version };
}

test('validatePasswordLength：长度边界', () => {
  assert.equal(validatePasswordLength('abc'), '密码长度必须是 5 到 30 个字符');
  assert.equal(validatePasswordLength('a'.repeat(31)), '密码长度必须是 5 到 30 个字符');
  assert.equal(validatePasswordLength('abcde'), '');
  assert.equal(validatePasswordLength('a'.repeat(30)), '');
});

test('isRootAdmin：仅 username=admin 且 role=super_admin 判定为 root', () => {
  assert.equal(isRootAdmin({ username: 'admin', role: 'super_admin' }), true);
  assert.equal(isRootAdmin({ username: 'admin', role: 'teacher' }), false);
  assert.equal(isRootAdmin({ username: 'other', role: 'super_admin' }), false);
});

test('changeOwnPassword：旧密码正确 → 成功且版本递增、hash 更新', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'users', id: 1, oldPassword: OLD, newPassword: NEW });
  assert.deepEqual(result, { ok: true });
  const row = store.users.get(1);
  assert.equal(row.auth_version, 1);
  assert.equal(await bcrypt.compare(NEW, row.password_hash), true);
  assert.equal(await bcrypt.compare(OLD, row.password_hash), false);
});

test('changeOwnPassword：旧密码错误 → 400 OLD_PASSWORD_INCORRECT（非 401）', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'users', id: 1, oldPassword: 'wrong', newPassword: NEW });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'OLD_PASSWORD_INCORRECT');
  assert.equal(store.users.get(1).auth_version, 0);
});

test('changeOwnPassword：新密码与旧密码相同 → 400 PASSWORD_UNCHANGED', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'users', id: 1, oldPassword: OLD, newPassword: OLD });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'PASSWORD_UNCHANGED');
});

test('changeOwnPassword：新密码长度不合法 → 400 INVALID_PASSWORD', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'users', id: 1, oldPassword: OLD, newPassword: 'ab' });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'INVALID_PASSWORD');
});

test('changeOwnPassword：账号不存在 → 404', async () => {
  const store = makeStore({ users: {} });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'users', id: 99, oldPassword: OLD, newPassword: NEW });
  assert.equal(result.status, 404);
});

test('changeOwnPassword：root 本人改密被禁止 → 403 ROOT_PASSWORD_FORBIDDEN', async () => {
  const store = makeStore({ admins: { 1: adminRow({ username: 'admin', role: 'super_admin' }) } });
  const pool = makeFakePool(store);
  const result = await changeOwnPassword({ pool, table: 'admins', id: 1, oldPassword: OLD, newPassword: NEW });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'ROOT_PASSWORD_FORBIDDEN');
  assert.equal(store.admins.get(1).auth_version, 0);
});

test('resetPasswordAsAdmin：学员重置为固定密码且版本递增', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  const result = await resetPasswordAsAdmin({ pool, table: 'users', id: 1, operatorId: 2 });
  assert.deepEqual(result, { ok: true });
  const row = store.users.get(1);
  assert.equal(row.auth_version, 1);
  assert.equal(await bcrypt.compare(FIXED_RESET_PASSWORD, row.password_hash), true);
});

test('resetPasswordAsAdmin：目标 root 禁止重置 → 400 ROOT_PASSWORD_FORBIDDEN', async () => {
  const store = makeStore({ admins: { 1: adminRow({ username: 'admin', role: 'super_admin' }) } });
  const pool = makeFakePool(store);
  const result = await resetPasswordAsAdmin({ pool, table: 'admins', id: 1, operatorId: 2 });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'ROOT_PASSWORD_FORBIDDEN');
});

test('resetPasswordAsAdmin：管理员重置自己被禁止 → 400 CANNOT_RESET_SELF', async () => {
  const store = makeStore({ admins: { 2: adminRow({ id: 2, username: 'teacher2', role: 'super_admin' }) } });
  const pool = makeFakePool(store);
  const result = await resetPasswordAsAdmin({ pool, table: 'admins', id: 2, operatorId: 2 });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'CANNOT_RESET_SELF');
});

test('resetPasswordAsAdmin：账号不存在 → 404', async () => {
  const store = makeStore({ users: {} });
  const pool = makeFakePool(store);
  const result = await resetPasswordAsAdmin({ pool, table: 'users', id: 99, operatorId: 2 });
  assert.equal(result.status, 404);
});

test('resetPasswordAsAdmin：不信任客户端密码，固定 Nxh123456（即使传入其它值也无影响）', async () => {
  const store = makeStore({ users: { 1: userRow() } });
  const pool = makeFakePool(store);
  // 服务不接收 password 参数，固定写 FIXED_RESET_PASSWORD。
  await resetPasswordAsAdmin({ pool, table: 'users', id: 1, operatorId: 2 });
  const row = store.users.get(1);
  assert.equal(await bcrypt.compare(FIXED_RESET_PASSWORD, row.password_hash), true);
  assert.equal(await bcrypt.compare('attackerPassword', row.password_hash), false);
});
