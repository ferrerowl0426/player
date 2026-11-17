const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNAVAILABLE_TITLE,
  isTargetUnavailable,
  toUnavailableAssignment,
  normalizeAssignment,
  normalizeHomeworkGroup,
  normalizeHomeworkHistory
} = require('./format');

const base = {
  id: '7',
  objectType: 'track_part',
  title: '当前父课程 P3 标题',
  coverUrl: 'https://cdn.example.com/c.jpg',
  partNo: 3,
  targetStatus: 'available',
  target: { type: 'track_part', id: '5', partId: '9' }
};

test('可用项：显示当前标题/封面/P序号且可点击', () => {
  const a = normalizeAssignment(base);
  assert.equal(a.title, '当前父课程 P3 标题');
  assert.equal(a.coverUrl, 'https://cdn.example.com/c.jpg');
  assert.equal(a.partLabel, 'P03');
  assert.equal(a.unavailable, false);
  assert.ok(a.materialAction.includes('进入详情'));
  assert.ok(a.target);
});

test('private 失效：精确标题、空封面、无 P 标签/进入详情、无 target', () => {
  const a = normalizeAssignment({ ...base, targetStatus: 'private' });
  assert.equal(a.title, UNAVAILABLE_TITLE);
  assert.equal(UNAVAILABLE_TITLE, '此资料已经被老师更改');
  assert.equal(a.coverUrl, '');
  assert.equal(a.partLabel, '');
  assert.equal(a.materialMeta, '');
  assert.equal(a.materialAction, '');
  assert.equal(a.unavailable, true);
  assert.equal(a.target, null);
  // 不把旧 assignedObjectTitle 兜回失效首页
  assert.notEqual(a.title, '旧标题');
});

test('missing 失效：同样灰框，不泄露旧标题', () => {
  const a = normalizeAssignment({ ...base, targetStatus: 'missing', assignedObjectTitle: '旧标题' });
  assert.equal(a.title, UNAVAILABLE_TITLE);
  assert.equal(a.unavailable, true);
  assert.equal(a.target, null);
});

test('兼容旧 target_private：无 target_status 仍判失效', () => {
  assert.equal(isTargetUnavailable({ target_private: true }), true);
  assert.equal(isTargetUnavailable({ target: { status: 'missing' } }), true);
  assert.equal(isTargetUnavailable({ target_status: 'available' }), false);
});

test('历史快照模式：private 也不改写布置时标题', () => {
  const a = normalizeAssignment({ ...base, targetStatus: 'private', title: '布置时快照' }, { snapshot: true });
  assert.equal(a.title, '布置时快照');
  assert.notEqual(a.title, UNAVAILABLE_TITLE);
});

test('toUnavailableAssignment：竞态失效原位改写为灰框', () => {
  const a = toUnavailableAssignment(base);
  assert.equal(a.title, UNAVAILABLE_TITLE);
  assert.equal(a.coverUrl, '');
  assert.equal(a.partLabel, '');
  assert.equal(a.targetStatus, 'private');
  assert.equal(a.target, null);
  assert.equal(a.id, '7');
});

test('normalizeHomeworkGroup：message 不当资源卡，失效项保留灰框', () => {
  const group = normalizeHomeworkGroup({
    latestHomework: {
      operationId: 1,
      teacherName: '王老师',
      practiceRequirement: '练琴',
      assignments: [
        { id: 1, objectType: 'video', title: '视频', targetStatus: 'available' },
        { id: 2, objectType: 'message', message: '仅要求', targetStatus: 'available' },
        { id: 3, objectType: 'track_part', title: '失效', targetStatus: 'private' }
      ]
    }
  });
  assert.deepEqual(group.assignments.map((a) => a.id), [1, 3]);
  assert.equal(group.assignments[1].title, UNAVAILABLE_TITLE);
  assert.equal(group.practiceRequirement, '练琴');
});

test('normalizeHomeworkHistory：历史只读快照，不套失效文案', () => {
  const history = normalizeHomeworkHistory({
    items: [{
      operation_id: 9,
      created_at: '2026-11-10T09:00:00Z',
      assignments: [
        { id: 1, object_type: 'track_part', title: '旧快照标题', target_status: 'private' }
      ]
    }]
  });
  assert.equal(history[0].assignments[0].title, '旧快照标题');
  assert.notEqual(history[0].assignments[0].title, UNAVAILABLE_TITLE);
});
