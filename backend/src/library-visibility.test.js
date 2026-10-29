// 针对 library.routes.js 的可见性测试：getLinks 过滤私密关联课程（图书馆本体权限留待 C/E）。
// 不连接真实数据库，mock db.js 的 pool。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DB = new URL('./db.js', import.meta.url).href;

const fakePool = {
  async query(sql, params) {
    return { rows: [], rowCount: 0 };
  },
  _calls: [],
  _reset() { this._calls.length = 0; }
};
// 记录所有 SQL 以便断言。
const recordingPool = {
  async query(sql, params) {
    fakePool._calls.push({ sql, params });
    if (/FROM library_resources WHERE id/.test(sql)) return { rows: [{ id: 1, title: '资料', file_url: '', file_key: '' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  _calls: fakePool._calls,
  _reset: fakePool._reset
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: recordingPool } });
  mod = await import('./library.routes.js');
});
test.after(() => { mock.reset(); });
test.beforeEach(() => { recordingPool._reset(); });

function getLinksSql() {
  return recordingPool._calls.map((c) => c.sql).find((sql) => /FROM library_resource_links l/.test(sql));
}

test('getLinks：默认（公开接口）带私密关联过滤条件', async () => {
  await mod.getLinks('1');
  const sql = getLinksSql();
  assert.ok(sql, '应查询关联课程');
  assert.ok(/\$2::boolean = TRUE OR \(/.test(sql), '应带可见性条件');
  assert.ok(/EXISTS \(SELECT 1 FROM track_parts pp WHERE pp\.track_id = tp\.id/.test(sql), '曲目关联需查公开 P');
  assert.ok(/EXISTS \(SELECT 1 FROM knowledge_parts pp WHERE pp\.knowledge_point_id = kp\.id/.test(sql), '知识点关联需查公开 P');
  assert.ok(/EXISTS \(SELECT 1 FROM track_collection_items ci JOIN track_points ti/.test(sql), '曲谱集关联需查可见曲目');
  assert.ok(/EXISTS \(SELECT 1 FROM knowledge_collection_items ci JOIN knowledge_points ki/.test(sql), '知识点集关联需查可见知识点');
});

test('getLinks：canView=true 时不带私密过滤条件', async () => {
  await mod.getLinks('1', true);
  const sql = getLinksSql();
  assert.ok(sql, '应查询关联课程');
  // 公开接口默认 false；当显式 canView=true 时，$2 为 TRUE，第一分支直接为真，不应再拼接 OR 分支的详细条件。
  assert.equal(recordingPool._calls.find((c) => c.sql === sql).params[1], true, '授权者通过绑定参数绕过公开过滤');
});

// 集成：图书馆详情接口默认对游客可见，其 links 走上面的过滤路径。
function extractGetDetailHandler(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === '/:id' && route.methods.get) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error('GET /:id handler not found');
}

test('GET /:id：返回 200 且 links 查询带私密过滤', async () => {
  const handler = extractGetDetailHandler(mod.libraryRouter);
  const req = { params: { id: '1' }, query: {} };
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.ok(getLinksSql(), '详情应查询关联课程且带过滤');
});
