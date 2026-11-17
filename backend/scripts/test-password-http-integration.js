// Isolated real-PostgreSQL/Express integration. Never run against a business database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.startsWith('/password_rehearsal_')) throw Error('Isolated password_rehearsal_ database required');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.COOKIE_SECURE = 'false';
const { pool } = await import('../src/db.js');
const { migrateAuthVersion } = await import('./migrate-auth-version.js');
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { default: bcrypt } = await import('bcryptjs');
const { adminRouter } = await import('../src/admin.routes.js');
const { userAuthRouter } = await import('../src/user-auth.routes.js');
const { miniprogramRouter } = await import('../src/miniprogram.routes.js');
const { signAdminToken, signUserToken } = await import('../src/auth.js');
const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/admin', adminRouter); app.use('/api/user', userAuthRouter); app.use('/api/miniprogram', miniprogramRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
let server; let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; console.log('PASS', label); }
try {
  const client = await pool.connect(); try { await migrateAuthVersion(client); await migrateAuthVersion(client); } finally { client.release(); }
  const suffix = randomBytes(5).toString('hex');
  const oldPassword = randomBytes(10).toString('hex'); const newPassword = randomBytes(10).toString('hex');
  const hash = await bcrypt.hash(oldPassword, 10);
  const accounts = {};
  for (const role of ['teacher', 'super_admin']) {
    const r = await pool.query('INSERT INTO admins(username,account,nickname,password_hash,role,status) VALUES($1::text,$1::text,$1::text,$2,$3,\'active\') RETURNING *', ['verify_' + role + suffix, hash, role]); accounts[role] = r.rows[0];
  }
  const u = await pool.query('INSERT INTO users(username,account,nickname,password_hash,status,is_active) VALUES($1::text,$1::text,$1::text,$2,\'active\',TRUE) RETURNING *', ['verify_user' + suffix, hash]); accounts.user = u.rows[0];
  const root = (await pool.query("SELECT * FROM admins WHERE username='admin' AND role='super_admin' LIMIT 1")).rows[0];
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(path, { cookie, token, body, method = 'POST' } = {}) {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json() };
  }
  const cookies = { user: 'user_token=' + signUserToken(accounts.user), teacher: 'admin_token=' + signAdminToken(accounts.teacher), super_admin: 'admin_token=' + signAdminToken(accounts.super_admin) };
  const miniToken = signUserToken(accounts.user);
  check((await call('/api/admin/users/' + accounts.user.id + '/reset-password', { cookie: cookies.teacher })).status === 403, 'teacher reset forbidden');
  for (const role of ['user', 'teacher', 'super_admin']) {
    const prefix = role === 'user' ? '/api/user' : '/api/admin';
    const bad = await call(prefix + '/change-password', { cookie: cookies[role], body: { oldPassword: 'incorrect', newPassword } });
    check(bad.status === 400 && bad.json.code === 'OLD_PASSWORD_INCORRECT', role + ' wrong old password');
    check((await call(prefix + '/me', { cookie: cookies[role], method: 'GET' })).status === 200, role + ' session survives wrong password');
    check((await call(prefix + '/change-password', { cookie: cookies[role], body: { oldPassword, newPassword } })).status === 200, role + ' self change');
    check((await call(prefix + '/me', { cookie: cookies[role], method: 'GET' })).status === 401, role + ' old cookie revoked');
  }
  check((await call('/api/miniprogram/me', { token: miniToken, method: 'GET' })).status === 401, 'cross-device mini token revoked');
  const currentUser = (await pool.query('SELECT * FROM users WHERE id=$1', [accounts.user.id])).rows[0];
  check(await bcrypt.compare(newPassword, currentUser.password_hash), 'new password hash works');
  check(!await bcrypt.compare(oldPassword, currentUser.password_hash), 'old password hash fails');
  const miniCurrent = signUserToken(currentUser);
  check((await call('/api/miniprogram/change-password', { token: miniCurrent, body: { oldPassword: newPassword, newPassword: oldPassword } })).status === 200, 'mini self change');
  check((await call('/api/miniprogram/me', { token: miniCurrent, method: 'GET' })).status === 401, 'mini self change revokes token');
  const dean = (await pool.query('SELECT * FROM admins WHERE id=$1', [accounts.super_admin.id])).rows[0];
  const deanCookie = 'admin_token=' + signAdminToken(dean);
  check((await call('/api/admin/users/' + accounts.user.id + '/reset-password', { cookie: deanCookie, body: { password: 'malicious-value' } })).status === 200, 'dean reset succeeds');
  const resetUser = (await pool.query('SELECT * FROM users WHERE id=$1', [accounts.user.id])).rows[0];
  check(await bcrypt.compare('Nxh123456', resetUser.password_hash), 'reset fixed password ignores input');
  const beforeResetToken = signUserToken({ ...resetUser, auth_version: resetUser.auth_version - 1 });
  check((await call('/api/miniprogram/me', { token: beforeResetToken, method: 'GET' })).status === 401, 'management reset revokes target session');
  check((await call('/api/user/login', { body: { username: resetUser.username, password: 'Nxh123456' } })).status === 200, 'fixed password real login');
  check((await call('/api/admin/me', { cookie: deanCookie, method: 'GET' })).status === 200, 'operator session retained');
  if (root) {
    const rootCookie = 'admin_token=' + signAdminToken(root);
    check((await call('/api/admin/change-password', { cookie: rootCookie, body: { oldPassword, newPassword } })).status === 403, 'root self change forbidden');
    const rootReset = await call('/api/admin/admins/' + root.id + '/reset-password', { cookie: deanCookie });
    check([400, 403].includes(rootReset.status), 'root target reset forbidden (status ' + rootReset.status + ')');
  }
  // 新建学员：只在隔离副本中验证未分班与班级校验，不污染业务库。
  for (const [index, value] of [undefined, null, ''].entries()) {
    const username = '8' + String(BigInt('0x' + randomBytes(6).toString('hex')));
    const created = await call('/api/admin/users', { cookie: deanCookie, body: { username, nickname: '未班' + suffix.slice(0, 5) + index, ...(index === 0 ? {} : { password: index === 1 ? 'ClientOverride123' : '' }), ...(value === undefined ? {} : { classId: value }) } });
    check(created.status === 201 && created.json.data.class_id === null, 'create unassigned student: ' + String(value));
    const login = await call('/api/user/login', { body: { username, password: 'Nxh123456' } });
    check(login.status === 200, 'new student fixed initial password login: ' + index);
    if (index === 1) {
      check((await call('/api/user/login', { body: { username, password: 'ClientOverride123' } })).status === 401, 'client chosen initial password ignored');
    }
  }
  for (const [index, value] of ['bad-id', 2147483647].entries()) {
    const username = '8' + String(BigInt('0x' + randomBytes(6).toString('hex')));
    const invalid = await call('/api/admin/users', { cookie: deanCookie, body: { username, nickname: '坏班' + suffix.slice(0, 5) + index, password: oldPassword, classId: value } });
    check(invalid.status === 400, 'invalid or missing class rejected: ' + index);
  }
  console.log('RESULT', passed, 'checks passed; isolated database retained');
} finally { if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); }
