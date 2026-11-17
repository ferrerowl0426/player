const test = require('node:test');
const assert = require('node:assert/strict');

let config;
let events;
let todayResponse;
let navDecision;
let navCalls;

global.Page = (c) => { config = c; };
global.wx = {
  showToast: (data) => events.push({ kind: 'toast', data }),
  stopPullDownRefresh: () => {},
  switchTab: () => {},
  pageScrollTo: () => {}
};

const authPath = require.resolve('../../services/auth');
const homeworkPath = require.resolve('../../services/homework');
const navigatePath = require.resolve('../../utils/navigate');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireLogin: () => ({ id: 1, nickname: '同学' }) } };
require.cache[homeworkPath] = { id: homeworkPath, filename: homeworkPath, loaded: true, exports: { getTodayHomework: async () => todayResponse } };
require.cache[navigatePath] = { id: navigatePath, filename: navigatePath, loaded: true, exports: {
  navigateByAssignment: async (item, options) => {
    navCalls.push({ item, options });
    if (navDecision && options && options.onUnavailable) {
      options.onUnavailable(item, { status: navDecision });
    }
  }
} };

require('./index');

function makePage() {
  const p = Object.create(config);
  p.data = JSON.parse(JSON.stringify(config.data));
  p.loadVersion = 0;
  p.active = false;
  p.setData = function (patch) { Object.assign(this.data, patch); };
  return p;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

const AVAILABLE = { id: 1, objectType: 'video', title: '当前视频名', coverUrl: '/c1', targetStatus: 'available', target: { type: 'video', id: '11' } };
const PRIVATE = { id: 2, objectType: 'track_part', title: '不应显示的旧名', coverUrl: '/c2', partNo: 4, targetStatus: 'private', target: null };
function today(items) {
  return { latestHomework: { operationId: 1, teacherName: '王老师', practiceRequirement: '练琴', assignments: items } };
}

test.beforeEach(() => {
  events = [];
  navCalls = [];
  navDecision = null;
  todayResponse = today([AVAILABLE, PRIVATE]);
});

test('onShow 加载：可用项显示当前标题，失效项显示精确灰框标题且不可点', async () => {
  const p = makePage();
  p.onLoad();
  p.onShow();
  await flush();
  assert.equal(p.data.homework.assignments[0].title, '当前视频名');
  assert.equal(p.data.homework.assignments[0].unavailable, false);
  assert.equal(p.data.homework.assignments[1].title, '此资料已经被老师更改');
  assert.equal(p.data.homework.assignments[1].coverUrl, '');
  assert.equal(p.data.homework.assignments[1].partLabel, '');
  assert.equal(p.data.homework.assignments[1].unavailable, true);
});

test('已知失效项点击：不调用导航复核、不跳转', () => {
  const p = makePage();
  p.active = true;
  p.data.homework = require('../../utils/format').normalizeHomeworkGroup(todayResponse);
  const disabled = p.data.homework.assignments.find((a) => a.unavailable);
  p.openAssignment({ currentTarget: { dataset: { item: disabled } } });
  assert.equal(navCalls.length, 0);
});

test('可用项点击：按作业 id 调用导航复核并传 isCurrent', () => {
  const p = makePage();
  p.active = true;
  p.data.homework = require('../../utils/format').normalizeHomeworkGroup(todayResponse);
  p.openAssignment({ currentTarget: { dataset: { item: p.data.homework.assignments[0] } } });
  assert.equal(navCalls.length, 1);
  assert.equal(navCalls[0].item.id, 1);
  assert.equal(typeof navCalls[0].options.onUnavailable, 'function');
  assert.equal(typeof navCalls[0].options.isCurrent, 'function');
  assert.equal(navCalls[0].options.isCurrent(), true, '页面活跃且版本一致应为 current');
});

test('isCurrent 随 active / loadVersion 变化：隐藏或刷新后旧导航被判过期', () => {
  const p = makePage();
  p.active = true;
  p.data.homework = require('../../utils/format').normalizeHomeworkGroup(todayResponse);
  p.openAssignment({ currentTarget: { dataset: { item: p.data.homework.assignments[0] } } });
  const isCurrent = navCalls[0].options.isCurrent;
  assert.equal(isCurrent(), true);
  p.onHide(); // active=false 且 loadVersion+1
  assert.equal(isCurrent(), false, '页面隐藏后应判过期');
  p.active = true;
  assert.equal(isCurrent(), false, 'loadVersion 已递增，仅恢复 active 仍应判过期');
});

test('竞态失效：复核返回 private 后原位更新灰框，静默无 Toast', async () => {
  navDecision = 'private';
  const p = makePage();
  p.active = true;
  p.data.homework = require('../../utils/format').normalizeHomeworkGroup(todayResponse);
  p.openAssignment({ currentTarget: { dataset: { item: p.data.homework.assignments[0] } } });
  await flush();
  assert.deepEqual(events, [], '竞态失效不弹 Toast');
  assert.equal(p.data.homework.assignments[0].title, '此资料已经被老师更改');
  assert.equal(p.data.homework.assignments[0].unavailable, true);
  assert.equal(p.data.homework.assignments[0].target, null);
});

test('过期响应保护：onHide 后返回的旧结果不回写首页', async () => {
  const p = makePage();
  p.onLoad();
  const pending = p.loadHomework(); // version 1
  p.onHide(); // active=false, version 2
  await pending;
  assert.equal(p.data.homework.assignments.length, 0, '过期响应不得回写');
  assert.equal(p.active, false);
});

test('过期回调保护：切走页面后失效回调不改写卡片', () => {
  const p = makePage();
  p.active = true;
  p.data.homework = require('../../utils/format').normalizeHomeworkGroup(todayResponse);
  p.openAssignment({ currentTarget: { dataset: { item: p.data.homework.assignments[0] } } });
  const cb = navCalls[0].options.onUnavailable;
  p.onHide();
  cb(p.data.homework.assignments[0], { status: 'private' });
  assert.equal(p.data.homework.assignments[0].title, '当前视频名', '离页后不得回写失效态');
});
