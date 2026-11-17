import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNAVAILABLE_TITLE,
  TARGET_STATUS,
  assignmentDisplayCover,
  assignmentDisplayTitle,
  buildSelectionFromLatest,
  isAssignmentClickable,
  isNavigationUnavailable,
  isResponseCurrent,
  isTargetUnavailable,
  latestObjectToSelected,
  latestRequirements,
  mergeContentOptionsWithSelection,
  stableObjectKey
} from './assignmentViewLogic.js';

test('available 目标展示当前标题/封面且可点击', () => {
  const item = { target_status: TARGET_STATUS.AVAILABLE, title: '当前曲名', cover_url: '/cover/a.jpg' };
  assert.equal(isTargetUnavailable(item), false);
  assert.equal(assignmentDisplayTitle(item), '当前曲名');
  assert.equal(assignmentDisplayCover(item), '/cover/a.jpg');
  assert.equal(isAssignmentClickable(item), true);
});

test('private 目标强制精确文案与空封面，即使携带旧快照名称/封面也不泄露', () => {
  const item = {
    target_status: TARGET_STATUS.PRIVATE,
    title: '私密资料旧名',
    cover_url: '/cover/secret.jpg',
    navigation_url: '/tracks/9',
    target_private: true
  };
  assert.equal(isTargetUnavailable(item), true);
  assert.equal(assignmentDisplayTitle(item), UNAVAILABLE_TITLE);
  assert.equal(assignmentDisplayCover(item), '');
  assert.equal(isAssignmentClickable(item), false);
});

test('missing 目标与 private 同样灰框，不使用旧名称', () => {
  const item = { target_status: TARGET_STATUS.MISSING, title: '已删除的旧名', cover_url: '/cover/gone.jpg' };
  assert.equal(assignmentDisplayTitle(item), UNAVAILABLE_TITLE);
  assert.equal(assignmentDisplayCover(item), '');
  assert.equal(isAssignmentClickable(item), false);
});

test('旧数据仅 target_private 标记或未知状态按不可用处理', () => {
  assert.equal(isTargetUnavailable({ target_private: true }), true);
  assert.equal(isTargetUnavailable({ target_status: 'weird', title: 'x' }), true);
  assert.equal(assignmentDisplayTitle({ target_status: 'weird', title: 'x' }), UNAVAILABLE_TITLE);
  assert.equal(isTargetUnavailable({}), true);
});

test('可用状态显式优先于遗留 target_private，不误灰框', () => {
  const item = { target_status: TARGET_STATUS.AVAILABLE, target_private: true, title: '公开了', cover_url: '/c.jpg' };
  assert.equal(isTargetUnavailable(item), false);
  assert.equal(assignmentDisplayTitle(item), '公开了');
});

test('点击复核只有 available 可导航，private/missing/未知一律静默不可用', () => {
  assert.equal(isNavigationUnavailable(TARGET_STATUS.AVAILABLE), false);
  assert.equal(isNavigationUnavailable(TARGET_STATUS.PRIVATE), true);
  assert.equal(isNavigationUnavailable(TARGET_STATUS.MISSING), true);
  assert.equal(isNavigationUnavailable('future_status'), true);
});

test('稳定 ID key：P 用真实 partId，不用标题或 part_no', () => {
  const a = { objectType: 'track_part', objectId: 100, partId: 7, title: '旧名', partNo: 2 };
  const b = { objectType: 'track_part', objectId: 100, partId: 7, title: '改了名', partNo: 3 };
  const c = { objectType: 'track_part', objectId: 100, partId: 8, title: '同名', partNo: 2 };
  assert.equal(stableObjectKey(a), stableObjectKey(b));
  assert.notEqual(stableObjectKey(a), stableObjectKey(c));
  // part_no 从 2 调到 3 不改变身份。
  assert.equal(stableObjectKey(a), 'track_part:7:7');
});

test('稳定 ID key：非 P 用 objectId，partNo 不参与', () => {
  const lesson = { objectType: 'track_point', objectId: 42, partId: null, title: '单课' };
  assert.equal(stableObjectKey(lesson), 'track_point:42:0');
});

test('回填同名不同 ID 不误合并，各自保留', () => {
  const objects = [
    { objectType: 'track_part', objectId: 100, partId: 7, partNo: 2, title: '同名', coverUrl: '' },
    { objectType: 'track_part', objectId: 100, partId: 8, partNo: 3, title: '同名', coverUrl: '' }
  ];
  const selected = buildSelectionFromLatest(objects, 5);
  assert.equal(selected.length, 2);
  assert.notEqual(stableObjectKey(selected[0]), stableObjectKey(selected[1]));
});

test('回填 P 用父课程 objectId + 稳定 partId，P 序号进入 meta', () => {
  const selected = latestObjectToSelected({
    objectType: 'knowledge_part',
    objectId: 200,
    partId: 55,
    parentId: 200,
    partNo: 3,
    title: '知识点-P3',
    coverUrl: '/c.jpg'
  });
  assert.equal(selected.kind, 'part');
  assert.equal(selected.objectId, 200);
  assert.equal(selected.partId, 55);
  assert.equal(stableObjectKey(selected), 'knowledge_part:55:55');
  assert.match(selected.meta, /3/);
  assert.equal(selected.title, '知识点-P3');
});

test('回填按稳定 ID 去重并受最多数量限制', () => {
  const objects = [
    { objectType: 'track_point', objectId: 1, title: 'A' },
    { objectType: 'track_point', objectId: 1, title: 'A 改名' },
    { objectType: 'track_point', objectId: 2, title: 'B' },
    { objectType: 'track_point', objectId: 3, title: 'C' }
  ];
  const selected = buildSelectionFromLatest(objects, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].title, 'A'); // 同名 ID 保留后端当前名，不用旧候选
  assert.equal(selected[1].objectId, 2);
});

test('最新批次目标全部失效时 objects 为空仍保留练习/提交要求', () => {
  assert.deepEqual(buildSelectionFromLatest([], 5), []);
  assert.deepEqual(latestRequirements({ objects: [], practiceRequirement: '练琴', submitRequirement: '录音' }), {
    practiceRequirement: '练琴',
    submitRequirement: '录音'
  });
  assert.deepEqual(latestRequirements({ practiceRequirement: '', submitRequirement: '' }), {
    practiceRequirement: '',
    submitRequirement: ''
  });
});

test('回填按 ID 补入候选：同 ID 用回填当前名刷新，不同 ID 同名不覆盖', () => {
  const options = [
    { objectType: 'track_point', objectId: 1, title: '旧名', meta: '旧 meta' },
    { objectType: 'track_point', objectId: 9, title: '同名', meta: '另一个' }
  ];
  const selected = [
    { objectType: 'track_point', objectId: 1, title: '当前名', meta: '新 meta' },
    { objectType: 'track_part', objectId: 2, partId: 5, title: '新P', meta: 'P' }
  ];
  const merged = mergeContentOptionsWithSelection(options, selected);
  const byKey = new Map(merged.map((o) => [stableObjectKey(o), o]));
  assert.equal(byKey.get('track_point:1:0').title, '当前名');
  assert.equal(byKey.get('track_point:9:0').title, '同名'); // 同名不同 ID 未被覆盖
  assert.equal(byKey.get('track_part:5:5').title, '新P'); // 新对象按 ID 补入
});

test('乱序与切学员保护：版本不一致或学员不一致都判为过期', () => {
  assert.equal(isResponseCurrent({ requestVersion: 2, currentVersion: 2, requestedUserId: 10, currentUserId: 10 }), true);
  assert.equal(isResponseCurrent({ requestVersion: 1, currentVersion: 2, requestedUserId: 10, currentUserId: 10 }), false);
  assert.equal(isResponseCurrent({ requestVersion: 2, currentVersion: 2, requestedUserId: 10, currentUserId: 11 }), false);
  assert.equal(isResponseCurrent({ requestVersion: 1, currentVersion: 3, requestedUserId: 10, currentUserId: 11 }), false);
  // 学生主页不传 userId 时仅按版本判定
  assert.equal(isResponseCurrent({ requestVersion: 3, currentVersion: 3 }), true);
});
