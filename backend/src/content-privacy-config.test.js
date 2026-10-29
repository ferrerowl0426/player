import test from 'node:test';
import assert from 'node:assert/strict';

const CONFIG_PATH = 'file:///C:/Users/user/Desktop/播放器/backend/src/content-privacy-config.js';

async function loadConfig(mode, nodeEnv) {
  const savedMode = process.env.CONTENT_PRIVACY_MODE;
  const savedNode = process.env.NODE_ENV;
  if (mode === undefined) delete process.env.CONTENT_PRIVACY_MODE;
  else process.env.CONTENT_PRIVACY_MODE = mode;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  const mod = await import(`${CONFIG_PATH}?cache=${Math.random()}`);
  if (savedMode === undefined) delete process.env.CONTENT_PRIVACY_MODE;
  else process.env.CONTENT_PRIVACY_MODE = savedMode;
  if (savedNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNode;
  return mod;
}

test('默认模式为 off', async () => {
  const { CONTENT_PRIVACY_MODE } = await loadConfig(undefined, undefined);
  assert.equal(CONTENT_PRIVACY_MODE, 'off');
});

test('非 private 写入始终放行', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off');
  for (const prev of [undefined, null, '', 'public', 'private']) {
    assert.doesNotThrow(() => assertPrivateWriteAllowed('public', prev));
  }
});

test('已为 private 的遗漏不被重置（保留旧 private）', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off');
  for (const next of ['private', undefined, '']) {
    assert.doesNotThrow(() => assertPrivateWriteAllowed(next, 'private'));
  }
});

test('off 模式拦截所有新的私密写入', async () => {
  const { assertPrivateWriteAllowed, PrivateWriteDisabledError } = await loadConfig('off');
  for (const prev of [undefined, null, '', 'public']) {
    await assert.rejects(async () => assertPrivateWriteAllowed('private', prev), (err) => {
      assert.ok(err instanceof PrivateWriteDisabledError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PRIVATE_WRITE_DISABLED');
      return true;
    });
  }
});

test('local-preview 仅非生产环境放行新的私密写入', async () => {
  const dev = await loadConfig('local-preview', 'development');
  const env = process.env.NODE_ENV;
  // 非生产环境放行
  assert.doesNotThrow(() => dev.assertPrivateWriteAllowed('private', 'public'));
  // 生产环境下本函数动态读取 NODE_ENV，临时置为 production 验证被拦截
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(async () => dev.assertPrivateWriteAllowed('private', 'public'), (err) => {
      assert.ok(err instanceof dev.PrivateWriteDisabledError);
      return true;
    });
  } finally {
    process.env.NODE_ENV = env;
  }
});

test('enforced 暂禁：仍按未开放处理', async () => {
  const { assertPrivateWriteAllowed, PrivateWriteDisabledError } = await loadConfig('enforced');
  await assert.rejects(async () => assertPrivateWriteAllowed('private', 'public'), (err) => {
    assert.ok(err instanceof PrivateWriteDisabledError);
    return true;
  });
});

test('未知模式按 off 处理', async () => {
  const { assertPrivateWriteAllowed, PrivateWriteDisabledError } = await loadConfig('weird');
  await assert.rejects(async () => assertPrivateWriteAllowed('private', 'public'), (err) => {
    assert.ok(err instanceof PrivateWriteDisabledError);
    return true;
  });
});

test('courseBecamePrivate 仅在“新变私密”时为真', async () => {
  const { courseBecamePrivate } = await loadConfig('off');
  assert.equal(courseBecamePrivate('private', 'public'), true);
  assert.equal(courseBecamePrivate('private', undefined), true);
  assert.equal(courseBecamePrivate('private', 'private'), false);
  assert.equal(courseBecamePrivate('public', 'private'), false);
  assert.equal(courseBecamePrivate('public', 'public'), false);
});

test('hasPrerequisiteReferences 查真实 prerequisites 表', async () => {
  const { hasPrerequisiteReferences } = await loadConfig('off');
  const calls = [];
  const yes = { query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1 }; } };
  const no = { query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 0 }; } };
  assert.equal(await hasPrerequisiteReferences(yes, 'track_point', 7), true);
  assert.equal(await hasPrerequisiteReferences(no, 'knowledge_point', 9), false);
  const call = calls[0];
  assert.match(call.sql, /prerequisites/);
  assert.match(call.sql, /prerequisite_type = \$1 AND prerequisite_id = \$2/);
  assert.deepEqual(call.values, ['track_point', 7]);
});

test('finalizeCourseVisibility：新变私密且无前置引用时放行（仍执行前置引用检查）', async () => {
  const mod = await loadConfig('local-preview', 'development');
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      if (sql.includes('prerequisites')) return { rowCount: 0 }; // 无冲突
      return { rows: [] };
    }
  };
  const refreshed = await mod.finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
  // 新变私密必须执行前置引用检查
  assert.ok(calls.some((s) => s.includes('prerequisites')));
});

test('finalizeCourseVisibility：新变私密但存在前置引用时 409 回滚', async () => {
  const mod = await loadConfig('local-preview', 'development');
  const client = {
    query: async (sql) => {
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      if (sql.includes('prerequisites')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return { rows: [] };
    }
  };
  await assert.rejects(() => mod.finalizeCourseVisibility(client, 'track_point', 1, 'public'), (err) => {
    assert.ok(err instanceof mod.PrerequisiteConflictError);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'PREREQUISITE_CONFLICT');
    return true;
  });
});

test('finalizeCourseVisibility：off 模式拦截新私密写入', async () => {
  const mod = await loadConfig('off');
  const client = {
    query: async (sql) => {
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      return { rows: [] };
    }
  };
  await assert.rejects(() => mod.finalizeCourseVisibility(client, 'track_point', 1, 'public'), (err) => {
    assert.ok(err instanceof mod.PrivateWriteDisabledError);
    return true;
  });
});

test('findPrivatePartPrerequisiteConflicts 查 P 级前置引用', async () => {
  const { findPrivatePartPrerequisiteConflicts } = await loadConfig('off');
  const calls = [];
  const yes = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [{ prerequisite_type: 'track_part', prerequisite_id: 5 }] }; } };
  const no = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  assert.equal((await findPrivatePartPrerequisiteConflicts(yes, 'track_point', 5)).length, 1);
  assert.equal((await findPrivatePartPrerequisiteConflicts(no, 'knowledge_point', 9)).length, 0);
  const call = calls[0];
  assert.match(call.sql, /prerequisites/);
  assert.match(call.sql, /prerequisite_type = \$1 AND prerequisite_id = \$2/);
  assert.deepEqual(call.values, ['track_part', 5]);
});
test('findPrivatePartPrerequisiteConflicts 将课程类型映射为 P 类型', async () => {
  const { findPrivatePartPrerequisiteConflicts } = await loadConfig('off');
  const captured = [];
  await findPrivatePartPrerequisiteConflicts({ query: async (sql, values) => { captured.push(values); return { rows: [] }; } }, 'knowledge_point', 3);
  assert.deepEqual(captured[0], ['knowledge_part', 3]);
});
