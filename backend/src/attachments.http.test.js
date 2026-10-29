// 附件下载预签名地址的真实 HTTP 传输测试（mock DB / auth / storage，不连真实数据库与云）。
// 覆盖点4：学生/游客拒 private、teacher/super_admin 通过、父 private、孤儿、source 非法、
// HEAD 同授权、签名失败不泄密、no-store、权限变更后重新请求拒绝。
// 注意：createDownloadUrl 始终为 mock，COS Range / 预签名过期等真实云端行为不在本测试范围内（标记为 E）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_AUTH = new URL('./auth.js', import.meta.url).href;
const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;

// 可变场景状态：允许在两次请求之间切换可见性，验证“权限变更后重新请求拒绝”。
const state = {
  attachment: null, // 附件行
  hostExists: true, // authorizeAttachment 的宿主存在性检查
  parentReadable: true // canReadContentObject（父课程是否公开可读）
};

// 签名失败可切换，避免重复 mock.module（同一模块不可二次 mock）。
const storageState = { fail: false };

function makeFakePool() {
  const client = {
    async query(sql, params) {
      // 附件行查询（source=content → content_attachments）。注意真实 SQL 的 = 两侧无空格。
      if (/FROM content_attachments WHERE id\s*=\s*\$1/.test(sql)) {
        return { rows: state.attachment ? [state.attachment] : [], rowCount: state.attachment ? 1 : 0 };
      }
      // 宿主存在性检查：SELECT id FROM track_points WHERE id=$1
      if (/SELECT id FROM track_points WHERE id\s*=\s*\$1/.test(sql)) {
        return { rows: state.hostExists ? [{ id: params[0] }] : [], rowCount: state.hostExists ? 1 : 0 };
      }
      // canReadContentObject（track_point 公开课程谓词）
      if (/FROM track_points c WHERE c\.id\s*=\s*\$1/.test(sql)) {
        return { rows: state.parentReadable ? [{ '?column?': 1 }] : [], rowCount: state.parentReadable ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return { query: client.query, connect: async () => client };
}

function viewerFromRole(role) {
  if (role === 'teacher') return { role: 'teacher', status: 'active' };
  if (role === 'super_admin') return { role: 'super_admin', status: 'active' };
  if (role === 'student') return { role: 'user', status: 'active' };
  return undefined; // guest
}

mock.module(SRC_DB, { namedExports: { pool: makeFakePool() } });
mock.module(SRC_AUTH, {
  namedExports: {
    optionalContentViewer(req, res, next) {
      req.contentViewer = viewerFromRole(req.headers['x-test-role']);
      next();
    }
  }
});
mock.module(SRC_STORAGE, {
  namedExports: {
    createDownloadUrl: async () => {
      if (storageState.fail) throw new Error('COS internal: key not found in bucket X');
      return 'https://signed.example/attachments/secret.pdf?sig=abc';
    }
  }
});

const { attachmentsRouter } = await import('./attachments.routes.js');
const app = express();
app.use('/api/attachments', attachmentsRouter);
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));

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

const ATTACH_PRIVATE = {
  id: 1,
  object_type: 'track_point',
  object_id: 7,
  visibility: 'private',
  file_key: 'attachments/track_point/7/secret.pdf',
  file_url: 'https://origin/attachments/track_point/7/secret.pdf'
};
const ATTACH_PUBLIC = { ...ATTACH_PRIVATE, visibility: 'public' };

function url(id, source) {
  return `${base}/api/attachments/${id}/download-url${source ? `?source=${source}` : ''}`;
}

test('no-store 与 Vary 头始终存在（公开可读场景）', async () => {
  state.attachment = ATTACH_PUBLIC;
  state.hostExists = true;
  state.parentReadable = true;
  const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.match(res.headers.get('cache-control'), /private/);
  assert.match(res.headers.get('vary'), /Cookie/);
});

test('学生/游客访问 private 附件被拒绝（fail-closed 404，不泄露存在性）', async () => {
  state.attachment = ATTACH_PRIVATE;
  for (const role of ['student', '']) {
    const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': role } });
    assert.equal(res.status, 404, `role=${role}`);
    const body = await res.json();
    assert.ok(!('file_key' in body) && !('url' in (body.data || {})), '不应泄露 file_key/url');
  }
});

test('teacher / super_admin 可获取 private 附件的一次性签名 URL', async () => {
  state.attachment = ATTACH_PRIVATE;
  state.hostExists = true;
  state.parentReadable = true;
  for (const role of ['teacher', 'super_admin']) {
    const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': role } });
    assert.equal(res.status, 200, `role=${role}`);
    const body = await res.json();
    assert.equal(body.data.id, 1);
    assert.match(body.data.url, /signed\.example/);
    assert.equal(body.data.expiresIn, 300);
  }
});

test('父课程 private 时（附件即便 public）学生被拒绝', async () => {
  state.attachment = ATTACH_PUBLIC;
  state.hostExists = true;
  state.parentReadable = false; // 父不可读
  const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'student' } });
  assert.equal(res.status, 404);
});

test('孤儿附件（宿主不存在）被拒绝', async () => {
  state.attachment = ATTACH_PRIVATE;
  state.hostExists = false;
  const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res.status, 404);
});

test('非法 source 被拒绝且不会查询未知表', async () => {
  state.attachment = ATTACH_PRIVATE;
  const res = await fetch(url(1, 'library'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res.status, 404);
  const res2 = await fetch(url(1, 'video'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res2.status, 404);
});

test('HEAD 与 GET 走同一授权：授权则 200 且 HEAD 无响应体，未授权则同样 404', async () => {
  state.attachment = ATTACH_PRIVATE;
  state.hostExists = true;
  state.parentReadable = true;

  const headOk = await fetch(url(1, 'content'), { method: 'HEAD', headers: { 'x-test-role': 'teacher' } });
  assert.equal(headOk.status, 200);
  assert.match(headOk.headers.get('cache-control'), /no-store/);
  assert.equal(await headOk.text(), ''); // HEAD 无响应体

  const headDenied = await fetch(url(1, 'content'), { method: 'HEAD', headers: { 'x-test-role': 'student' } });
  assert.equal(headDenied.status, 404); // 与 GET 一致，不因 HEAD 而绕过授权
});

test('签名（预签名 URL 生成）失败：返回通用 500 且不泄露文件存在性/key', async () => {
  state.attachment = ATTACH_PRIVATE;
  state.hostExists = true;
  state.parentReadable = true;
  storageState.fail = true;
  const res = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.message, '下载地址生成失败'); // 通用文案，不含底层错误
  assert.ok(!('file_key' in body), '不应泄露 file_key');
  storageState.fail = false;
});

test('权限变更后重新请求被拒绝：public→private 后学生再请求返回 404', async () => {
  state.attachment = ATTACH_PUBLIC; // 第一次：public
  state.hostExists = true;
  state.parentReadable = true;
  const first = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'student' } });
  assert.equal(first.status, 200, 'public 时学生应可访问');

  state.attachment = ATTACH_PRIVATE; // 第二次：权限变更为该附件 private
  const second = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'student' } });
  assert.equal(second.status, 404, '变更后学生应被拒绝');

  const teacher = await fetch(url(1, 'content'), { headers: { 'x-test-role': 'teacher' } });
  assert.equal(teacher.status, 200);
});
