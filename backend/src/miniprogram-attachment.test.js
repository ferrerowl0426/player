// 针对 miniprogram.routes.js 的 /files/:fileId/signed-url 测试：附件入口原本只按 ID 查附件、
// 不查父课程，这里验证已补的“私密父课程阻断”。不连接真实数据库，mock db.js 与 storage.js。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;

let attachmentRow = null;
let parentVisibility = 'public';
const fakePool = {
  async query(sql, params) {
    if (/FROM content_attachments WHERE id = \$1/.test(sql)) {
      return { rows: attachmentRow ? [attachmentRow] : [], rowCount: attachmentRow ? 1 : 0 };
    }
    if (/FROM track_points WHERE id = \$1/.test(sql)) {
      return { rows: [{ visibility: parentVisibility }], rowCount: 1 };
    }
    if (/FROM knowledge_points WHERE id = \$1/.test(sql)) {
      return { rows: [{ visibility: parentVisibility }], rowCount: 1 };
    }
    if (/SELECT 1 FROM (track_points|knowledge_points) c WHERE/.test(sql)) return { rows: parentVisibility === 'public' ? [{ id: 9 }] : [], rowCount: parentVisibility === 'public' ? 1 : 0 };
    if (/FROM track_collection_items ci/.test(sql)) return { rows: parentVisibility === 'public' ? [{ id: 3 }] : [], rowCount: parentVisibility === 'public' ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  }
};

const fakeStorage = {
  getKeyFromPublicUrl: (u) => u,
  normalizePublicUrl: (u) => u,
  getPublicUrl: (k) => k,
  createDownloadUrl: async () => 'https://signed.example/url'
};

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mock.module(SRC_STORAGE, { namedExports: fakeStorage });
  mod = await import('./miniprogram.routes.js');
});
test.after(() => { mock.reset(); });
test.beforeEach(() => { attachmentRow = null; parentVisibility = 'public'; });

function extractSignedUrlHandler(router) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === '/files/:fileId/signed-url' && route.methods.get) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error('signed-url handler not found');
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; }
  };
}

test('附件：私密父曲目 -> 404，不签名', async () => {
  attachmentRow = { id: 5, object_type: 'track_point', object_id: 9, file_key: 'attachments/track_point/9/x.pdf', file_url: '' };
  parentVisibility = 'private';
  const handler = extractSignedUrlHandler(mod.miniprogramRouter);
  const req = { params: { fileId: '5' }, query: { source: 'attachment' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 404);
});

test('附件：公开父曲目 -> 200 并返回签名 URL', async () => {
  attachmentRow = { id: 5, object_type: 'track_point', object_id: 9, file_key: 'attachments/track_point/9/x.pdf', file_url: '' };
  parentVisibility = 'public';
  const handler = extractSignedUrlHandler(mod.miniprogramRouter);
  const req = { params: { fileId: '5' }, query: { source: 'attachment' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.data?.url, 'https://signed.example/url');
});

test('附件：私密父知识点 -> 404', async () => {
  attachmentRow = { id: 6, object_type: 'knowledge_point', object_id: 11, file_key: 'attachments/knowledge_point/11/x.pdf', file_url: '' };
  parentVisibility = 'private';
  const handler = extractSignedUrlHandler(mod.miniprogramRouter);
  const req = { params: { fileId: '6' }, query: { source: 'attachment' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 404);
});

test('附件：合集附件（无父课程可见性概念）-> 200，不被误拦', async () => {
  attachmentRow = { id: 7, object_type: 'track_collection', object_id: 3, file_key: 'attachments/track_collection/3/x.pdf', file_url: '' };
  const handler = extractSignedUrlHandler(mod.miniprogramRouter);
  const req = { params: { fileId: '7' }, query: { source: 'attachment' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
});

test('附件：附件不存在 -> 404', async () => {
  attachmentRow = null;
  const handler = extractSignedUrlHandler(mod.miniprogramRouter);
  const req = { params: { fileId: '99' }, query: { source: 'attachment' } };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 404);
});
