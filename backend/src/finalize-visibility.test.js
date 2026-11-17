// 验证 finalizeCourseVisibility（两 router 共用的“刷新派生可见性 + 私密写入开关 + 前置引用冲突”核心）。
// 不连接真实数据库：用受控假 client 驱动 refresh 的返回可见性与 prerequisites 命中情况。
// 通过动态重新加载 content-privacy-config.js 并切换 CONTENT_PRIVACY_MODE 来验证各模式行为。
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadConfigWithMode(mode) {
  const prev = process.env.CONTENT_PRIVACY_MODE;
  process.env.CONTENT_PRIVACY_MODE = mode;
  const mod = await import('./content-privacy-config.js?cache=' + Math.random());
  process.env.CONTENT_PRIVACY_MODE = prev; // 模块已在加载时捕获模式，恢复 env 不影响该实例
  return mod;
}

// 受控假 client：由 refreshedVisibility 决定 refresh 后父课程可见性；prereqRowCount 决定前置引用是否命中。
function makeClient({ refreshedVisibility, prereqRowCount = 0 }) {
  const calls = [];
  return {
    async query(sql) {
      calls.push(sql);
      if (/RETURNING id, visibility/.test(sql)) {
        return { rows: [{ id: 1, visibility: refreshedVisibility }], rowCount: 1 };
      }
      if (/FROM prerequisites WHERE prerequisite_type/.test(sql)) {
        return { rows: prereqRowCount > 0 ? [{ c: 1 }] : [], rowCount: prereqRowCount };
      }
      return { rows: [], rowCount: 0 };
    },
    _calls: calls
  };
}

test('refresh 后仍为公开：直接返回，且不查前置引用', async () => {
  const { finalizeCourseVisibility } = await loadConfigWithMode('off');
  const client = makeClient({ refreshedVisibility: 'public' });
  const refreshed = await finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'public');
  assert.ok(!client._calls.some((s) => /FROM prerequisites/.test(s)), '公开时不应查 prerequisites');
});

test('off 模式：新变私密不再被拦截（私密为常规业务），直接返回 private', async () => {
  const { finalizeCourseVisibility } = await loadConfigWithMode('off');
  const client = makeClient({ refreshedVisibility: 'private', prereqRowCount: 1 });
  const refreshed = await finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
  assert.ok(!client._calls.some((s) => /FROM prerequisites/.test(s)), '不应查 prerequisites');
});

test('旧 private 遗漏不被重置：previous 已 private 时即使 refresh 仍 private 也不拦截', async () => {
  const { finalizeCourseVisibility } = await loadConfigWithMode('off');
  const client = makeClient({ refreshedVisibility: 'private', prereqRowCount: 1 });
  const refreshed = await finalizeCourseVisibility(client, 'track_point', 1, 'private');
  assert.equal(refreshed.visibility, 'private');
  assert.ok(!client._calls.some((s) => /FROM prerequisites/.test(s)), '旧 private 不触发前置引用检查');
});

test('local-preview 非生产：新变私密且有前置引用也不再被 PREREQUISITE_CONFLICT 阻断', async () => {
  delete process.env.NODE_ENV; // 非 production
  const { finalizeCourseVisibility } = await loadConfigWithMode('local-preview');
  const client = makeClient({ refreshedVisibility: 'private', prereqRowCount: 1 });
  const refreshed = await finalizeCourseVisibility(client, 'knowledge_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
  assert.ok(!client._calls.some((s) => /FROM prerequisites/.test(s)), '不再查 prerequisites');
});

test('local-preview 非生产：新变私密且无前置引用 -> 放行返回 private', async () => {
  delete process.env.NODE_ENV;
  const { finalizeCourseVisibility } = await loadConfigWithMode('local-preview');
  const client = makeClient({ refreshedVisibility: 'private', prereqRowCount: 0 });
  const refreshed = await finalizeCourseVisibility(client, 'knowledge_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
});

test('enforced 模式：新变私密也不再按未开放拦截（私密为常规业务）', async () => {
  const { finalizeCourseVisibility } = await loadConfigWithMode('enforced');
  const client = makeClient({ refreshedVisibility: 'private', prereqRowCount: 0 });
  const refreshed = await finalizeCourseVisibility(client, 'track_point', 1, 'public');
  assert.equal(refreshed.visibility, 'private');
});
