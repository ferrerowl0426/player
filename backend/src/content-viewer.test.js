import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentViewerResolver, createContentViewerMiddleware } from './content-viewer.js';

function resolver({ admin = null, user = null, failDb = false } = {}) {
  return createContentViewerResolver({
    verifyToken: (token) => { if (token === 'invalid') throw Error('expired'); return JSON.parse(token); },
    loadAdmin: async () => { if (failDb) throw Error('db offline'); return admin; },
    loadUser: async () => user
  });
}
const adminToken = JSON.stringify({ type: 'admin', adminId: 1, role: 'super_admin', status: 'active' });
const userToken = JSON.stringify({ type: 'user', userId: 2, role: 'super_admin' });
test('anonymous and expired tokens are guests', async () => {
  assert.equal((await resolver()()).role, 'guest');
  assert.equal((await resolver()({ adminToken: 'invalid' })).role, 'guest');
});
test('database role overrides token snapshot', async () => {
  const viewer = await resolver({ admin: { id: 1, role: 'teacher', status: 'active' } })({ adminToken });
  assert.equal(viewer.role, 'teacher');
});
test('disabled or deleted admin cannot see private', async () => {
  assert.equal((await resolver({ admin: { id: 1, role: 'teacher', status: 'disabled' } })({ adminToken })).role, 'guest');
  assert.equal((await resolver()({ adminToken })).role, 'guest');
});
test('active user never inherits teacher role from token', async () => {
  assert.equal((await resolver({ user: { id: 2, status: 'active' } })({ userToken })).role, 'user');
});
test('invalid admin may fall back to active student, never elevated', async () => {
  assert.equal((await resolver({ user: { id: 2, status: 'active' } })({ adminToken, userToken })).role, 'user');
});
test('token type or ID mismatch cannot load privileged identity', async () => {
  const resolve = resolver({ admin: { id: 1, role: 'super_admin', status: 'active' } });
  assert.equal((await resolve({ adminToken: userToken })).role, 'guest');
  assert.equal((await resolve({ adminToken: JSON.stringify({ type: 'admin', adminId: '1 OR 1=1' }) })).role, 'guest');
});
test('database failure propagates instead of silently guessing permissions', async () => {
  await assert.rejects(() => resolver({ failDb: true })({ adminToken }), /db offline/);
});
test('middleware uses cookies only and disables shared response caching', async () => {
  const req = { cookies: { admin: adminToken }, body: { role: 'super_admin' } };
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, vary: (v) => { headers.Vary = v; } };
  let nextError;
  const middleware = createContentViewerMiddleware(resolver(), { adminCookieName: 'admin', userCookieName: 'user' });
  await middleware(req, res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(req.contentViewer.role, 'guest');
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers.Vary, 'Cookie');
});
