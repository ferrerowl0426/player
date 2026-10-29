// 小程序文件签名入口 source 校验测试：未知 source 必须被拒绝且不回退 library（点2）。
// mock DB / storage / auth / services，不连真实云。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./miniprogram.auth.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;
const SRC_SERVICES = new URL('./miniprogram.services.js', import.meta.url).href;

const counters = { libraryDetailCalls: 0 };

mock.module(SRC_DB, { namedExports: { pool: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }) } } });
mock.module(SRC_AUTH, {
  namedExports: {
    requireMiniStudent(req, res, next) { req.student = { id: '1', status: 'active', classId: '1', className: '' }; next(); },
    sendMiniError(res, status, code, message) { res.status(status).json({ success: false, error: { code, message } }); },
    sendMiniSuccess(res, data, message) { res.status(200).json({ success: true, data, message: message || 'ok' }); },
    serializeStudent(student) { return student; },
    studentToViewer(student) { return { role: 'user', status: student?.status === 'active' ? 'active' : 'disabled' }; }
  }
});
mock.module(SRC_STORAGE, {
  namedExports: {
    getPublicUrl: (key) => `https://origin/${key}`,
    normalizePublicUrl: (url) => url || '',
    getKeyFromPublicUrl: (url) => String(url || '').replace('https://origin/', ''),
    isPdfContentType: (ct) => String(ct || '').toLowerCase().includes('application/pdf'),
    createUploadUrl: async () => 'https://up.example/x',
    finalizePdfInlineMetadata: async () => {},
    createDownloadUrl: async () => 'https://signed.example/file',
    createMultipartUpload: async () => 'upload-id',
    createMultipartPartUrl: async () => 'https://part.example/x',
    completeMultipartUpload: async () => {},
    abortMultipartUpload: async () => {},
    ensureObjectExists: async () => ({ ContentLength: 10 }),
    deleteFromBucket: async () => {},
    listBucketKeys: async () => []
  }
});
mock.module(SRC_SERVICES, {
  namedExports: {
    getHomeworkHistory: async () => ({}),
    getKnowledgeCollectionDetail: async () => null,
    getKnowledgeDetail: async () => null,
    getLibraryDetail: async (fileId) => { counters.libraryDetailCalls += 1; return { id: String(fileId), objectKey: 'library/x.pdf' }; },
    getTodayHomework: async () => ({}),
    getTrackCollectionDetail: async () => null,
    getTrackDetail: async () => null,
    listKnowledge: async () => ({}),
    listLibrary: async () => ({}),
    listTracks: async () => ({})
  }
});

const { miniprogramRouter } = await import('./miniprogram.routes.js');
const app = express();
app.use(express.json());
app.use('/api/miniprogram', miniprogramRouter);
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

test('未知 source=video 被拒绝（400）且绝不回退 library', async () => {
  counters.libraryDetailCalls = 0;
  const res = await fetch(`${base}/api/miniprogram/files/1/signed-url?source=video`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INVALID_SOURCE');
  assert.equal(counters.libraryDetailCalls, 0, '未知 source 不应触发图书馆详情查询');
});

test('未知 source=foo 被拒绝且不回退 library', async () => {
  counters.libraryDetailCalls = 0;
  const res = await fetch(`${base}/api/miniprogram/files/1/signed-url?source=foo`);
  assert.equal(res.status, 400);
  assert.equal(counters.libraryDetailCalls, 0);
});

test('默认（无 source）走 library 分支并返回签名 URL', async () => {
  counters.libraryDetailCalls = 0;
  const res = await fetch(`${base}/api/miniprogram/files/1/signed-url`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.url, 'https://signed.example/file');
  assert.equal(counters.libraryDetailCalls, 1);
});

test('显式 source=library 走 library 分支', async () => {
  counters.libraryDetailCalls = 0;
  const res = await fetch(`${base}/api/miniprogram/files/1/signed-url?source=library`);
  assert.equal(res.status, 200);
  assert.equal(counters.libraryDetailCalls, 1);
});
