import test from 'node:test';
import assert from 'node:assert/strict';
import { VisibilityError } from './content-visibility.js';

const CONFIG_PATH = new URL('./content-privacy-config.js', import.meta.url).href;

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

test('CONTENT_PRIVACY_MODE 仍导出（兼容旧调用），且私密为常规业务默认 business', async () => {
  const { CONTENT_PRIVACY_MODE } = await loadConfig(undefined, undefined);
  assert.equal(CONTENT_PRIVACY_MODE, 'business');
});

test('validatePrivacyConfiguration 固定返回 business（无模式开关）', async () => {
  const mod = await loadConfig('off');
  assert.equal(mod.validatePrivacyConfiguration(), 'business');
  assert.equal(mod.validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'weird' }), 'business');
  assert.equal(mod.validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'enforced' }), 'business');
  assert.equal(mod.validatePrivacyConfiguration({}), 'business');
  assert.equal(mod.validatePrivacyConfiguration({ CONTENT_PRIVACY_MODE: 'business', NODE_ENV: 'production' }), 'business');
});

// 核心：各模式（含 off / enforced / 未知 / 缺省）在生产/非生产下均不再拦截私密写入。
for (const mode of ['business', 'off', 'local-preview', 'enforced', 'weird', '', undefined]) {
  for (const nodeEnv of ['production', 'development', undefined]) {
    test(`mode=${mode ?? '缺省'} / env=${nodeEnv ?? '缺省'}：私密附件始终可保存（不拦截）`, async () => {
      const { assertPrivateWriteAllowed } = await loadConfig(mode, nodeEnv);
      for (const previous of [undefined, null, '', 'public', 'private']) {
        assert.doesNotThrow(() => assertPrivateWriteAllowed('private', previous));
      }
    });
  }
}

test('非 private 写入始终放行', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off');
  for (const prev of [undefined, null, '', 'public', 'private']) {
    assert.doesNotThrow(() => assertPrivateWriteAllowed('public', prev));
  }
});

test('previous=private 时 private/public 输入均放行（不重置旧 private）', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off');
  for (const next of ['private', 'public']) {
    assert.doesNotThrow(() => assertPrivateWriteAllowed(next, 'private'));
  }
  // 遗漏（undefined/''）属调用方 resolveVisibilityInput 的“保留旧值”职责，
  // 不应作为合法 next 进入本校验，此处确认其被本层拒绝。
  for (const bad of [undefined, '']) {
    assert.throws(() => assertPrivateWriteAllowed(bad, 'private'));
  }
});

test('非法 nextVisibility（含 undefined / 空串 / 未知值）被拒绝', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off', 'production');
  for (const bad of ['secret', 'internal', undefined, null, '']) {
    assert.throws(() => assertPrivateWriteAllowed(bad, 'public'), (err) => {
      assert.ok(err instanceof VisibilityError);
      assert.equal(err.code, 'INVALID_VISIBILITY');
      return true;
    });
  }
});

test('非法 previousVisibility 被拒绝（undefined / null / 空串仍允许）', async () => {
  const { assertPrivateWriteAllowed } = await loadConfig('off', 'production');
  for (const bad of ['secret', 'internal', 123]) {
    assert.throws(() => assertPrivateWriteAllowed('private', bad), (err) => {
      assert.ok(err instanceof VisibilityError);
      assert.equal(err.code, 'INVALID_VISIBILITY');
      return true;
    });
  }
  for (const ok of [undefined, null, '', 'public', 'private']) {
    assert.doesNotThrow(() => assertPrivateWriteAllowed('public', ok));
  }
});

test('business 模式：新变私密且存在前置引用不再被 PREREQUISITE_CONFLICT 阻断', async () => {
  const mod = await loadConfig('business', 'production');
  const client = { query: async (sql) => sql.includes('UPDATE')
    ? { rows: [{ id: 1, visibility: 'private' }] }
    : { rows: [] } };
  const refreshed = await mod.finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
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

test('finalizeCourseVisibility：新变私密且无需前置引用检查，直接放行返回 private', async () => {
  const mod = await loadConfig('local-preview', 'development');
  const client = {
    query: async (sql) => {
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      return { rows: [] };
    }
  };
  const refreshed = await mod.finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
});

test('finalizeCourseVisibility：新变私密但存在前置引用也不再被 PREREQUISITE_CONFLICT 阻断', async () => {
  const mod = await loadConfig('local-preview', 'development');
  const client = {
    query: async (sql) => {
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      return { rows: [] };
    }
  };
  const refreshed = await mod.finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
});

test('finalizeCourseVisibility：off 模式也不再拦截新私密写入（私密为常规业务）', async () => {
  const mod = await loadConfig('off');
  const client = {
    query: async (sql) => {
      if (sql.includes('UPDATE')) return { rows: [{ id: 1, visibility: 'private' }] };
      return { rows: [] };
    }
  };
  const refreshed = await mod.finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
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
