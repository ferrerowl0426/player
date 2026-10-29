import test from 'node:test';
import assert from 'node:assert/strict';
import { saveContentAttachments } from './attachment-save.js';
function fixture() {
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT \* FROM content_attachments/.test(sql)) return { rows: [{ id: 9, file_key: 'attachments/legacy.pdf', file_name: 'old', visibility: 'private', file_size: 0 }] };
    if (/SELECT id FROM track_points/.test(sql)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }, release() {} };
  return { calls, args: { pool: { connect: async () => client }, objectType: 'track_point', objectId: 1, ensureObjectExists: async () => {}, getPublicUrl: (key) => `https://origin/${key}` } };
}
test('legacy omitted visibility preserves private and stable ID', async () => {
  const { args, calls } = fixture();
  await saveContentAttachments({ ...args, values: [{ file_key: 'attachments/legacy.pdf', file_name: 'renamed' }] });
  const update = calls.find((c) => c.sql.startsWith('UPDATE content_attachments'));
  assert.equal(update.params[4], 'private'); assert.equal(update.params[5], 9);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});
test('foreign ID fails and transaction rolls back', async () => {
  const { args, calls } = fixture();
  await assert.rejects(saveContentAttachments({ ...args, values: [{ id: 333, file_key: 'attachments/legacy.pdf' }] }));
  assert.equal(calls.at(-1).sql, 'ROLLBACK'); assert.equal(calls.some((c) => c.sql === 'COMMIT'), false);
});
test('malformed arrays never mean delete all', async () => {
  const { args, calls } = fixture();
  await assert.rejects(saveContentAttachments({ ...args, values: null })); assert.equal(calls.length, 0);
});
test('new attachment cannot reuse another course namespace', async () => {
  const { args, calls } = fixture();
  await assert.rejects(saveContentAttachments({ ...args, values: [{ file_key: 'attachments/track_point/222/file.pdf', file_name: 'x' }] }));
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});
