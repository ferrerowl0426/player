const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/index.js', 'utf8');
function setup(changePassword = async () => ({})) {
  let config, timer, cleared = 0, redirected = 0;
  vm.runInNewContext(source, {
    require: () => ({ requireLogin: () => ({ status: 'active' }), logout: async () => {}, changePassword, clearSession: () => cleared++ }),
    Page: (value) => { config = value; },
    wx: { reLaunch: () => redirected++ },
    setTimeout: (fn, ms) => { assert.equal(ms, 1000); timer = fn; return 1; }, clearTimeout: () => {}
  });
  const page = { ...config, data: { ...config.data }, setData(value) { Object.assign(this.data, value); } };
  return { page, tick: () => timer(), counts: () => ({ cleared, redirected }) };
}
test('cancel clears secrets and eye toggles are independent', () => {
  const { page } = setup(); page.openPasswordForm();
  page.inputOldPassword({ detail: { value: 'old' } }); page.toggleOldPassword();
  assert.equal(page.data.showOld, true); assert.equal(page.data.showNew, false);
  page.closePasswordForm(); assert.equal(page.data.oldPassword, ''); assert.equal(page.data.showOld, false);
});
test('continuous password input only updates values without changing focus or remounting form', () => {
  const { page } = setup();
  page.openPasswordForm();
  const patches = [];
  const originalSetData = page.setData;
  page.setData = function (patch) { patches.push(patch); originalSetData.call(this, patch); };
  for (const value of ['a', 'ab', 'abc', 'abcd']) {
    page.inputOldPassword({ detail: { value } });
    assert.equal(page.data.oldFocus, true);
    assert.equal(page.data.showPasswordForm, true);
    assert.deepEqual(Object.keys(patches.at(-1)), ['oldPassword']);
  }
  for (const value of ['n', 'ne', 'new']) {
    page.inputNewPassword({ detail: { value } });
    assert.deepEqual(Object.keys(patches.at(-1)), ['newPassword']);
  }
  assert.equal(page.data.oldPassword, 'abcd');
  assert.equal(page.data.newPassword, 'new');
});

test('old password error keeps login and new password', async () => {
  const env = setup(async () => { throw Object.assign(new Error(), { code: 'OLD_PASSWORD_INCORRECT', statusCode: 400 }); });
  env.page.setData({ oldPassword: 'wrong', newPassword: 'newpass' }); await env.page.submitPassword();
  assert.equal(env.page.data.oldPassword, ''); assert.equal(env.page.data.newPassword, 'newpass');
  assert.equal(env.page.data.oldFocus, true); assert.equal(env.counts().cleared, 0);
});
test('success clears secrets then logs out after one second', async () => {
  const env = setup(); env.page.setData({ oldPassword: 'oldpass', newPassword: 'newpass' });
  await env.page.submitPassword(); assert.equal(env.page.data.passwordSuccess, true);
  assert.equal(env.page.data.newPassword, ''); assert.equal(env.counts().redirected, 0);
  env.tick(); assert.equal(env.counts().cleared, 1); assert.equal(env.counts().redirected, 1);
});
test('pending submission cannot close or duplicate', async () => {
  let resolve, calls = 0;
  const env = setup(() => { calls++; return new Promise((done) => { resolve = done; }); });
  env.page.openPasswordForm(); env.page.setData({ oldPassword: 'oldpass', newPassword: 'newpass' });
  const pending = env.page.submitPassword(); env.page.closePasswordForm(); await env.page.submitPassword();
  assert.equal(env.page.data.showPasswordForm, true); assert.equal(calls, 1); resolve(); await pending;
});
test('hidden page still revokes local session after successful response', async () => {
  let resolve; const env = setup(() => new Promise((done) => { resolve = done; }));
  env.page.setData({ oldPassword: 'oldpass', newPassword: 'newpass' });
  const pending = env.page.submitPassword(); env.page.onHide(); resolve(); await pending;
  assert.equal(env.counts().cleared, 1); assert.equal(env.counts().redirected, 1);
});
