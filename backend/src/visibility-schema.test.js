import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVisibilitySchema, VISIBILITY_TABLES } from './visibility-schema.js';
import { validatePrivacyConfiguration } from './content-privacy-config.js';
const valid = () => VISIBILITY_TABLES.map((table_name) => ({ table_name, is_nullable: 'NO', data_type: 'text', has_check: true, column_default: `'${table_name.endsWith('points') ? 'private' : 'public'}'::text` }));
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
test('privacy startup configuration is strict and production-safe', () => {
  assert.equal(validatePrivacyConfiguration({}), 'off');
  assert.equal(validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'local-preview', NODE_ENV: 'test' }), 'local-preview');
  for (const env of [{ CONTENT_PRIVACY_MODE: 'wrong' }, { CONTENT_PRIVACY_MODE: 'OFF' }, { CONTENT_PRIVACY_MODE: 'local-preview', NODE_ENV: 'production' }, { CONTENT_PRIVACY_MODE: 'enforced' }]) assert.throws(() => validatePrivacyConfiguration(env));
});
