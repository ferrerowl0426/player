// 学员作业 today / history 接口（阶段一 B3）契约测试。
// 不连接真实数据库：用 fake pool 捕获 SQL 并验证「删除目标不丢行 / 当前显示 vs 历史快照 /
// 失效文案 / 最新批次定序」。SQL 语义在隔离 PostgreSQL 的验收列为未覆盖项。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_PASSWORD = new URL('./password-service.js', import.meta.url).href;
const SRC_USER_AUTH = new URL('./user-auth.routes.js', import.meta.url).href;

const state = {
  latestOpRows: [],
  assignmentRows: [],
  historyRows: [],
  queries: []
};
function resetState() {
  state.latestOpRows = [];
  state.assignmentRows = [];
  state.historyRows = [];
  state.queries = [];
}

const fakePool = {
  async query(sql, params) {
    state.queries.push({ sql, params });
    if (/GROUP BY operation_id[\s\S]*ORDER BY MAX\(created_at\) DESC, operation_id DESC/.test(sql)) {
      return { rows: state.latestOpRows, rowCount: state.latestOpRows.length };
    }
    if (/FROM user_assignments ua[\s\S]*ORDER BY ua\.created_at ASC, ua\.id ASC/.test(sql)) {
      return { rows: state.assignmentRows, rowCount: state.assignmentRows.length };
    }
    if (/WITH ops AS/.test(sql)) {
      return { rows: state.historyRows, rowCount: state.historyRows.length };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV;
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  // 仅为让模块可加载；本测试不触碰任何密码逻辑，也不读取该文件内容。
  mock.module(SRC_PASSWORD, {
    namedExports: {
      changeOwnPassword: async () => ({ ok: false, status: 400, message: '' }),
      changePasswordRateLimiter: { consume: async () => ({ ok: true }) },
      changePasswordRateLimitKey: () => 'test'
    }
  });
  mod = await import(SRC_USER_AUTH);
});
test.after(() => { mock.reset(); });

function extractHandler(router, path, method) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`handler ${method.toUpperCase()} ${path} not found`);
}
function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; }
  };
}
const req = () => ({ params: {}, user: { userId: 2 }, body: {} });

test('today：无未撤销批次返回空，不查作业行', async () => {
  resetState();
  const res = makeRes();
  await extractHandler(mod.userAuthRouter, '/assignments/today', 'get')(req(), res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.assignments, []);
  assert.equal(res.body.data.operationId, null);
});

test('today：保留全部行（含失效目标与 message），不因删除目标丢整行、不改排序', async () => {
  resetState();
  state.latestOpRows = [{ operation_id: 9001, created_at: new Date('2026-11-17T09:00:00Z') }];
  state.assignmentRows = [
    { id: 1, operation_id: 9001, object_type: 'video', target_status: 'available', title: '当前视频名', cover_url: '/c1', navigation_url: '/videos/11', part_no: null },
    { id: 2, operation_id: 9001, object_type: 'track_part', target_status: 'missing', title: '此资料已经被老师更改', cover_url: '', navigation_url: null, part_no: 3 },
    { id: 3, operation_id: 9001, object_type: 'video', target_status: 'private', title: '此资料已经被老师更改', cover_url: '', navigation_url: null },
    { id: 4, operation_id: 9001, object_type: 'message', target_status: 'available', title: '', message: '要求' }
  ];
  const res = makeRes();
  await extractHandler(mod.userAuthRouter, '/assignments/today', 'get')(req(), res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.assignments.length, 4, '删除/私密目标不再被过滤掉');
  assert.deepEqual(res.body.data.assignments.map((a) => a.id), [1, 2, 3, 4], '保持原排序，失效项不挪末尾');
  assert.equal(res.body.data.assignments[1].title, '此资料已经被老师更改');
  assert.equal(res.body.data.assignments[1].navigation_url, null);
  assert.equal(res.body.data.assignments[1].cover_url, '');

  const todaySql = state.queries.find((q) => /ORDER BY ua\.created_at ASC, ua\.id ASC/.test(q.sql)).sql;
  assert.match(todaySql, /AS target_status/, '状态由共享投影给出');
  assert.doesNotMatch(todaySql, /liveAssignmentFilter|AND \(COALESCE\(ua\.object_type[\s\S]*?= 'message'/, '不再用旧过滤表达式丢弃整行');
  assert.match(todaySql, /'此资料已经被老师更改'/, '统一失效文案');
  const latestSql = state.queries.find((q) => /GROUP BY operation_id/.test(q.sql)).sql;
  assert.match(latestSql, /ORDER BY MAX\(created_at\) DESC, operation_id DESC/, '最新批次确定性次序');
});

test('history：标题只读布置快照，不因 private 覆盖为失效提示，且不输出导航', async () => {
  resetState();
  state.historyRows = [{
    operation_id: 8001,
    created_at: new Date('2026-11-10T09:00:00Z'),
    items: [
      { id: 5, object_type: 'track_part', title: '布置时快照标题', target_private: true },
      { id: 6, object_type: 'video', title: '旧视频快照', target_private: false }
    ],
    practice_requirement: '',
    submit_requirement: '',
    teacher_name: '王老师'
  }];
  const res = makeRes();
  await extractHandler(mod.userAuthRouter, '/assignments/history', 'get')(req(), res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.operations[0].items[0].title, '布置时快照标题', '历史展示原快照');
  assert.equal(res.body.data.operations[0].items[1].title, '旧视频快照');

  const historySql = state.queries.find((q) => /WITH ops AS/.test(q.sql)).sql;
  assert.match(historySql, /ua\.assigned_object_title/, '历史投影使用快照列');
  assert.doesNotMatch(historySql, /此资料已经被老师更改|教学内容已调整/, '历史不套失效提示');
  assert.doesNotMatch(historySql, /navigation_url/, '历史不输出内容导航');
});
