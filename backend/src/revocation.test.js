import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SRC_STORAGE = new URL('./storage.js', import.meta.url).href;
mock.module(SRC_STORAGE, {
  namedExports: {
    getKeyFromPublicUrl: (url) => String(url || '').replace(/^https?:\/\/[^/]+\/videos\//, '')
  }
});

const { collectRevocationKeys, getVideoObjectKeys, recordVisibilityRevocations } = await import('./revocation.js');

test('collectRevocationKeys：从完整 URL 与 key 中收集去重的对象 key', () => {
  const keys = collectRevocationKeys([
    { video_url: 'http://localhost:9000/videos/tracks/1/a.mp4', cover_url: 'http://localhost:9000/videos/library/covers/x.jpg' },
    { file_key: 'attachments/1/doc.pdf' },
    { video_url: 'http://localhost:9000/videos/tracks/1/a.mp4' } // 重复
  ]);
  assert.deepEqual(keys.sort(), ['attachments/1/doc.pdf', 'library/covers/x.jpg', 'tracks/1/a.mp4'].sort());
});

test('collectRevocationKeys：过滤空值与非法 key（含 ..）', () => {
  const keys = collectRevocationKeys([
    { video_url: '', cover_url: null },
    { file_key: '../etc/passwd' }
  ]);
  assert.deepEqual(keys, []);
});

test('getVideoObjectKeys：返回视频原画、转码与封面 key', async () => {
  const client = {
    query: async (sql, params) => {
      if (sql.includes('FROM videos WHERE id')) {
        return { rows: [{ video_url: 'http://x/videos/tracks/9/v.mp4', cover_url: 'http://x/videos/covers/9.jpg' }] };
      }
      return { rows: [{ video_url: 'http://x/videos/tracks/9/v-720p.mp4' }, { video_url: 'http://x/videos/tracks/9/v-1080p.mp4' }] };
    }
  };
  const keys = await getVideoObjectKeys(client, 9);
  assert.deepEqual(keys.sort(), ['covers/9.jpg', 'tracks/9/v-1080p.mp4', 'tracks/9/v-720p.mp4', 'tracks/9/v.mp4'].sort());
});

test('recordVisibilityRevocations：写入去重后的 key，空清单返回 0', async () => {
  const inserted = [];
  const client = { query: async (sql, params) => { inserted.push(params); return { rowCount: 1 }; } };
  const n = await recordVisibilityRevocations(client, {
    objectType: 'track_part', objectId: 5, keys: ['tracks/5/a.mp4', 'tracks/5/a.mp4', ''], reason: 'r', adminId: 1
  });
  assert.equal(n, 1);
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0].slice(0, 4), ['track_part', 5, 'tracks/5/a.mp4', 'r']);

  const emptyClient = { query: async () => { throw new Error('should not be called'); } };
  assert.equal(await recordVisibilityRevocations(emptyClient, { objectType: 'x', objectId: 1, keys: [] }), 0);
});
