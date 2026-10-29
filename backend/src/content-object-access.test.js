import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadContentObject, canAssignContentObject } from './content-object-access.js';
test('all polymorphic read types use bound IDs and fail closed on missing records', async () => {
  for (const type of ['track_point', 'knowledge_point', 'track_part', 'knowledge_part', 'track_collection', 'knowledge_collection', 'video']) {
    let captured;
    assert.equal(await canReadContentObject({ query: async (sql, params) => { captured = sql; assert.deepEqual(params, [42]); return { rows: [] }; } }, type, 42, null), false);
    assert.match(captured, /\$1/);
    assert.match(captured, /public/);
  }
});
test('staff read bypass requires active server-verified role; unknown types deny', async () => {
  assert.equal(await canReadContentObject({}, 'track_point', 1, { role: 'teacher', status: 'active' }), true);
  assert.equal(await canReadContentObject({}, 'invalid', 1, null), false);
});
test('assignability never bypasses via staff viewer; guest semantics enforced', async () => {
  // canAssignContentObject uses a fixed guest viewer, so a private target returns
  // false even if the caller would otherwise be staff. It delegates to the SQL
  // result (empty rows => not assignable).
  const publicClient = { query: async () => ({ rows: [{}] }) };
  const privateClient = { query: async () => ({ rows: [] }) };
  for (const type of ['track_point', 'knowledge_point', 'track_part', 'knowledge_part', 'track_collection', 'knowledge_collection', 'video']) {
    assert.equal(await canAssignContentObject(publicClient, type, 1), true, `${type} public assignable`);
    assert.equal(await canAssignContentObject(privateClient, type, 1), false, `${type} private not assignable`);
  }
  // Unknown type denies regardless of client.
  assert.equal(await canAssignContentObject(publicClient, 'invalid', 1), false);
});
test('canAssignContentObject is independent of caller role (no staff short-circuit)', async () => {
  // The guest viewer must be fixed: passing a staff viewer to canReadContentObject
  // short-circuits, but canAssignContentObject must not accept any viewer argument.
  assert.equal(canAssignContentObject.length, 3, 'assignability takes (client, type, id) only');
});
