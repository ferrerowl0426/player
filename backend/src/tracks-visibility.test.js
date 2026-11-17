// 仅针对 tracks.routes.js 的可见性逻辑测试：列表/合集查询构造 + 课程编辑事务内的
// 派生可见性刷新、私密写入开关与前置引用冲突（409 回滚）。不连接真实数据库。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC_DB = new URL('./db.js', import.meta.url).href;

// 用受控假连接替换 db.js 的 pool，避免触碰真实数据库。
// scenario 控制 refresh 后父课程的可见性，以及 prerequisites 是否命中前置引用。
let scenario = 'no-prereq';
// collectionScenario 控制删除曲目时 pool.query 是否返回引用它的合集 ID。
let collectionScenario = 'none';
let lastClient = null;

function makeClient() {
  let committed = false;
  let rolledBack = false;
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT id FROM track_points WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (/SELECT visibility FROM track_points WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: [{ visibility: 'public' }], rowCount: 1 };
      }
      if (/UPDATE track_points\s+SET name/.test(sql)) {
        return { rows: [{ id: 1, name: params[0], visibility: 'public' }], rowCount: 1 };
      }
      // refreshCourseVisibility 的 UPDATE ... RETURNING id, visibility
      if (/UPDATE track_points c SET visibility = CASE/.test(sql)) {
        const visibility = scenario === 'keep-public' ? 'public' : 'private';
        return { rows: [{ id: 1, visibility }], rowCount: 1 };
      }
      if (/FROM prerequisites WHERE prerequisite_type/.test(sql)) {
        const hit = scenario === 'conflict';
        return { rows: hit ? [{ c: 1 }] : [], rowCount: hit ? 1 : 0 };
      }
      if (/SELECT DISTINCT collection_id FROM track_collection_items WHERE track_id = \$1/.test(sql)) {
        return { rows: collectionScenario === 'with-collections' ? [{ collection_id: 7 }] : [], rowCount: collectionScenario === 'with-collections' ? 1 : 0 };
      }
      // 事务级 advisory 锁（lockVisibilityFamilies）。
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{ lock: 1 }], rowCount: 1 };
      // 合集派生可见性刷新（refreshCollectionVisibility）：返回刷新后的行。
      if (/UPDATE track_collections c SET visibility = CASE/.test(sql)) {
        return { rows: [{ id: params && params[0], visibility: 'private' }], rowCount: 1 };
      }
      // 合集创建 / 编辑：返回写入后的行（多行 SQL，用宽松匹配）。
      if (/INSERT INTO track_collections/.test(sql)) {
        return { rows: [{ id: 1, name: params && params[0], cover: params && params[1], description: params && params[2], created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/UPDATE track_collections\s+SET name/.test(sql)) {
        return { rows: [{ id: params && params[3], name: params && params[0], cover: params && params[1], description: params && params[2], created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
      }
      if (/SELECT id FROM track_collections WHERE id = \$1/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/SELECT id FROM track_points WHERE id = ANY/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/DELETE FROM track_points WHERE id = \$1 RETURNING id/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
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
  query: async (sql) => {
    // findTrack：返回存在的曲目，便于 DELETE /:id 走完事务（多行 SQL，宽松匹配）。
    if (/FROM track_points WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 1, name: 'course', cover: '', description: '', visibility: 'public', created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
    }
    // 删除曲目前收集引用它的合集。
    if (/SELECT DISTINCT collection_id FROM track_collection_items WHERE track_id = \$1/.test(sql)) {
      return collectionScenario === 'with-collections'
        ? { rows: [{ collection_id: 7 }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  // 让私密写入开关放行到“本地预览”，以便走到前置引用检查分支（生产环境默认 off 会先拦截）。
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV; // 非 production -> local-preview 放行
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mod = await import('./tracks.routes.js');
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

function extractHandler(router, method, path) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`handler ${method} ${path} not found`);
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

test('buildTrackPointsListQuery: 授权用户不过滤，P 计数统计全部', () => {
  const { sql, params } = mod.buildTrackPointsListQuery({ canView: true });
  assert.ok(!/NULLIF\(c\.visibility/.test(sql), '不应包含父可见性过滤');
  assert.ok(/COUNT\(tp\.id\)/.test(sql), 'part_count 应统计全部 P');
  assert.deepEqual(params, []);
});

test('buildTrackPointsListQuery: 游客过滤父 public 且存在公开 P，P 计数仅公开 P', () => {
  const { sql, params } = mod.buildTrackPointsListQuery({ canView: false });
  assert.ok(sql.includes("COALESCE(NULLIF(c.visibility, ''), 'public') = 'public'"), '缺少父 public 判定');
  assert.ok(sql.includes('EXISTS (SELECT 1 FROM track_parts p WHERE p.track_id = c.id'), '缺少 EXISTS 公开 P 判定');
  assert.ok(/COUNT\(CASE WHEN COALESCE\(NULLIF\(tp\.visibility/.test(sql), 'part_count 应仅统计公开 P');
  assert.deepEqual(params, []);
});

test('buildTrackPointsListQuery: 关键字命中 name ILIKE', () => {
  const { sql, params } = mod.buildTrackPointsListQuery({ canView: true, keyword: 'sonata' });
  assert.ok(/c\.name ILIKE \$1/.test(sql));
  assert.deepEqual(params, ['%sonata%']);
});

test('buildTrackCollectionsListQuery: 游客仅展示含公开曲目(且含公开 P)的合集', () => {
  const { sql } = mod.buildTrackCollectionsListQuery({ canView: false });
  assert.ok(/EXISTS \([\s\S]*track_parts pp WHERE pp\.track_id = tp\.id AND COALESCE\(NULLIF\(pp\.visibility/.test(sql), '合集需含公开曲目且含公开 P');
  assert.ok(/COUNT\(CASE WHEN COALESCE\(NULLIF\(tp\.visibility/.test(sql), 'track_count 应仅统计可见曲目');
});

test('buildTrackCollectionTracksQuery: 游客仅可见公开曲目(含公开 P)', () => {
  const { sql, params } = mod.buildTrackCollectionTracksQuery({ canView: false, collectionId: 42 });
  assert.ok(sql.includes("COALESCE(NULLIF(t.visibility, ''), 'public') = 'public'"), '曲目可见性过滤缺失');
  assert.ok(sql.includes('EXISTS (SELECT 1 FROM track_parts pp WHERE pp.track_id = t.id'), '曲目公开 P 过滤缺失');
  assert.deepEqual(params, [42]);
});

// ---------- 课程编辑事务内的派生可见性 / 前置引用冲突 ----------

test('PATCH /:id 新变私密（含前置引用）-> 200 并 COMMIT（私密写入不再被前置引用阻断）', async () => {
  scenario = 'conflict';
  const handler = extractPatchHandler(mod.tracksRouter);
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
  const handler = extractPatchHandler(mod.tracksRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
});

test('PATCH /:id 仍为公开 -> 200 并 COMMIT，且无前置引用检查', async () => {
  scenario = 'keep-public';
  const handler = extractPatchHandler(mod.tracksRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(lastClient._committed());
  assert.ok(!lastClient._rolledBack());
  assert.ok(!lastClient._calls.some((c) => /FROM prerequisites/.test(c.sql)), '公开时不应检查前置引用');
});

// ---------- 事务级 advisory 锁（lockVisibilityFamilies） ----------

test('PATCH /:id 事务首条语句为 lockVisibilityFamilies(track)，且在行锁之前', async () => {
  scenario = 'keep-public';
  const handler = extractPatchHandler(mod.tracksRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  const calls = lastClient._calls.map((c) => c.sql);
  const beginIdx = calls.findIndex((s) => /^\s*BEGIN/.test(s));
  const lockIdx = calls.findIndex((s) => /pg_advisory_xact_lock/.test(s));
  const forUpdateIdx = calls.findIndex((s) => /SELECT id FROM track_points WHERE id = \$1 FOR UPDATE/.test(s));
  assert.ok(beginIdx >= 0, '应有 BEGIN');
  assert.ok(lockIdx >= 0, '应调用 pg_advisory_xact_lock');
  assert.ok(lockIdx > beginIdx, 'advisory 锁应在 BEGIN 之后');
  assert.ok(lockIdx < forUpdateIdx, 'advisory 锁应在行锁(FOR UPDATE)之前');
});

// ---------- 课程响应返回刷新后的派生可见性 ----------

test('PATCH /:id 返回刷新后的派生可见性（private）', async () => {
  scenario = 'conflict';
  const handler = extractPatchHandler(mod.tracksRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.visibility, 'private', '应返回刷新后的 private');
});

test('PATCH /:id 返回刷新后的派生可见性（public）', async () => {
  scenario = 'keep-public';
  const handler = extractPatchHandler(mod.tracksRouter);
  const req = { params: { id: '1' }, body: { name: 'X', description: '', cover: '' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.visibility, 'public', '应返回刷新后的 public');
});

// ---------- 合集创建/编辑/成员替换：刷新自身派生可见性并加锁 ----------

test('POST /collections 创建后刷新自身派生可见性并提交', async () => {
  const handler = extractHandler(mod.tracksRouter, 'post', '/collections');
  const req = { body: { name: 'C', description: '', cover: '' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  const calls = lastClient._calls.map((c) => c.sql);
  assert.ok(calls.some((s) => /pg_advisory_xact_lock/.test(s)), '应加事务级 advisory 锁');
  assert.ok(calls.some((s) => /UPDATE track_collections c SET visibility = CASE/.test(s)), '应刷新合集派生可见性');
  assert.ok(lastClient._committed());
});

test('PATCH /collections/:id 编辑后刷新自身派生可见性并加锁', async () => {
  const handler = extractHandler(mod.tracksRouter, 'patch', '/collections/:id');
  const req = { params: { id: '1' }, body: { name: 'C', description: '', cover: '' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  const calls = lastClient._calls.map((c) => c.sql);
  assert.ok(calls.some((s) => /pg_advisory_xact_lock/.test(s)), '应加事务级 advisory 锁');
  assert.ok(calls.some((s) => /UPDATE track_collections c SET visibility = CASE/.test(s)), '应刷新合集派生可见性');
  assert.ok(lastClient._committed());
});

test('PATCH /collections/:id/tracks 成员替换后刷新自身并加锁', async () => {
  const handler = extractHandler(mod.tracksRouter, 'patch', '/collections/:id/tracks');
  const req = { params: { id: '1' }, body: { trackIds: [1] }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  const calls = lastClient._calls.map((c) => c.sql);
  assert.ok(calls.some((s) => /pg_advisory_xact_lock/.test(s)), '应加事务级 advisory 锁');
  assert.ok(calls.some((s) => /UPDATE track_collections c SET visibility = CASE/.test(s)), '应刷新合集派生可见性');
  assert.ok(lastClient._committed());
});

// ---------- 课程删除：收集合集并刷新其派生可见性 ----------

test('DELETE /:id 删除曲目后刷新曾引用的合集并加锁', async () => {
  collectionScenario = 'with-collections';
  const handler = extractHandler(mod.tracksRouter, 'delete', '/:id');
  const req = { params: { id: '1' }, admin: { adminId: 1 } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 204);
  const calls = lastClient._calls.map((c) => c.sql);
  assert.ok(calls.some((s) => /pg_advisory_xact_lock/.test(s)), '应加事务级 advisory 锁');
  // 应针对合集 7 刷新派生可见性。
  const refreshCalls = calls.filter((s) => /UPDATE track_collections c SET visibility = CASE/.test(s));
  assert.ok(refreshCalls.length >= 1, '应刷新曾引用的合集');
  assert.ok(lastClient._committed());
});
