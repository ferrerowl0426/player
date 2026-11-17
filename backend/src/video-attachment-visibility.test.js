// 视频附件可见性 helper 单测：默认 public、遗漏保留 previous（含 private 沿用）、
// 显式 private 走 assertPrivateWriteAllowed。附件 visibility 独立、不影响父级，
// 共用 key 不再禁止设为 private（不再做跨表共用 key 保密冲突拦截）。
// 不连接真实数据库；content-privacy-config 用 mock 控制，私密为常规业务不再拦截。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SRC = new URL('./video-attachment-visibility.js', import.meta.url).href;
const PRIVACY = new URL('./content-privacy-config.js', import.meta.url).href;

let privacyCalls = [];
let privacyThrow = null;

let mod;
test.before(async () => {
  mock.module(PRIVACY, {
    namedExports: {
      CONTENT_PRIVACY_MODE: 'business',
      assertPrivateWriteAllowed(nextVisibility, previousVisibility) {
        privacyCalls.push([nextVisibility, previousVisibility]);
        if (privacyThrow) throw privacyThrow;
        // 新语义：私密为常规业务，仅校验可见性取值，不再拦截 private。
        const legal = (v) => v === 'public' || v === 'private' || v === undefined || v === null || v === '';
        if (!legal(nextVisibility)) throw new Error('可见性取值非法');
        if (previousVisibility !== undefined && previousVisibility !== null && previousVisibility !== '' && !legal(previousVisibility)) throw new Error('可见性取值非法');
      }
    }
  });
  mod = await import(SRC);
});
test.after(() => mock.reset());
test.beforeEach(() => { privacyCalls = []; privacyThrow = null; });

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

test('新 private 放行（私密为常规业务，不再受模式拦截）', async () => {
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: undefined });
  assert.deepEqual(privacyCalls.at(-1), ['private', undefined]);
});

test('新 private 不再被拦截（私密为常规业务，off 模式亦放行）', async () => {
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: 'public' });
  assert.deepEqual(privacyCalls.at(-1), ['private', 'public']);
});

test('遗漏保留的 private（previous 已 private）不算新写入，off 下也放行', async () => {
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'k', visibility: 'private', previousVisibility: 'private' });
  assert.deepEqual(privacyCalls.at(-1), ['private', 'private']);
});

test('共用 key 不再禁止设为 private（附件 visibility 独立、不影响父级）', async () => {
  // 移除共用 key 保密冲突后，私密化为常规业务，不再因跨表共用 key 而拒绝。
  // previous 已 private 时 assertPrivateWriteAllowed 放行，共用检查也不再拦截。
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient({ shared: true }), videoId: 1, fileKey: 'attachments/shared.pdf', visibility: 'private', previousVisibility: 'private' });
  assert.deepEqual(privacyCalls.at(-1), ['private', 'private']);
});

test('同 video 内的 key 不算共用（video_id <> $2 排除自身）', async () => {
  // 查询返回自身（video_id 相同）不应触发共用拒绝；这里直接验证不抛错。
  await mod.assertVideoAttachmentWriteAllowed({ client: fakeClient(), videoId: 1, fileKey: 'attachments/self.pdf', visibility: 'private', previousVisibility: 'private' });
});
