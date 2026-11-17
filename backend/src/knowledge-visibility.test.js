// 针对 knowledge.routes.js 的可见性逻辑测试：列表/合集查询构造 + 知识点编辑事务内的
// 派生可见性刷新、私密写入开关与前置引用冲突（409 回滚）；以及阶段B的：
//   - 所有课程/P/合集写入口在 BEGIN 后首条调用共享锁 lockVisibilityFamilies(client, ['knowledge'])
//   - 合集创建/编辑/成员替换在 COMMIT 前 refreshCollectionVisibility
//   - 课程删除先收集关联合集 ID、删除后同事务刷新
//   - 课程 PATCH 返回 finalize 后的派生可见性
//   - 学生合集详情无公开课程 -> 404（管理可读空私密）
// 不连接真实数据库；lockVisibilityFamilies 由主代理在 content-visibility.js 统一提供，
// 本测试用 mock.module 注入同名导出以验证「调用时机/参数」，真实加锁语义由共享测试覆盖。
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_VISIBILITY = new URL('./content-visibility.js', import.meta.url).href;

// 真实导出（仅用于把未改动的可见性helper原样透传给被测模块）。
import * as realContentVisibility from './content-visibility.js';

let scenario = 'no-prereq';            // 'no-prereq' | 'keep-public' | 'conflict'
let collectionDetailScenario = 'non-empty'; // 'non-empty' | 'empty'
let relatedCollectionIds = [7, 8];    // 课程删除时收集到的关联合集（由 mock 返回）
let lastClient = null;
let lockCalls = [];                   // 记录 lockVisibilityFamilies 调用

// 共享锁 helper 的测试替身：记录「调用时机/参数」，不真正加锁。
const mockLockVisibilityFamilies = async (client, families) => {
  lockCalls.push({ client, families });
  // 在 client 调用序列中留下哨兵，便于校验「BEGIN 后首条」。
  client._calls.push({ sql: '/* lockVisibilityFamilies */', params: families });
};

function makeClient() {
  let committed = false;
  let rolledBack = false;
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT id FROM knowledge_points WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (/SELECT visibility FROM knowledge_points WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ visibility: 'public' }], rowCount: 1 };
      }
      if (/UPDATE knowledge_points\s+SET name/.test(sql)) {
        return { rows: [{ id: 1, name: params[0], visibility: 'public' }], rowCount: 1 };
      }
      // 课程/P finalize 刷新父课程派生可见性（主代理会在此统一刷新关联合集）。
      if (/UPDATE knowledge_points c SET visibility = CASE/.test(sql)) {
        const visibility = scenario === 'keep-public' ? 'public' : 'private';
        return { rows: [{ id: 1, visibility }], rowCount: 1 };
      }
      // 合集派生可见性刷新。
      if (/UPDATE knowledge_collections c SET visibility = CASE/.test(sql)) {
        return { rows: [{ id: params[0], visibility: 'private' }], rowCount: 1 };
      }
      if (/INSERT INTO knowledge_collections \(name, cover, description\) VALUES/.test(sql)) {
        return { rows: [{ id: 50, name: params[0], cover: params[1], description: params[2], created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/UPDATE knowledge_collections SET name/.test(sql)) {
        return { rows: [{ id: params[3], name: params[0], cover: params[1], description: params[2], created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/SELECT 1 FROM knowledge_collections WHERE id = \$1/.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
      if (/SELECT id FROM knowledge_points WHERE id = ANY\(\$1/.test(sql)) {
        const ids = params[0] || [];
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
      }
      // 课程删除：事务内收集关联合集 ID。
      if (/SELECT DISTINCT collection_id FROM knowledge_collection_items WHERE knowledge_point_id = \$1/.test(sql)) {
        return { rows: relatedCollectionIds.map((c) => ({ collection_id: c })), rowCount: relatedCollectionIds.length };
      }
      if (/FROM prerequisites WHERE prerequisite_type/.test(sql)) {
        const hit = scenario === 'conflict';
        return { rows: hit ? [{ c: 1 }] : [], rowCount: hit ? 1 : 0 };
      }
      if (/^\s*BEGIN/.test(sql)) return {};
      if (/^\s*COMMIT/.test(sql)) { committed = true; return {}; }
      if (/^\s*ROLLBACK/.test(sql)) { rolledBack = true; return {}; }
      // 其余（DELETE / INSERT 日志 / 计数类）一律视为成功；DELETE ... RETURNING 需带 rows 以免调用方 .rows.map 崩溃。
      if (/DELETE FROM|INSERT INTO|UPDATE knowledge_collections SET updated_at/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  client._committed = () => committed;
  client._rolledBack = () => rolledBack;
  client._calls = calls;
  lastClient = client;
  return client;
}

const fakePool = {
  connect: async () => makeClient(),
  query: async (sql, params) => {
    // findCollection
    if (/SELECT id, name, cover, description, created_at, updated_at\b/.test(sql) && /FROM knowledge_collections WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], name: 'C', cover: '', description: '', created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
    }
    // 合集删除前的存在性校验（SELECT id, name FROM knowledge_collections ...）
    if (/SELECT id, name FROM knowledge_collections WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], name: 'C' }], rowCount: 1 };
    }
    // 合集详情知识点查询（buildKnowledgeCollectionPointsQuery）
    if (/FROM knowledge_collection_items ci/.test(sql) && /JOIN knowledge_points kp/.test(sql)) {
      if (collectionDetailScenario === 'empty') return { rows: [], rowCount: 0 };
      return { rows: [{ id: 2, name: 'KP', cover: '', description: '', updated_at: new Date(), part_count: 1 }], rowCount: 1 };
    }
    if (/FROM content_attachments WHERE object_type/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM library_resource_links l/.test(sql)) return { rows: [], rowCount: 0 };
    // 课程删除前的存在性校验与视频收集（pool 直连，非事务 client）
    if (/SELECT id, name FROM knowledge_points WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], name: 'X' }], rowCount: 1 };
    }
    if (/SELECT DISTINCT v\.id, v\.video_url, v\.cover_url FROM knowledge_parts kp JOIN videos v/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV;
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  // 注入共享锁 helper 的测试替身；其余可见性 helper 原样透传。
  mock.module(SRC_VISIBILITY, {
    namedExports: { ...realContentVisibility, lockVisibilityFamilies: mockLockVisibilityFamilies }
  });
  mod = await import('./knowledge.routes.js');
});
test.after(() => { mock.reset(); });

beforeEach(() => {
  scenario = 'no-prereq';
  collectionDetailScenario = 'non-empty';
  relatedCollectionIds = [7, 8];
  lockCalls = [];
});

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
    ended: false,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { this.ended = true; return this; }
  };
}

// 断言：BEGIN 之后紧邻的首条语句是 lockVisibilityFamilies，且 families 含 'knowledge'。
function assertLockFirstAfterBegin(client) {
  const beginIdx = client._calls.findIndex((c) => /^\s*BEGIN/.test(c.sql));
  const lockIdx = client._calls.findIndex((c) => c.sql === '/* lockVisibilityFamilies */');
  assert.ok(beginIdx >= 0, '应执行 BEGIN');
  assert.ok(lockIdx >= 0, '应调用 lockVisibilityFamilies');
  assert.equal(lockIdx, beginIdx + 1, 'lockVisibilityFamilies 须为 BEGIN 后首条语句');
}

function countCollectionRefreshes(client) {
  return client._calls.filter((c) => /UPDATE knowledge_collections c SET visibility = CASE/.test(c.sql)).length;
}

// ---------- 列表 / 搜索查询构造（游客过滤） ----------

test('buildKnowledgePointsListQuery: 授权用户不过滤，P 计数统计全部', () => {
  const { sql, params } = mod.buildKnowledgePointsListQuery({ canView: true });
  assert.ok(!/NULLIF\(c\.visibility/.test(sql), '不应包含父可见性过滤');
  assert.ok(/COUNT\(kpp\.id\)/.test(sql), 'part_count 应统计全部 P');
  assert.deepEqual(params, []);
});

test('buildKnowledgePointsListQuery: 游客过滤父 public 且存在公开 P，P 计数仅公开 P', () => {
  const { sql, params } = mod.buildKnowledgePointsListQuery({ canView: false });
  assert.ok(sql.includes("COALESCE(NULLIF(c.visibility, ''), 'public') = 'public'"), '缺少父 public 判定');
  assert.ok(sql.includes('EXISTS (SELECT 1 FROM knowledge_parts p WHERE p.knowledge_point_id = c.id'), '缺少 EXISTS 公开 P 判定');
  assert.ok(/COUNT\(CASE WHEN COALESCE\(NULLIF\(kpp\.visibility/.test(sql), 'part_count 应仅统计公开 P');
  assert.deepEqual(params, []);
});

test('buildKnowledgePointsListQuery: 关键字命中 name/description ILIKE（两个参数）', () => {
  const { sql, params } = mod.buildKnowledgePointsListQuery({ canView: true, keyword: '极限' });
  assert.ok(/\(\$1 = '' OR c\.name ILIKE \$2 OR c\.description ILIKE \$2\)/.test(sql));
  assert.deepEqual(params, ['%极限%', '%极限%']);
});

test('buildKnowledgeCollectionsListQuery: 游客仅展示含公开知识点(且含公开 P)的合集', () => {
  const { sql } = mod.buildKnowledgeCollectionsListQuery({ canView: false });
  assert.ok(/EXISTS \([\s\S]*knowledge_parts pp WHERE pp\.knowledge_point_id = kp\.id AND COALESCE\(NULLIF\(pp\.visibility/.test(sql), '合集需含公开知识点且含公开 P');
  assert.ok(/COUNT\(CASE WHEN COALESCE\(NULLIF\(kp\.visibility/.test(sql), 'point_count 应仅统计可见知识点');
});

test('buildKnowledgeCollectionPointsQuery: 游客仅可见公开知识点(含公开 P)', () => {
  const { sql, params } = mod.buildKnowledgeCollectionPointsQuery({ canView: false, collectionId: 7 });
  assert.ok(sql.includes("COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public'"), '知识点可见性过滤缺失');
  assert.ok(sql.includes('EXISTS (SELECT 1 FROM knowledge_parts pp WHERE pp.knowledge_point_id = kp.id'), '知识点公开 P 过滤缺失');
  assert.deepEqual(params, [7]);
});

// ---------- 知识点编辑事务内的派生可见性 / 前置引用冲突 ----------

test('PATCH /:id 新变私密（含前置引用）-> 200 并 COMMIT（私密写入不再被前置引用阻断）', async () => {
  scenario = 'conflict';
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'patch');
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
  assert.ok(!lastClient._calls.some((c) => /FROM prerequisites/.test(c.sql)), 'finalize 不再查前置引用');
});

test('PATCH /:id 新变私密但无前置引用 -> 200 并 COMMIT', async () => {
  scenario = 'no-prereq';
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'patch');
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
});

test('PATCH /:id 仍为公开 -> 200 并 COMMIT，且无前置引用检查', async () => {
  scenario = 'keep-public';
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'patch');
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed());
  assert.ok(!lastClient._rolledBack());
  assert.ok(!lastClient._calls.some((c) => /FROM prerequisites/.test(c.sql)), '公开时不应检查前置引用');
});

// ---------- 阶段B：共享锁 + 合集刷新 + 课程删除刷新 ----------

test('PATCH /:id 阶段B：BEGIN 后首条锁 knowledge 家族，并返回 finalize 后的派生可见性', async () => {
  scenario = 'no-prereq';
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'patch');
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge'], '锁家族须为 [\'knowledge\']');
  // scenario=no-prereq 时 finalize 派生为 private，返回体须反映更新后的可见性。
  assert.equal(res.body.data.visibility, 'private', 'PATCH 应返回 finalize 后的派生可见性');
});

test('PATCH /:id 阶段B：保留公开派生可见性（keep-public）', async () => {
  scenario = 'keep-public';
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'patch');
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.visibility, 'public', 'PATCH 应返回 finalize 后的派生可见性');
});

test('POST /collections 阶段B：BEGIN 后锁家族 + 创建后刷新合集可见性 -> 201', async () => {
  const handler = extractHandler(mod.knowledgeRouter, '/collections', 'post');
  const req = { body: { name: '合集A', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge']);
  assert.equal(countCollectionRefreshes(lastClient), 1, '新建合集应刷新一次派生可见性');
  assert.ok(lastClient._committed());
  assert.equal(res.body.data.id, 50);
});

test('PATCH /collections/:id 阶段B：BEGIN 后锁家族 + 编辑后刷新合集可见性 -> 200', async () => {
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id', 'patch');
  const req = { params: { id: '5' }, body: { name: '合集B', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge']);
  assert.equal(countCollectionRefreshes(lastClient), 1, '编辑合集应刷新一次派生可见性');
  assert.ok(lastClient._committed());
});

test('PATCH /collections/:id/points 阶段B：BEGIN 后锁家族 + 成员替换后刷新合集可见性 -> 200', async () => {
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id/points', 'patch');
  const req = { params: { id: '5' }, body: { pointIds: [2, 3] } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge']);
  assert.equal(countCollectionRefreshes(lastClient), 1, '成员替换应刷新一次派生可见性');
  assert.ok(lastClient._committed());
  assert.deepEqual(res.body.data.pointIds, [2, 3]);
});

test('DELETE /collections/:id 阶段B：BEGIN 后锁家族 + 提交', async () => {
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id', 'delete');
  const req = { params: { id: '5' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 204);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge']);
  assert.ok(lastClient._committed());
});

test('DELETE /:id 阶段B：BEGIN 后锁家族，删除前收集关联合集、删除后同事务刷新', async () => {
  relatedCollectionIds = [7, 8];
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'delete');
  const req = { params: { id: '1' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 204);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['knowledge']);
  // 收集到 2 个关联合集 -> 删除后同事务各刷新一次。
  assert.equal(countCollectionRefreshes(lastClient), 2, '应同事务刷新所有关联合集派生可见性');
  assert.ok(lastClient._committed());
  assert.ok(!lastClient._rolledBack());
});

test('DELETE /:id 阶段B：无关联合集时仅锁家族并提交（不刷新）', async () => {
  relatedCollectionIds = [];
  const handler = extractHandler(mod.knowledgeRouter, '/:id', 'delete');
  const req = { params: { id: '1' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 204);
  assertLockFirstAfterBegin(lastClient);
  assert.equal(countCollectionRefreshes(lastClient), 0, '无关联合集时不应刷新');
  assert.ok(lastClient._committed());
});

// ---------- 学生合集详情：无公开课程 -> 404；管理可读空私密 ----------

test('GET /collections/:id 学生（无公开课程）-> 404', async () => {
  collectionDetailScenario = 'empty';
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id', 'get');
  const req = { params: { id: '9' }, contentViewer: undefined };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 404, '学生无公开课程应 404');
});

test('GET /collections/:id 学生（含公开课程）-> 200', async () => {
  collectionDetailScenario = 'non-empty';
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id', 'get');
  const req = { params: { id: '9' }, contentViewer: undefined };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200, '学生含公开课程应可读取');
  assert.equal(res.body.data.points.length, 1);
});

test('GET /collections/:id 管理员（空私密合集）-> 200（管理可读空私密）', async () => {
  collectionDetailScenario = 'empty';
  const handler = extractHandler(mod.knowledgeRouter, '/collections/:id', 'get');
  const req = { params: { id: '9' }, contentViewer: { role: 'super_admin', status: 'active' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200, '管理员应可读空私密合集');
  assert.equal(res.body.data.points.length, 0);
});
