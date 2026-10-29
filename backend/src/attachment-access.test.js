import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeAttachments, authorizeAttachment } from './attachment-access.js';
const privateRow = { id: 1, visibility: 'private', file_key: 'attachments/x', file_url: 'https://origin/x', file_name: 'secret', object_type: 'track_point', object_id: 7 };
test('private metadata absent for guests/students/disabled staff', () => {
  for (const viewer of [null, { role: 'student', status: 'active' }, { role: 'teacher', status: 'disabled' }]) assert.deepEqual(serializeAttachments([privateRow], viewer), []);
});
test('authorized private serialization has no permanent URL/key', () => {
  const [row] = serializeAttachments([privateRow], { role: 'teacher', status: 'active' });
  assert.equal(row.file_key, undefined); assert.equal(row.file_url, undefined); assert.match(row.download_endpoint, /1\/download-url/);
});
test('invalid source or ID cannot query arbitrary tables', async () => {
  for (const input of [{ id: -1 }, { id: 1, source: 'library' }, { id: NaN }]) assert.equal(await authorizeAttachment({}, input), null);
});
test('private authorization rejects student before querying parent or signing', async () => {
  let calls = 0;
  const row = await authorizeAttachment({ query: async () => { calls++; return { rows: [privateRow] }; } }, { id: 1, viewer: { role: 'student', status: 'active' } });
  assert.equal(row, null); assert.equal(calls, 1);
});
test('staff must have existing host; orphan attachment denied', async () => {
  let calls = 0;
  assert.equal(await authorizeAttachment({ query: async () => ({ rows: calls++ ? [] : [privateRow] }) }, { id: 1, viewer: { role: 'teacher', status: 'active' } }), null);
});
test('valid teacher can authorize private attachment with real parent', async () => {
  let calls = 0;
  assert.equal((await authorizeAttachment({ query: async () => ({ rows: calls++ ? [{ id: 7 }] : [privateRow] }) }, { id: 1, viewer: { role: 'teacher', status: 'active' } })).id, 1);
});
