import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVisibilitySchema, VISIBILITY_TABLES } from './visibility-schema.js';
import { validatePrivacyConfiguration } from './content-privacy-config.js';
const PRIVATE_DEFAULT_TABLES = ['track_points', 'knowledge_points', 'track_collections', 'knowledge_collections'];
const isPrivateDefault = (table_name) => PRIVATE_DEFAULT_TABLES.includes(table_name);
const valid = () => VISIBILITY_TABLES.map((table_name) => ({ table_name, is_nullable: 'NO', data_type: 'text', has_check: true, column_default: `'${isPrivateDefault(table_name) ? 'private' : 'public'}'::text` }));
test('schema gate accepts migrated schema with read-only queries', async () => {
  await assertVisibilitySchema({ query: async (sql) => { assert.match(sql, /^SELECT/); return { rows: valid() }; } });
});
test('old schema fails before startup writes and names required migration', async () => {
  await assert.rejects(assertVisibilitySchema({ query: async () => ({ rows: [] }) }), { code: 'VISIBILITY_SCHEMA_REQUIRED' });
});
test('missing constraints or wrong defaults fail closed', async () => {
  for (const field of ['has_check', 'column_default', 'is_nullable', 'data_type']) {
    const rows = valid(); rows[0][field] = null;
    await assert.rejects(assertVisibilitySchema({ query: async () => ({ rows }) }), { code: 'VISIBILITY_SCHEMA_REQUIRED' });
  }
});
test('both collections are enforced by the gate with private default', async () => {
  assert.deepEqual(VISIBILITY_TABLES.filter((t) => t.endsWith('collections')), ['track_collections', 'knowledge_collections']);
  // collections defaulting to public instead of private must fail closed.
  const rows = valid().map((r) => r.table_name === 'track_collections' || r.table_name === 'knowledge_collections' ? { ...r, column_default: "'public'::text" } : r);
  await assert.rejects(assertVisibilitySchema({ query: async () => ({ rows }) }), { code: 'VISIBILITY_SCHEMA_REQUIRED' });
  // correct private default passes.
  await assertVisibilitySchema({ query: async () => ({ rows: valid() }) });
});
test('only completely empty schema may bootstrap', async () => {
  await assertVisibilitySchema({ query: async () => ({ rows: [] }) }, { allowEmpty: true });
  let call = 0;
  await assert.rejects(assertVisibilitySchema({ query: async () => ({ rows: call++ ? [{}] : [] }) }, { allowEmpty: true }));
});
test('fresh Docker bootstrap with empty videos is allowed but populated legacy videos is refused', async () => {
  for (const populated of [false, true]) {
    let call = 0;
    const client = { query: async () => ({ rows: [[], [{ table_name: 'videos' }], populated ? [{ id: 1 }] : []][call++] }) };
    if (populated) await assert.rejects(assertVisibilitySchema(client, { allowEmpty: true }));
    else await assertVisibilitySchema(client, { allowEmpty: true });
  }
});
test('privacy configuration 固定返回 business（无模式开关，不再按模式回落）', () => {
  // 公开/私密已是常规业务功能，不再有部署模式门禁；配置固定返回 'business'。
  assert.equal(validatePrivacyConfiguration(), 'business');
  assert.equal(validatePrivacyConfiguration({}), 'business');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'local-preview', NODE_ENV: 'test' }), 'business');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'wrong' }), 'business');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'OFF' }), 'business');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'enforced' }), 'business');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'enforced', NODE_ENV: 'production' }), 'business');
});
