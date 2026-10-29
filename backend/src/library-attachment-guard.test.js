// 图书馆资料“引用已 private 附件 key”旁路防护的集成测试（mock DB / storage / auth，不连真实云）。
// 覆盖点2：library_resources 新建/更新/文件替换入口拒绝引用已 private 附件文件（同 URL 归一）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./auth.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;

const state = {
  privateRows: [], // 命中 guard 的 private 附件行（含 file_key / file_url）
  insertCalled: false
};

function makeFakePool() {
  const query = async (sql, params) => {
    if (/content_attachments WHERE visibility = 'private'/.test(sql) || /video_attachments WHERE visibility = 'private'/.test(sql)) {
      return { rows: state.privateRows, rowCount: state.privateRows.length };
    }
    if (/FROM admins WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: 1, nickname: 'admin', username: 'admin', account: 'admin' }], rowCount: 1 };
    }
    if (/INSERT INTO library_resources/.test(sql)) {
      state.insertCalled = true;
      return { rows: [{ id: 1, title: params[0] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

mock.module(SRC_DB, { namedExports: { pool: makeFakePool() } });
mock.module(SRC_AUTH, {
  namedExports: {
    requireSuperAdmin(req, res, next) { req.admin = { adminId: 1 }; next(); }
  }
});
mock.module(SRC_STORAGE, {
  namedExports: {
    ensureObjectExists: async () => ({ ContentLength: 10 }),
    finalizePdfInlineMetadata: async () => {},
    getPublicUrl: (key) => `https://origin/${key}`,
    normalizePublicUrl: (url) => url || '',
    deleteFromBucket: async () => {},
    createUploadUrl: async () => 'https://up.example/x'
  }
});

const { libraryRouter } = await import('./library.routes.js');
const app = express();
app.use(express.json());
app.use('/api/library', libraryRouter);
app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));

let server, base;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  mock.reset();
});

const BASE_BODY = { title: '资料A', fileName: 'x.pdf', fileKey: 'library/test.pdf', cover: 'https://origin/cover.jpg', links: [] };

test('新建：引用 private 附件的 key（key 形式）被拒绝 → 409 且不落库', async () => {
  state.privateRows = [{ file_key: 'library/test.pdf', file_url: 'https://origin/library/test.pdf' }];
  state.insertCalled = false;
  const res = await fetch(`${base}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(BASE_BODY)
  });
  assert.equal(res.status, 409);
  assert.equal(state.insertCalled, false, '不应写入图书馆资料');
});

test('新建：引用 private 附件（同 URL 归一，URL 形式）被拒绝 → 409', async () => {
  // 同一物理文件，private 附件以完整 URL 记录，图书馆以 key 记录，归一后命中。
  state.privateRows = [{ file_key: 'attachments/unrelated.pdf', file_url: 'https://origin/library/test.pdf' }];
  state.insertCalled = false;
  const res = await fetch(`${base}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(BASE_BODY)
  });
  assert.equal(res.status, 409);
  assert.equal(state.insertCalled, false);
});

test('新建：无冲突的私有引用时正常落库 → 201', async () => {
  state.privateRows = [];
  state.insertCalled = false;
  const res = await fetch(`${base}/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(BASE_BODY)
  });
  assert.equal(res.status, 201);
  assert.equal(state.insertCalled, true);
});

test('更新/文件替换：携带 fileKey 引用 private 附件 key 同样被拒绝 → 409', async () => {
  state.privateRows = [{ file_key: 'library/test.pdf', file_url: '' }];
  state.insertCalled = false;
  const res = await fetch(`${base}/api/library/1`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '资料A', cover: 'https://origin/cover.jpg', fileKey: 'library/test.pdf' })
  });
  assert.equal(res.status, 409);
});
