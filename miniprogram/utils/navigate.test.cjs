const test = require('node:test');
const assert = require('node:assert/strict');
let response;
let failure;
let events;
let requestCalls;
const requestPath = require.resolve('../services/request');
require.cache[requestPath] = { id: requestPath, filename: requestPath, loaded: true, exports: {
  request: async () => { requestCalls += 1; if (failure) throw failure; return response; }
} };
const { navigateByAssignment, buildUrl, isAssignmentUnavailable } = require('./navigate');
test.beforeEach(() => {
  failure = null;
  response = null;
  events = [];
  requestCalls = 0;
  global.wx = { showToast: (data) => events.push({ kind: 'toast', data }), navigateTo: (data) => events.push({ kind: 'navigate', data }) };
});

test('buildUrl 声明存在且过滤空参数', () => {
  assert.equal(buildUrl('/pages/x', { id: 3, part: '', q: 'a b' }), '/pages/x?id=3&q=a%20b');
  assert.equal(buildUrl('/pages/x', {}), '/pages/x');
});

test('private 复核：静默失效、回调更新灰框、不 Toast 不跳转、不读旧 target', async () => {
  response = { status: 'private' };
  let unavailable;
  await navigateByAssignment({ id: 88, target: { type: 'track_point', id: 999 } }, { onUnavailable: (a, s) => { unavailable = { a, s }; } });
  assert.deepEqual(events, [], 'private 不弹 Toast、不导航');
  assert.equal(unavailable.s.status, 'private');
  assert.equal(unavailable.a.id, 88);
});

test('missing 复核：静默失效、不伪装 private、不 Toast', async () => {
  response = { status: 'missing' };
  let status;
  await navigateByAssignment({ id: 88 }, { onUnavailable: (a, s) => { status = s.status; } });
  assert.deepEqual(events, []);
  assert.equal(status, 'missing');
});

test('available 复核：用复核下发的目标跳转，旧 target 不再参与', async () => {
  response = { status: 'available', target: { type: 'track_part', id: 3, partId: 7 } };
  await navigateByAssignment({ id: 88, objectId: 999, targetPrivate: true, target: { type: 'video', id: 1 } });
  assert.deepEqual(events, [{ kind: 'navigate', data: { url: '/pages/track-detail/index?id=3&part=7' } }]);
});

test('available 但无 target：视为失效静默返回', async () => {
  response = { status: 'available' };
  await navigateByAssignment({ id: 88 });
  assert.deepEqual(events, []);
});

test('普通网络错误仍 Toast，不静默吞掉', async () => {
  failure = new Error('网络错误');
  await navigateByAssignment({ id: 88 });
  assert.equal(events[0].kind, 'toast');
  assert.equal(events[0].data.title, '网络错误');
});

test('无 id：静默 missing 失效、不发起复核、不回退旧 target 导航', async () => {
  let status;
  await navigateByAssignment(
    { objectType: 'track_part', target: { type: 'track_part', id: 999, partId: 3 } },
    { onUnavailable: (a, s) => { status = s.status; } }
  );
  assert.equal(requestCalls, 0, '无 id 不得发起复核请求');
  assert.deepEqual(events, [], '无 id 不得导航也不得 Toast');
  assert.equal(status, 'missing');
  assert.equal(isAssignmentUnavailable({ target_private: true }), true);
  assert.equal(isAssignmentUnavailable({ target_status: 'available' }), false);
});

test('无 id 且带已知 private 标记：仍静默 missing、不旁路导航', async () => {
  let status;
  await navigateByAssignment(
    { targetPrivate: true, target: { type: 'video', id: 10 } },
    { onUnavailable: (a, s) => { status = s.status; } }
  );
  assert.equal(requestCalls, 0);
  assert.deepEqual(events, [], '不得用旧 target 导航');
  assert.equal(status, 'missing');
});

test('复核下发 target.partId 优先于旧 assignment.partId', async () => {
  response = { status: 'available', target: { type: 'track_part', id: 3, partId: 7, part_id: 71 } };
  await navigateByAssignment({ id: 88, partId: 999, part_id: 998, target: { type: 'video', id: 1 } });
  assert.deepEqual(events, [{ kind: 'navigate', data: { url: '/pages/track-detail/index?id=3&part=7' } }]);
});

test('isCurrent 过期：await 复核完成后页面不活跃则静默丢弃，不导航不回写', async () => {
  response = { status: 'available', target: { type: 'track_part', id: 3 } };
  let unavailableCalled = false;
  await navigateByAssignment({ id: 88 }, { isCurrent: () => false, onUnavailable: () => { unavailableCalled = true; } });
  assert.deepEqual(events, [], '过期响应不得导航');
  assert.equal(unavailableCalled, false, '过期响应不得回写失效态');
});

test('isCurrent 过期：普通网络错误也不再 Toast', async () => {
  failure = new Error('网络错误');
  await navigateByAssignment({ id: 88 }, { isCurrent: () => false });
  assert.deepEqual(events, [], '过期错误不得 Toast');
});

test('isCurrent 未过期：复核通过后正常导航不受影响', async () => {
  response = { status: 'available', target: { type: 'track_point', id: 5 } };
  let called = 0;
  await navigateByAssignment({ id: 88 }, { isCurrent: () => { called += 1; return true; } });
  assert.ok(called > 0, 'isCurrent 应被调用');
  assert.deepEqual(events, [{ kind: 'navigate', data: { url: '/pages/track-detail/index?id=5' } }]);
});
