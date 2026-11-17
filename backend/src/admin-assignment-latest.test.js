// GET /api/admin/users/:userId/assignments/latest（阶段一 B4）接口契约测试。
// 不连接真实数据库：用 fake pool 驱动路由，断言权限复用、SQL 下推筛选、
// 最新批次不回退、规范前端对象形状（P 父ID + partId）与安全脱敏边界。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_ADMIN = new URL('./admin.routes.js', import.meta.url).href;

const state = {
  latestRows: [],
  targetRows: [],
  queries: []
};

function resetState() {
  state.latestRows = [];
  state.targetRows = [];
  state.queries = [];
}

const fakePool = {
  async query(sql, params) {
    state.queries.push({ sql, params });
    if (/FROM users[\s\S]*WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], username: 'u1', nickname: 'U', class_id: 1, is_active: true, is_marked: false, created_at: new Date() }], rowCount: 1 };
    }
    if (/WITH latest_op AS/.test(sql)) {
      return { rows: state.latestRows, rowCount: state.latestRows.length };
    }
    if (/AS assignment_id[\s\S]*AS object_type/.test(sql)) {
      return { rows: state.targetRows, rowCount: state.targetRows.length };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV;
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import(SRC_ADMIN);
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
const handler = () => extractHandler(mod.adminRouter, '/users/:userId/assignments/latest', 'get');
const superReq = () => ({ params: { userId: '5' }, admin: { adminId: 1, role: 'super_admin' } });

test('路径先于旧列表路由注册，且复用教师/学员归属权限（无班级 -> 403）', async () => {
  resetState();
  const res = makeRes();
  const req = { params: { userId: '5' }, admin: { adminId: 9, role: 'teacher' } };
  await handler()(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  // 没有任何 latest / targets 查询被发出（权限在最近批次查询之前）
  assert.equal(state.queries.filter((q) => /WITH latest_op AS|AS assignment_id/.test(q.sql)).length, 0);
});

test('无最新未撤销批次：objects=[] 且要求为空，不发目标查询', async () => {
  resetState();
  state.latestRows = [];
  const res = makeRes();
  await handler()(superReq(), res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.objects, []);
  assert.equal(res.body.data.operationId, null);
  assert.equal(res.body.data.practiceRequirement, '');
  assert.equal(state.queries.filter((q) => /AS assignment_id/.test(q.sql)).length, 0, '空批次不应查目标');
});

test('最新批次全部失效：objects=[] 但保留该批次练习/提交要求，不回退旧批次', async () => {
  resetState();
  state.latestRows = [{
    operation_id: 7001,
    created_at: new Date('2026-11-17T10:00:00Z'),
    practice_requirement: '读第三章',
    submit_requirement: '写心得'
  }];
  state.targetRows = []; // SQL 已下推过滤，返回空
  const res = makeRes();
  await handler()(superReq(), res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.objects, []);
  assert.equal(res.body.data.operationId, 7001);
  assert.equal(res.body.data.practiceRequirement, '读第三章');
  assert.equal(res.body.data.submitRequirement, '写心得');
});

test('规范对象形状：P 的 objectId=父课程ID、partId=稳定P id，非P 无 partId', async () => {
  resetState();
  state.latestRows = [{
    operation_id: 7002,
    created_at: new Date('2026-11-17T11:00:00Z'),
    practice_requirement: '',
    submit_requirement: ''
  }];
  state.targetRows = [
    {
      assignment_id: 101,
      object_type: 'track_part',
      stable_object_id: 55,
      parent_id: 3,
      part_no: 3,
      current_title: '曲目A P3 自定义标题',
      current_cover: '/cover-a.png'
    },
    {
      assignment_id: 102,
      object_type: 'video',
      stable_object_id: 11,
      parent_id: null,
      part_no: null,
      current_title: '独立视频',
      current_cover: '/cover-v.png'
    }
  ];
  const res = makeRes();
  await handler()(superReq(), res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.objects.length, 2);
  const p = res.body.data.objects[0];
  assert.equal(p.objectType, 'track_part');
  assert.equal(p.objectId, 3, 'P 的 objectId 是父课程 ID');
  assert.equal(p.partId, 55, 'P 的 partId 是稳定 P ID');
  assert.equal(p.parentId, 3);
  assert.equal(p.stableObjectId, 55);
  assert.equal(p.partNo, 3);
  assert.equal(p.title, '曲目A P3 自定义标题');
  assert.equal(p.coverUrl, '/cover-a.png');
  const v = res.body.data.objects[1];
  assert.equal(v.objectId, 11);
  assert.equal(v.partId, null, '非 P 无 partId');
  assert.equal(v.partNo, null);
});

test('SQL 下推：最新批次按 created_at+operation_id 定序，排除 message，状态在 SQL 中过滤', async () => {
  resetState();
  state.latestRows = [{ operation_id: 7003, created_at: new Date(), practice_requirement: '', submit_requirement: '' }];
  const res = makeRes();
  await handler()(superReq(), res, (e) => { throw e; });

  const latestSql = state.queries.find((q) => /WITH latest_op AS/.test(q.sql)).sql;
  assert.match(latestSql, /ORDER BY MAX\(created_at\) DESC, operation_id DESC/, '确定性次序');
  assert.match(latestSql, /is_deleted = FALSE/, '只看未撤销');

  const targetSql = state.queries.find((q) => /AS assignment_id/.test(q.sql)).sql;
  assert.match(targetSql, /<> 'message'/, 'message 不是资源卡');
  assert.match(targetSql, /= 'available'/, '公开资格在 SQL 下推，不全表捞出后内存过滤');
  assert.match(targetSql, /COALESCE\(ua\.part_id, ua\.object_id\)/, 'P JOIN 兼容旧记录');
});
