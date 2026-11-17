// miniprogram.services.js 的 today/history 作业序列化契约测试（阶段三 M1/M4）。
// 不连真实数据库：serializeAssignment 直接断言；getTodayHomework/getHomeworkHistory 用 fake pool
// 捕获 SQL，验证「先选最新批次再取整批行 / message 不当资源 / 失效灰框保留 / 历史快照不输出导航」。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignmentNavigationTarget } from './assignment-navigation.js';
import { UNAVAILABLE_TITLE } from './assignment-targets.js';

const SRC_DB = new URL('./db.js', import.meta.url).href;

const state = {
  latestOpRows: [],
  opRows: [],
  todayRows: [],
  historyRows: [],
  total: 0,
  queries: []
};
function reset() {
  state.latestOpRows = [];
  state.opRows = [];
  state.todayRows = [];
  state.historyRows = [];
  state.total = 0;
  state.queries = [];
}
const fakePool = {
  async query(sql, params) {
    state.queries.push({ sql, params });
    if (/COUNT\(DISTINCT operation_id\)/.test(sql)) return { rows: [{ total: state.total }], rowCount: 1 };
    if (/GROUP BY operation_id[\s\S]*ORDER BY MAX\(created_at\) DESC, operation_id DESC/.test(sql)) {
      return { rows: state.latestOpRows, rowCount: state.latestOpRows.length };
    }
    if (/GROUP BY operation_id[\s\S]*LIMIT \$2 OFFSET \$3/.test(sql)) {
      return { rows: state.opRows, rowCount: state.opRows.length };
    }
    if (/ANY\(\$2::int\[\]\)/.test(sql)) return { rows: state.historyRows, rowCount: state.historyRows.length };
    if (/AS navigation_url/.test(sql)) return { rows: state.todayRows, rowCount: state.todayRows.length };
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./miniprogram.services.js');
});
test.after(() => { mock.reset(); });
test.beforeEach(reset);

function row(overrides = {}) {
  return {
    id: 1,
    object_type: 'video',
    object_id: 10,
    video_id: 10,
    part_id: null,
    title: '当前视频名',
    cover_url: 'https://cdn.example.com/c.jpg',
    teacher_name: '王老师',
    created_at: '2026-11-17T09:00:00Z',
    is_deleted: false,
    delete_reason: '',
    practice_requirement: '练琴',
    submit_requirement: '上传视频',
    target_status: 'available',
    target_private: false,
    normalized_object_id: 10,
    parent_id: null,
    part_no: null,
    ...overrides
  };
}

// ---------- serializeAssignment：today 实时 / 失效 / history 快照 ----------

test('today 可用：下发当前标题/封面/稳定 target 与状态', () => {
  const s = mod.serializeAssignment(row(), 'today');
  assert.equal(s.title, '当前视频名');
  assert.equal(s.coverUrl, 'https://cdn.example.com/c.jpg');
  assert.equal(s.targetStatus, 'available');
  assert.equal(s.targetPrivate, false);
  assert.equal(s.unavailable, undefined); // 后端不下发 UI 字段，由前端格式化层生成
  assert.deepEqual(s.target, { type: 'video', id: '10', partId: '', page: 'video-detail' });
});

test('today private：精确失效标题、空封面、target=null', () => {
  const s = mod.serializeAssignment(row({ target_status: 'private', target_private: true }), 'today');
  assert.equal(s.title, UNAVAILABLE_TITLE);
  assert.equal(UNAVAILABLE_TITLE, '此资料已经被老师更改');
  assert.equal(s.coverUrl, '');
  assert.equal(s.targetStatus, 'private');
  assert.equal(s.target, null);
});

test('today missing：目标删除仍保留灰框，不误报 private', () => {
  const s = mod.serializeAssignment(row({ target_status: 'missing', target_private: true, is_deleted: false }), 'today');
  assert.equal(s.title, UNAVAILABLE_TITLE);
  assert.equal(s.coverUrl, '');
  assert.equal(s.targetStatus, 'missing');
  assert.equal(s.target, null);
});

test('today 分P可用：课程段取父ID、part 段取稳定P id', () => {
  const s = mod.serializeAssignment(row({
    object_type: 'track_part',
    object_id: 5,
    part_id: 5,
    normalized_object_id: 5,
    parent_id: 3,
    part_no: 3,
    title: '父课程 P3 标题'
  }), 'today');
  assert.equal(s.targetStatus, 'available');
  assert.equal(s.partNo, 3);
  assert.deepEqual(s.target, buildAssignmentNavigationTarget('track_part', 5, 5, 3));
  assert.deepEqual(s.target, { type: 'track_part', id: '3', partId: '5', page: 'track-detail' });
});

test('history 快照：private 也不套失效标题、无封面、无 target', () => {
  const s = mod.serializeAssignment(row({ title: '布置时快照标题', target_status: 'private', target_private: true }), 'history');
  assert.equal(s.title, '布置时快照标题');
  assert.notEqual(s.title, UNAVAILABLE_TITLE);
  assert.equal(s.coverUrl, '');
  assert.equal(s.target, null);
});

// ---------- getTodayHomework：批次/投影/message/恢复公开 ----------

test('today：先选最新有效批次，再取整批全部行（无 LIMIT20 猜批次）', async () => {
  state.latestOpRows = [{ operation_id: 9001, created_at: '2026-11-17T09:00:00Z' }];
  state.todayRows = [
    row({ id: 1, target_status: 'available', title: '当前视频名' }),
    row({ id: 2, object_type: 'track_part', target_status: 'private', title: UNAVAILABLE_TITLE }),
    row({ id: 3, object_type: 'message', target_status: 'available', message: '只要求', practice_requirement: '练琴' })
  ];
  const result = await mod.getTodayHomework({ id: 2 });
  assert.equal(result.latestHomework.operationId, '9001');
  // message 不算资源卡、不占 5 项额度；private 灰框保留。
  assert.deepEqual(result.latestHomework.items.map((i) => i.id), ['1', '2']);
  assert.equal(result.latestHomework.items[1].title, UNAVAILABLE_TITLE);
  assert.equal(result.latestHomework.practiceRequirement, '练琴');

  const latestSql = state.queries.find((q) => /GROUP BY operation_id/.test(q.sql)).sql;
  assert.match(latestSql, /ORDER BY MAX\(created_at\) DESC, operation_id DESC/);
  assert.match(latestSql, /is_deleted = FALSE/);
  const rowsSql = state.queries.find((q) => /AS navigation_url/.test(q.sql)).sql;
  assert.match(rowsSql, /ua\.operation_id = \$2/);
  assert.match(rowsSql, /AS target_status/, '状态由共享投影给出');
  assert.match(rowsSql, /parent_id/, '共享投影含实时父ID');
  assert.match(rowsSql, /COALESCE\(ua\.part_id, ua\.object_id\)/, 'P 稳定ID兼容旧记录 part_id 为空');
  assert.doesNotMatch(rowsSql, /LIMIT 20/, '不再用 LIMIT20 猜批次');
});

test('today：message 行不在首位时，其 message 仍作为练习要求独立保留', async () => {
  state.latestOpRows = [{ operation_id: 9004, created_at: '2026-11-17T09:00:00Z' }];
  state.todayRows = [
    row({ id: 1, practice_requirement: '', submit_requirement: '' }),
    row({ id: 2, object_type: 'message', practice_requirement: '', message: '仅此要求' })
  ];
  const result = await mod.getTodayHomework({ id: 2 });
  assert.equal(result.latestHomework.practiceRequirement, '仅此要求');
  assert.deepEqual(result.latestHomework.items.map((i) => i.id), ['1'], 'message 不当资源卡');
});

test('today：最新批次全部失效仍保留全部灰框', async () => {
  state.latestOpRows = [{ operation_id: 9002, created_at: '2026-11-17T09:00:00Z' }];
  state.todayRows = [
    row({ id: 11, target_status: 'private' }),
    row({ id: 12, target_status: 'missing' })
  ];
  const result = await mod.getTodayHomework({ id: 2 });
  assert.equal(result.latestHomework.items.length, 2);
  assert.deepEqual(result.latestHomework.items.map((i) => i.targetStatus), ['private', 'missing']);
  assert.ok(result.latestHomework.items.every((i) => i.target === null));
});

test('today：目标由私密恢复公开后再次查询返回真实 target', async () => {
  state.latestOpRows = [{ operation_id: 9003, created_at: '2026-11-17T09:00:00Z' }];
  state.todayRows = [row({ id: 21, target_status: 'private', target_private: true })];
  let result = await mod.getTodayHomework({ id: 2 });
  assert.equal(result.latestHomework.items[0].target, null);

  reset();
  state.latestOpRows = [{ operation_id: 9003, created_at: '2026-11-17T09:00:00Z' }];
  state.todayRows = [row({ id: 21, target_status: 'available', target_private: false })];
  result = await mod.getTodayHomework({ id: 2 });
  assert.equal(result.latestHomework.items[0].title, '当前视频名');
  assert.deepEqual(result.latestHomework.items[0].target, { type: 'video', id: '10', partId: '', page: 'video-detail' });
});

// ---------- getHomeworkHistory：快照投影 ----------

test('history：标题取布置快照、不输出导航，message 不当资源', async () => {
  state.total = 2;
  state.opRows = [
    { operation_id: 8001, created_at: '2026-11-10T09:00:00Z' },
    { operation_id: 8002, created_at: '2026-11-09T09:00:00Z' }
  ];
  state.historyRows = [
    row({ id: 31, operation_id: 8001, title: '旧快照标题', target_status: 'private', target_private: true }),
    row({ id: 32, operation_id: 8001, object_type: 'message', title: '应为要求' }),
    row({ id: 33, operation_id: 8002, title: '另一快照', target_status: 'available' })
  ];
  const result = await mod.getHomeworkHistory({ id: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.pagination.total, 2);
  assert.equal(result.items[0].items[0].title, '旧快照标题');
  assert.notEqual(result.items[0].items[0].title, UNAVAILABLE_TITLE);
  assert.equal(result.items[0].items[0].target, null);
  assert.deepEqual(result.items[0].items.map((i) => i.id), ['31'], 'message 不渲染为资源卡');

  const historySql = state.queries.find((q) => /ANY\(\$2::int\[\]\)/.test(q.sql)).sql;
  assert.match(historySql, /assigned_object_title/, '历史投影用快照列');
  assert.doesNotMatch(historySql, /AS navigation_url/, '历史不输出导航地址');
  assert.doesNotMatch(historySql, /此资料已经被老师更改/, '历史不套失效文案');
});
