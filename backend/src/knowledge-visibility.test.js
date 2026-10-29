// 仅针对 knowledge.routes.js 的可见性逻辑测试：列表/合集查询构造 + 知识点编辑事务内的
// 派生可见性刷新、私密写入开关与前置引用冲突（409 回滚）。不连接真实数据库。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC_DB = new URL('./db.js', import.meta.url).href;

let scenario = 'no-prereq';
let lastClient = null;

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
      if (/UPDATE knowledge_points c SET visibility = CASE/.test(sql)) {
        const visibility = scenario === 'keep-public' ? 'public' : 'private';
        return { rows: [{ id: 1, visibility }], rowCount: 1 };
      }
      if (/FROM prerequisites WHERE prerequisite_type/.test(sql)) {
        const hit = scenario === 'conflict';
        return { rows: hit ? [{ c: 1 }] : [], rowCount: hit ? 1 : 0 };
      }
      if (/^\s*BEGIN/.test(sql)) return {};
      if (/^\s*COMMIT/.test(sql)) { committed = true; return {}; }
      if (/^\s*ROLLBACK/.test(sql)) { rolledBack = true; return {}; }
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
  query: async () => ({ rows: [], rowCount: 0 })
};

let mod;
test.before(async () => {
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV;
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./knowledge.routes.js');
});
test.after(() => { mock.reset(); });

function extractPatchHandler(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === '/:id' && route.methods.patch) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error('PATCH /:id handler not found');
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

test('PATCH /:id 新变私密且存在前置引用 -> 409 并 ROLLBACK（不 COMMIT）', async () => {
  scenario = 'conflict';
  const handler = extractPatchHandler(mod.knowledgeRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 409);
  assert.ok(lastClient._rolledBack(), '应回滚事务');
  assert.ok(!lastClient._committed(), '不应提交');
  assert.ok(lastClient._calls.some((c) => /FROM prerequisites/.test(c.sql)), '应执行前置引用检查');
});

test('PATCH /:id 新变私密但无前置引用 -> 200 并 COMMIT', async () => {
  scenario = 'no-prereq';
  const handler = extractPatchHandler(mod.knowledgeRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
});

test('PATCH /:id 仍为公开 -> 200 并 COMMIT，且无前置引用检查', async () => {
  scenario = 'keep-public';
  const handler = extractPatchHandler(mod.knowledgeRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed());
  assert.ok(!lastClient._rolledBack());
  assert.ok(!lastClient._calls.some((c) => /FROM prerequisites/.test(c.sql)), '公开时不应检查前置引用');
});
