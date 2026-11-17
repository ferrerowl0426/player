// auth-version-schema 启动门禁测试：列存在且口径正确则放行；缺列 / 类型 / 可空 / 默认值
// 任一不符则抛出 AUTH_VERSION_SCHEMA_REQUIRED，强制先执行显式迁移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthVersionSchema } from './auth-version-schema.js';

function makeClient(rows) {
  return { async query() { return { rows }; } };
}

const validRow = (table) => ({ table_name: table, is_nullable: 'NO', column_default: '0', data_type: 'integer' });

test('两表均符合口径 → 不抛错', async () => {
  const client = makeClient([validRow('admins'), validRow('users')]);
  await assert.doesNotReject(() => assertAuthVersionSchema(client));
});

async function expectRejection(client) {
  try {
    await assertAuthVersionSchema(client);
    assert.fail('expected rejection');
  } catch (error) {
    return error;
  }
}

test('缺 auth_version 列 → 抛 AUTH_VERSION_SCHEMA_REQUIRED', async () => {
  const client = makeClient([
    { table_name: 'admins', is_nullable: null, column_default: null, data_type: null },
    validRow('users')
  ]);
  const error = await expectRejection(client);
  assert.equal(error.code, 'AUTH_VERSION_SCHEMA_REQUIRED');
});

test('类型不是 integer → 抛错', async () => {
  const client = makeClient([
    { table_name: 'admins', is_nullable: 'NO', column_default: '0', data_type: 'bigint' },
    validRow('users')
  ]);
  const error = await expectRejection(client);
  assert.equal(error.code, 'AUTH_VERSION_SCHEMA_REQUIRED');
});

test('列可空 → 抛错', async () => {
  const client = makeClient([
    { table_name: 'admins', is_nullable: 'YES', column_default: '0', data_type: 'integer' },
    validRow('users')
  ]);
  const error = await expectRejection(client);
  assert.equal(error.code, 'AUTH_VERSION_SCHEMA_REQUIRED');
});

test('默认值不是 0 → 抛错', async () => {
  const client = makeClient([
    { table_name: 'admins', is_nullable: 'NO', column_default: '1', data_type: 'integer' },
    validRow('users')
  ]);
  const error = await expectRejection(client);
  assert.equal(error.code, 'AUTH_VERSION_SCHEMA_REQUIRED');
});

test('allowEmpty 且仅有空 videos 表 → 不抛错（新装库未建业务表）', async () => {
  const client = makeClient([]);
  await assert.doesNotReject(() => assertAuthVersionSchema(client, { allowEmpty: true }));
});
