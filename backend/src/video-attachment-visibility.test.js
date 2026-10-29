// 视频附件可见性 helper 单测：默认 public、遗漏保留 previous（含 private 沿用）、
// 显式 private 走 assertPrivateWriteAllowed、共用 key 跨 content/library/其它 video 禁止 private。
// 不连接真实数据库；content-privacy-config 用 mock 控制，避免部署模式在导入期被缓存。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SRC = new URL('./video-attachment-visibility.js', import.meta.url).href;
const PRIVACY = new URL('./content-privacy-config.js', import.meta.url).href;

class FakePrivateWriteDisabledError extends Error {
  constructor(message = '私密内容功能暂未开放') {
    super(message);
    this.name = 'PrivateWriteDisabledError';
    this.code = 'PRIVATE_WRITE_DISABLED';
    this.status = 403;
  }
}

let privacyCalls = [];
let privacyMode = 'off';
let privacyThrow = null;
let allowPrivate = false;

let mod;
test.before(async () => {
  mock.module(PRIVACY, {
    namedExports: {
      CONTENT_PRIVACY_MODE: 'off',
      assertPrivateWriteAllowed(nextVisibility, previousVisibility) {
        privacyCalls.push([nextVisibility, previousVisibility]);
        if (privacyThrow) throw privacyThrow;
        // 复刻真实规则：已是 private（含遗漏保留）不算新的私密写入，放行。
        if (nextVisibility === 'private' && previousVisibility === 'private') return;
        // allowPrivate 模拟 local-preview / 强制模式放行新的私密写入。
        if (nextVisibility === 'private' && !allowPrivate) throw new FakePrivateWriteDisabledError();
      }
    }
  });
  mod = await import(SRC);
});
test.after(() => mock.reset());
test.beforeEach(() => { privacyCalls = []; privacyThrow = null; allowPrivate = false; });

// ---------- resolveVideoAttachmentVisibility ----------
test('遗漏（undefined）且无私密前值 → 默认 public', () => {
  assert.equal(mod.resolveVideoAttachmentVisibility(undefined, undefined), 'public');
});
test('遗漏但前值为 private → 保留 private', () => {
  assert.equal(mod.resolveVideoAttachmentVisibility(undefined, 'private'), 'private');
});
test('显式 public → public', () => {
  assert.equal(mod.resolveVideoAttachmentVisibility('public', undefined), 'public');
});
test('显式 private → private（落库前由 assert 把关）', () => {
  assert.equal(mod.resolveVideoAttachmentVisibility('private', undefined), 'private');
});
test('非法可见性值 → 抛 VisibilityError', () => {
  assert.throws(() => mod.resolveVideoAttachmentVisibility('secret', undefined), /公开或私密/);
});

// ---------- assertVideoAttachmentWriteAllowed ----------
function fakeClient({ shared = false } = {}) {
  return {
    async query(sql) {
      if (/content_attachments WHERE file_key/.test(sql) || /library_resources WHERE file_key/.test(sql) || /video_attachments WHERE file_key/.test(sql)) {
        return { rows: shared ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    }
  };
}

test('public 不需要任何校验，且不查询共用情况', async () => {
  let queried = false;
  const client = { async query() { queried = true; return { rows: [{ '?column?': 1 }] }; } };
  await mod.assertVideoAttachmentWriteAllowed({ client, videoId: 1, fileKey: 'k', visibility: 'public', previousVisibility: undefined });
  assert.equal(queried, false);
  assert.equal(privacyCalls.length, 0);
});

test('私密开关放行模式（local-preview/enforced）下新 private 放行', async () => {
  allowPrivate = true;
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: undefined });
  assert.deepEqual(privacyCalls.at(-1), ['private', undefined]);
});

test('守护模式（off）下新 private 被 assert 拦截 → 抛 403', async () => {
  await assert.rejects(
    mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: undefined }),
    (e) => e.status === 403
  );
});

test('遗漏保留的 private（previous 已 private）不算新写入，off 下也放行', async () => {
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: 'private' });
  assert.deepEqual(privacyCalls.at(-1), ['private', 'private']);
});

test('共用 key（跨 content/library/其它 video）禁止设为 private → 抛 SHARED_ATTACHMENT', async () => {
  // previous 已 private 时 assertPrivateWriteAllowed 放行，但共用检查仍应拒绝。
  await assert.rejects(
    mod.assertVideoAttachmentWriteAllowed({ client: fakeClient({ shared: true }), videoId: 1, fileKey: 'attachments/shared.pdf', visibility: 'private', previousVisibility: 'private' }),
    (e) => e.code === 'SHARED_ATTACHMENT'
  );
});

test('同 video 内的 key 不算共用（video_id <> $2 排除自身）', async () => {
  // 查询返回自身（video_id 相同）不应触发共用拒绝；这里直接验证不抛错。
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'attachments/self.pdf', visibility: 'private', previousVisibility: 'private' });
});
