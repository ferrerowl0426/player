// videos.routes.js 视频附件可见性集成测试：写入时 visibility 默认 public、编辑遗漏保留 private、
// 显式 private 受私密写入开关拦截（403）、GET /:id 用 serializeAttachments 不泄 private 字段。
// 不连接真实数据库/云：db/storage/transcode 用 mock.module 注入 fake，content-privacy-config 控制私密开关。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;
const SRC_TRANSCODE = new URL('./transcode.js', import.meta.url).href;
const PRIVACY = new URL('./content-privacy-config.js', import.meta.url).href;
const SRC_ROUTES = new URL('./videos.routes.js', import.meta.url).href;

const state = {
  insertedAttachments: [],
  currentAttachments: [],
  detailAttachments: [],
  associations: [],
  committed: false,
  rolledBack: false,
  updatedVisibilities: []
};

class FakePrivateWriteDisabledError extends Error {
  constructor(message = '私密内容功能暂未开放') {
    super(message);
    this.name = 'PrivateWriteDisabledError';
    this.code = 'PRIVATE_WRITE_DISABLED';
    this.status = 403;
  }
}

function makeFakePool() {
  const handler = (sql, params) => {
    // 事务控制语句：记录提交/回滚，用于校验可见性变更的事务语义。
    if (/^\s*BEGIN\s*$/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^\s*COMMIT\s*$/i.test(sql)) { state.committed = true; return { rows: [], rowCount: 0 }; }
    if (/^\s*ROLLBACK\s*$/i.test(sql)) { state.rolledBack = true; return { rows: [], rowCount: 0 }; }
    if (sql.includes('INSERT INTO video_attachments')) {
      state.insertedAttachments.push(params);
      return { rows: [{ id: state.insertedAttachments.length }] };
    }
    if (sql.includes('INSERT INTO videos') && sql.includes('RETURNING')) {
      return { rows: [{ id: 1, title: params[0], description: params[1], video_url: params[2], cover_url: params[3], created_at: new Date() }], rowCount: 1 };
    }
    if (sql.includes('UPDATE videos') && sql.includes('RETURNING')) {
      return { rows: [{ id: 1, title: 't', description: '', video_url: 'https://o/v.mp4', cover_url: 'https://o/c.jpg', created_at: new Date() }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO video_prerequisites')) return { rows: [] };
    if (sql.includes('title, description') && sql.includes('FROM videos')) {
      return { rows: [{ id: 1, title: 't', description: '', video_url: 'https://o/v.mp4', cover_url: 'https://o/c.jpg', created_at: new Date() }], rowCount: 1 };
    }
    if (sql.includes('video_url, cover_url') && sql.includes('FROM videos')) {
      return { rows: [{ id: 1, video_url: 'https://o/v.mp4', cover_url: 'https://o/c.jpg' }], rowCount: 1 };
    }
    // 可见性变更路径：按附件 ID 精确命中（FOR UPDATE），模拟“归属当前课程”的判定。
    // 注意 handler 此处 SQL 为 “id,file_key,visibility ... FOR UPDATE”（无空格），需精确匹配。
    if (sql.includes('id,file_key,visibility FROM video_attachments') && sql.includes('FOR UPDATE')) {
      const attId = params && params[0];
      const row = state.currentAttachments.find((a) => a.id === attId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('UPDATE video_attachments SET visibility')) {
      state.updatedVisibilities.push(params);
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('id, file_key, visibility FROM video_attachments')) {
      return { rows: state.currentAttachments, rowCount: state.currentAttachments.length };
    }
    if (sql.includes('FROM video_attachments') && sql.includes('file_name')) {
      return { rows: state.detailAttachments, rowCount: state.detailAttachments.length };
    }
    if (sql.includes('track_parts tp JOIN track_points') || sql.includes('knowledge_parts kp JOIN knowledge_points')) {
      return { rows: state.associations, rowCount: state.associations.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { async query(sql, params) { return handler(sql, params); }, release() {} };
  return { query: handler, connect: async () => client };
}

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: makeFakePool() } });
  mock.module(SRC_STORAGE, {
    namedExports: {
      ensureObjectExists: async () => ({ ContentLength: 10 }),
      getPublicUrl: (key) => `https://origin/${key}`,
      deleteFromBucket: async () => {},
      normalizePublicUrl: (url) => url || '',
      createUploadUrl: async () => 'https://upload',
      createMultipartUpload: async () => ({ uploadId: 'u' }),
      createMultipartPartUrl: async () => 'https://part',
      completeMultipartUpload: async () => {},
      abortMultipartUpload: async () => {},
      getKeyFromPublicUrl: (url) => String(url || '').replace('https://origin/', '')
    }
  });
  mock.module(SRC_TRANSCODE, {
    namedExports: {
      createInitialRenditions: async () => {},
      deleteObjectKeys: async () => {},
      findVideoIdBySourceKey: async () => null,
      getVideoObjectKeys: async () => [],
      isAllowedCiOutputKey: () => true,
      isCiSuccessState: () => true,
      parseCiWorkflowCallbackPayload: () => [],
      resolveTranscodeQuality: () => null,
      upsertRendition: async () => true,
      verifyCiCallbackRequest: () => ({ ok: true, via: 'token' })
    }
  });
  // 默认 off：新的 private 写入被拦截（403）。
  mock.module(PRIVACY, {
    namedExports: {
      CONTENT_PRIVACY_MODE: 'off',
      assertPrivateWriteAllowed(nextVisibility, previousVisibility) {
        if (nextVisibility === 'private' && previousVisibility === 'private') return;
        if (nextVisibility === 'private') throw new FakePrivateWriteDisabledError();
      }
    }
  });
  mod = await import(SRC_ROUTES);
});
test.after(() => mock.reset());
test.beforeEach(() => {
  state.insertedAttachments = [];
  state.currentAttachments = [];
  state.detailAttachments = [];
  state.associations = [];
  state.committed = false;
  state.rolledBack = false;
  state.updatedVisibilities = [];
});

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; }
  };
}
function extractHandler(router, path, method) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`handler not found: ${method.toUpperCase()} ${path}`);
}
function nextThrows() {
  return (e) => { throw e; };
}

const STUDENT = { role: 'user', status: 'active' };
const TEACHER = { role: 'teacher', status: 'active' };

// ---------- POST /complete：新建视频附件 ----------
test('POST /complete 默认 visibility=public 并写入', async () => {
  const handler = extractHandler(mod.videoRouter, '/complete', 'post');
  const res = makeRes();
  await handler({
    body: {
      title: '课程A',
      description: '',
      videoKey: 'videos/v.mp4',
      coverKey: 'covers/c.jpg',
      attachments: [{ key: 'attachments/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf' }]
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 201);
  assert.equal(state.insertedAttachments.length, 1);
  assert.equal(state.insertedAttachments[0][6], 'public');
});

test('POST /complete 显式 private 在 off 模式被拦截 → 403', async () => {
  const handler = extractHandler(mod.videoRouter, '/complete', 'post');
  const res = makeRes();
  await handler({
    body: {
      title: '课程A',
      description: '',
      videoKey: 'videos/v.mp4',
      coverKey: 'covers/c.jpg',
      attachments: [{ key: 'attachments/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf', visibility: 'private' }]
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 403);
  assert.equal(state.insertedAttachments.length, 0);
});

// ---------- PATCH /:id：编辑视频附件 ----------
test('PATCH /:id 替换时遗漏 visibility → 保留旧 private', async () => {
  state.currentAttachments = [{ id: 5, file_key: 'attachments/old5.pdf', visibility: 'private' }];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {
        keepIds: [],
        deleteIds: [],
        replace: [{ oldAttachmentId: 5, key: 'attachments/new5.pdf', fileName: 'new5.pdf', fileType: 'application/pdf' }]
      }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 200);
  assert.equal(state.insertedAttachments.length, 1);
  assert.equal(state.insertedAttachments[0][6], 'private');
});

test('PATCH /:id 新增显式 private → off 模式 403', async () => {
  state.currentAttachments = [];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {
        keepIds: [],
        deleteIds: [],
        add: [{ key: 'attachments/newp.pdf', fileName: 'newp.pdf', fileType: 'application/pdf', visibility: 'private' }]
      }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 403);
  assert.equal(state.insertedAttachments.length, 0);
});

test('PATCH /:id keep 旧附件不触碰其 visibility（保持稳定 id）', async () => {
  state.currentAttachments = [
    { id: 7, file_key: 'attachments/keep.pdf', visibility: 'private' },
    { id: 8, file_key: 'attachments/del.pdf', visibility: 'public' }
  ];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {
        keepIds: [7],
        deleteIds: [8],
        add: [{ key: 'attachments/add.pdf', fileName: 'add.pdf', fileType: 'application/pdf' }]
      }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 200);
  // 仅 add 一项被插入；keep(7)/delete(8) 未触发新插入。
  assert.equal(state.insertedAttachments.length, 1);
  assert.equal(state.insertedAttachments[0][6], 'public');
});

// ---------- GET /:id：详情序列化不泄 private 字段 ----------
test('GET /:id 学生看不到 private 附件', async () => {
  state.detailAttachments = [
    { id: 1, file_name: 'pub.pdf', file_url: 'https://o/pub', file_key: 'attachments/pub', file_type: 'application/pdf', file_size: 10, visibility: 'public', created_at: new Date() },
    { id: 2, file_name: 'sec.pdf', file_url: 'https://o/sec', file_key: 'attachments/sec', file_type: 'application/pdf', file_size: 10, visibility: 'private', created_at: new Date() }
  ];
  const handler = extractHandler(mod.videoRouter, '/:id', 'get');
  const res = makeRes();
  await handler({ params: { id: '1' }, query: {}, contentViewer: STUDENT, user: { type: 'user' }, admin: null }, res, nextThrows());
  assert.equal(res.statusCode, 200);
  const ids = res.body.data.attachments.map((a) => a.id);
  assert.deepEqual(ids, [1]);
});

test('GET /:id 教师可见 private 附件但无永久 URL/key', async () => {
  state.detailAttachments = [
    { id: 1, file_name: 'pub.pdf', file_url: 'https://o/pub', file_key: 'attachments/pub', file_type: 'application/pdf', file_size: 10, visibility: 'public', created_at: new Date() },
    { id: 2, file_name: 'sec.pdf', file_url: 'https://o/sec', file_key: 'attachments/sec', file_type: 'application/pdf', file_size: 10, visibility: 'private', created_at: new Date() }
  ];
  const handler = extractHandler(mod.videoRouter, '/:id', 'get');
  const res = makeRes();
  await handler({ params: { id: '1' }, query: {}, contentViewer: TEACHER, user: { type: 'user' }, admin: null }, res, nextThrows());
  assert.equal(res.statusCode, 200);
  const secret = res.body.data.attachments.find((a) => a.id === 2);
  assert.ok(secret, '教师应能看到 private 附件');
  assert.equal(secret.file_url, undefined);
  assert.equal(secret.file_key, undefined);
  assert.match(secret.download_endpoint, /\/api\/attachments\/2\/download-url\?source=video/);
});

// ---------- PATCH /:id：attachmentPlan.visibilityChanges 稳定 ID 改附件权限 ----------
// 不替换文件：事务锁 video → 查附件归属 FOR UPDATE → assertVideoAttachmentWriteAllowed →
// UPDATE video_attachments.visibility。以下仅测这一路径（visibilities 变更不与 keep/replace/add 混用）。
test('PATCH /:id 公开→private 在 off 模式被拦截 → 403 且整体回滚', async () => {
  // 当前课程附件 10 为 public；请求将其改为 private（off 模式应被私密写入开关拦截）。
  state.currentAttachments = [{ id: 10, file_key: 'attachments/a10.pdf', visibility: 'public' }];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {},
      attachmentPlan: { visibilityChanges: [{ id: 10, visibility: 'private' }] }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 403);
  // 拦截发生在事务内：整体回滚，不提交；且没有任何附件可见性被实际 UPDATE。
  assert.equal(state.committed, false);
  assert.equal(state.rolledBack, true);
  assert.equal(state.updatedVisibilities.length, 0);
  assert.equal(state.insertedAttachments.length, 0);
});

test('PATCH /:id private→public 成功且保持原附件 ID', async () => {
  // 当前课程附件 12 为 private；请求改为 public（不受影响私密开关，应成功）。
  state.currentAttachments = [{ id: 12, file_key: 'attachments/a12.pdf', visibility: 'private' }];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {},
      attachmentPlan: { visibilityChanges: [{ id: 12, visibility: 'public' }] }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 200);
  // 不新增附件，仅更新既有 ID 的 visibility（稳定 ID，不替换文件）。
  assert.equal(state.insertedAttachments.length, 0);
  assert.equal(state.updatedVisibilities.length, 1);
  assert.deepEqual(state.updatedVisibilities[0], ['public', 12, 1]);
  assert.equal(state.committed, true);
  assert.equal(state.rolledBack, false);
});

test('PATCH /:id 传入不属于当前课程的附件 ID → 400 且回滚', async () => {
  // 当前课程仅含附件 12；请求变更 foreign id=99，归属校验应失败并回滚。
  state.currentAttachments = [{ id: 12, file_key: 'attachments/a12.pdf', visibility: 'public' }];
  const handler = extractHandler(mod.videoRouter, '/:id', 'patch');
  const res = makeRes();
  await handler({
    params: { id: '1' },
    body: {
      title: '课程A',
      description: '',
      attachments: {},
      attachmentPlan: { visibilityChanges: [{ id: 99, visibility: 'public' }] }
    }
  }, res, nextThrows());
  assert.equal(res.statusCode, 400);
  // 归属校验失败：事务回滚，不提交；合法附件 12 的可见性也未被 UPDATE（级联回滚）。
  assert.equal(state.committed, false);
  assert.equal(state.rolledBack, true);
  assert.equal(state.updatedVisibilities.length, 0);
  assert.equal(state.insertedAttachments.length, 0);
});
