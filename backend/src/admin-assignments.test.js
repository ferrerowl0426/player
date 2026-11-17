// 针对 POST /api/admin/users/:userId/assignments 的可见性/竞态修复测试。
// 验证：
//   1) 目标存在性 + canAssignContentObject 与 INSERT 在「同一个事务 client」内执行；
//   2) BEGIN 之后首条语句是 lockVisibilityFamilies(client, ['track','knowledge'])（锁先于校验）；
//   3) 任意失败（存在性/私密）整批 ROLLBACK，不写入任何 user_assignments 记录；
//   4) 成功路径写入顺序与请求清单顺序一致，且仅在全部合法后写入；
//   5) 首个不合法对象被命中即返回，提示其标题，后续对象不再校验；
//   6) 仅 message 任务（无对象）仍写入一条 message 记录并提交。
// 不连接真实数据库；lockVisibilityFamilies 与 canAssignContentObject 由 mock.module
// 注入测试替身，仅验证「调用时机/参数/同 client」，真实语义由共享测试覆盖。
// 扩展自 knowledge-visibility.test.js 的路由 mock 套路；不触碰 visibility-http.test。
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SRC_DB = new URL('./db.js', import.meta.url).href;
const SRC_VISIBILITY = new URL('./content-visibility.js', import.meta.url).href;
const SRC_CONTENT_ACCESS = new URL('./content-object-access.js', import.meta.url).href;
const SRC_ADMIN = new URL('./admin.routes.js', import.meta.url).href;

import * as realContentVisibility from './content-visibility.js';
import * as realContentObjectAccess from './content-object-access.js';

// ---- 场景控制 ----
// missingKeys: "table:id" 形式的、存在性校验应返回空（404）的目标。
// privateIds: assignTargetId 集合，canAssignContentObject 应判为私密（409）。
let missingKeys = new Set();
let privateIds = new Set();
let lockCalls = [];          // 记录 lockVisibilityFamilies 调用
let assignCalls = [];        // 记录 canAssignContentObject(client, type, id) 调用
let insertCalls = [];        // 记录 INSERT INTO user_assignments 调用
let lastClient = null;

const mockLockVisibilityFamilies = async (client, families) => {
  lockCalls.push({ client, families });
  client._calls.push({ sql: '/* lockVisibilityFamilies */', params: families });
};

const mockCanAssignContentObject = async (client, type, id) => {
  assignCalls.push({ client, type, id });
  return !privateIds.has(id); // false => 私密，拒绝布置
};

function makeClient() {
  let committed = false;
  let rolledBack = false;
  let insertId = 0;
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*BEGIN/.test(sql)) return {};
      if (/^\s*COMMIT/.test(sql)) { committed = true; return {}; }
      if (/^\s*ROLLBACK/.test(sql)) { rolledBack = true; return {}; }
      // operation_id 取号
      if (/nextval\('user_assignments_operation_id_seq'\)/.test(sql)) return { rows: [{ operation_id: 9001 }], rowCount: 1 };
      // 写入作业记录（对象 INSERT：10 参数；message INSERT：6 参数）
      if (/INSERT INTO user_assignments/.test(sql)) {
        insertCalls.push({ sql, params });
        const isMessage = params.length === 6;
        return {
          rows: [{
            id: ++insertId,
            operation_id: params[0],
            user_id: params[1],
            video_id: isMessage ? null : params[2],
            object_type: isMessage ? 'message' : params[3],
            object_id: isMessage ? null : params[4],
            part_id: isMessage ? null : params[5],
            message: isMessage ? params[2] : '',
            practice_requirement: isMessage ? params[3] : params[6],
            submit_requirement: isMessage ? params[4] : params[7],
            is_deleted: false,
            delete_reason: null,
            deleted_at: null,
            created_at: new Date()
          }],
          rowCount: 1
        };
      }
      // 目标存在性校验：按表名 + id 决定是否存在，并返回标题。
      const m = /FROM (videos|track_points|track_collections|knowledge_points|knowledge_collections|track_parts|knowledge_parts)\b/.exec(sql);
      if (m) {
        const table = m[1];
        const id = params[0];
        if (missingKeys.has(`${table}:${id}`)) return { rows: [], rowCount: 0 };
        const isPart = table.endsWith('_parts');
        const row = {
          id,
          title: `title-${table}-${id}`,
          part_id: isPart ? id : null,
          video_id: table === 'videos' ? id : null
        };
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  client._committed = () => committed;
  client._rolledBack = () => rolledBack;
  client._calls = calls;
  lastClient = client;
  return client;
}

const fakePool = {
  connect: async () => makeClient(),
  async query(sql, params) {
    // findUserById：返回 active 学员（SQL 含换行，用宽松匹配）。
    if (/FROM users[\s\S]*WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: params[0], username: 'u1', nickname: 'U', class_id: 1, is_active: true, is_marked: false, created_at: new Date() }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
};

let mod;
test.before(async () => {
  process.env.CONTENT_PRIVACY_MODE = 'local-preview';
  delete process.env.NODE_ENV;
  mock.module(SRC_DB, { namedExports: { pool: fakePool } });
  mock.module(SRC_VISIBILITY, {
    namedExports: { ...realContentVisibility, lockVisibilityFamilies: mockLockVisibilityFamilies }
  });
  mock.module(SRC_CONTENT_ACCESS, {
    namedExports: { ...realContentObjectAccess, canAssignContentObject: mockCanAssignContentObject }
  });
  mod = await import(SRC_ADMIN);
});
test.after(() => { mock.reset(); });

beforeEach(() => {
  missingKeys = new Set();
  privateIds = new Set();
  lockCalls = [];
  assignCalls = [];
  insertCalls = [];
  lastClient = null;
});

function extractHandler(router, path, method) {
  for (const layer of router.stack) {
    const route = layer.route;
    if (route && route.path === path && route.methods[method]) {
      return route.stack[route.stack.length - 1].handle;
    }
  }
  throw new Error(`handler ${method.toUpperCase()} ${path} not found`);
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; }
  };
}

function assertLockFirstAfterBegin(client) {
  const beginIdx = client._calls.findIndex((c) => /^\s*BEGIN/.test(c.sql));
  const lockIdx = client._calls.findIndex((c) => c.sql === '/* lockVisibilityFamilies */');
  assert.ok(beginIdx >= 0, '应执行 BEGIN');
  assert.ok(lockIdx >= 0, '应调用 lockVisibilityFamilies');
  assert.equal(lockIdx, beginIdx + 1, 'lockVisibilityFamilies 须为 BEGIN 后首条语句');
}

// 校验/写入全部发生在同一个事务 client，且锁先于任何目标查询与插入。
function assertSameClientForAll() {
  assert.ok(lastClient, '应拿到事务 client');
  assert.ok(assignCalls.every((c) => c.client === lastClient), 'canAssignContentObject 须与 INSERT 同一 client');
}

// ---------- 成功路径 ----------

test('成功：校验与插入同一 client，锁先于校验，写入顺序与清单一致', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: {
      objects: [
        { objectType: 'video', objectId: 11 },
        { objectType: 'track_point', objectId: 22 },
        { objectType: 'knowledge_point', objectId: 33 }
      ]
    }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201, `应 201，实际 ${res.statusCode}`);
  assertLockFirstAfterBegin(lastClient);
  assert.deepEqual(lockCalls[0].families, ['track', 'knowledge'], '锁家族须为 [\'track\',\'knowledge\']');
  assertSameClientForAll();
  // 三个对象全部通过校验
  assert.equal(assignCalls.length, 3, '三个对象都应被 canAssign 校验');
  // 写入 3 条，顺序与清单一致
  assert.equal(insertCalls.length, 3, '应写入 3 条作业记录');
  assert.deepEqual(insertCalls.map((c) => c.params[4]), [11, 22, 33], 'object_id 写入顺序应与清单一致');
  assert.deepEqual(insertCalls.map((c) => c.params[3]), ['video', 'track_point', 'knowledge_point'], 'object_type 顺序应与清单一致');
  // 校验/锁 都先于写入
  const lockIdx = lastClient._calls.findIndex((c) => c.sql === '/* lockVisibilityFamilies */');
  const firstInsertIdx = lastClient._calls.findIndex((c) => /INSERT INTO user_assignments/.test(c.sql));
  assert.ok(firstInsertIdx > lockIdx, '写入须在家族锁之后');
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
});

// ---------- 失败路径：整批回滚，无插入 ----------

test('私密失败：命中首个私密对象即整批 ROLLBACK，无插入，提示首个标题', async () => {
  // 清单：video(11) 合法 -> video(12) 私密 -> video(13) 合法。
  privateIds = new Set([12]); // assignTargetId = objectId = 12
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [
      { objectType: 'video', objectId: 11 },
      { objectType: 'video', objectId: 12 },
      { objectType: 'video', objectId: 13 }
    ] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 409, `应 409，实际 ${res.statusCode}`);
  // 仅校验了前两个对象（11 通过、12 私密），13 不再校验
  assert.equal(assignCalls.length, 2, '命中首个私密后应停止校验后续对象');
  assert.deepEqual(assignCalls.map((c) => c.params?.[1] ?? c.id), [11, 12], 'canAssign 参数 id 应为 11、12');
  // 提示的是第一个私密对象的标题（id=12）
  assert.ok(res.body.message.includes('title-videos-12'), `应提示首个私密标题，实际：${res.body.message}`);
  assert.ok(!res.body.message.includes('title-videos-13'), '不应提示后续合法对象');
  // 整批回滚，无任何插入
  assert.equal(insertCalls.length, 0, '失败路径不应写入任何记录');
  assert.ok(lastClient._rolledBack(), '应回滚事务');
  assert.ok(!lastClient._committed(), '不应提交');
  assertSameClientForAll();
});

test('存在性失败：命中首个不存在对象即整批 ROLLBACK，无插入', async () => {
  // 清单：video(11) 合法 -> video(99) 不存在 -> video(13) 合法。
  missingKeys = new Set(['videos:99']);
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [
      { objectType: 'video', objectId: 11 },
      { objectType: 'video', objectId: 99 },
      { objectType: 'video', objectId: 13 }
    ] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 404, `应 404，实际 ${res.statusCode}`);
  // 11 通过存在性+私密；99 存在性失败（不进入 canAssign）；13 不再校验
  assert.equal(assignCalls.length, 1, '存在性失败后不再校验后续对象');
  assert.equal(insertCalls.length, 0, '失败路径不应写入任何记录');
  assert.ok(lastClient._rolledBack(), '应回滚事务');
  assert.ok(!lastClient._committed(), '不应提交');
  // 错误文案首字含“推送对象不存在”
  assert.ok(res.body.message.startsWith('推送对象不存在：video 99'), `文案不符：${res.body.message}`);
});

test('部分私密：首个私密对象前合法对象已校验，但整批仍无插入', async () => {
  // 验证“全部合法才写入”——即便前 N 个已通过，只要后续有私密，整批都不写。
  privateIds = new Set([33]); // 第三个（knowledge_point 33）
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [
      { objectType: 'video', objectId: 11 },
      { objectType: 'track_point', objectId: 22 },
      { objectType: 'knowledge_point', objectId: 33 }
    ] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 409);
  assert.equal(assignCalls.length, 3, '前两个合法 + 第三个私密，共校验 3 次');
  assert.equal(insertCalls.length, 0, '只要有一个不合法，整批都不写入');
  assert.ok(lastClient._rolledBack());
  assert.ok(!lastClient._committed());
});

// ---------- 消息任务 / 参数校验保留 ----------

test('仅 message 任务（无对象）：写入一条 message 记录并提交', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { message: '请复习上周内容', practiceRequirement: '', submitRequirement: '' }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201, `应 201，实际 ${res.statusCode}`);
  assertLockFirstAfterBegin(lastClient);
  assert.equal(insertCalls.length, 1, '仅 message 应写入一条记录');
  assert.ok(insertCalls[0].sql.includes("'message'"), '记录类型应为 message（SQL 字面量）');
  assert.equal(insertCalls[0].params[2], '请复习上周内容', 'message 内容应写入参数');
  assert.ok(lastClient._committed(), '应提交事务');
  assert.ok(!lastClient._rolledBack(), '不应回滚');
});

test('对象 + 练习要求：写入对象记录，且锁在 BEGIN 后首条', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: {
      objects: [{ objectType: 'track_collection', objectId: 7 }],
      practiceRequirement: '完成练习'
    }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assertLockFirstAfterBegin(lastClient);
  assert.equal(insertCalls.length, 1, '应仅写入对象记录');
  assert.equal(insertCalls[0].params[3], 'track_collection');
  assert.ok(lastClient._committed());
});

test('不支持的对象类型：保持在事务外校验，返回 400', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [{ objectType: 'bogus', objectId: 1 }] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 400, '不支持类型应 400');
  assert.ok(res.body.message.includes('不支持的推送对象类型'), `文案不符：${res.body.message}`);
  // 根本不应进入事务（无 BEGIN）
  assert.equal(lastClient, null, '类型校验失败不应开启事务');
});

// ---------- B2：分 P 输入规范化、去重、快照 ----------

test('分P两种输入（objectId=P / 父ID+partId=P）规范化为同一稳定ID并去重为一条', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [
      { objectType: 'track_part', objectId: 55 },                 // 仅传 P id
      { objectType: 'track_part', objectId: 12, partId: 55 },     // 父课程 ID + partId
      { objectType: 'track_part', objectId: 55 }                  // 与第一条完全重复
    ] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201, `应 201，实际 ${res.statusCode}`);
  // 完全重复的一条在原始 key 阶段就被去掉；两种形态（objectId=P / 父ID+partId=P）各校验一次。
  assert.equal(assignCalls.length, 2, '两种 P 输入形态都应校验');
  assert.ok(assignCalls.every((c) => c.id === 55), `校验 id 应为稳定 P id 55：${JSON.stringify(assignCalls)}`);
  // 规范化后同一 type+稳定ID 只写一条
  assert.equal(insertCalls.length, 1, '规范化去重后只写一条');
  assert.equal(insertCalls[0].params[3], 'track_part', 'object_type 写入正确');
  assert.equal(insertCalls[0].params[4], 55, 'object_id 写入稳定 P id');
  assert.equal(insertCalls[0].params[5], 55, 'part_id 写入稳定 P id（不能为 null）');
  assert.ok(lastClient._committed(), '应提交事务');
});

test('仅传objectId=P的旧兼容输入：object_id 与 part_id 均落稳定 P id', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [{ objectType: 'knowledge_part', objectId: 77 }] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].params[4], 77, 'object_id=77');
  assert.equal(insertCalls[0].params[5], 77, 'part_id=77（兼容形态不能落 null）');
});

test('快照只在布置时写入：INSERT 带标题快照且事务内无任何 UPDATE user_assignments', async () => {
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 1, role: 'super_admin' },
    body: { objects: [{ objectType: 'video', objectId: 11 }], practiceRequirement: '做完练习' }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(insertCalls[0].params[9], 'title-videos-11', '布置时标题快照写入 assigned_*_title');
  const updates = lastClient._calls.filter((c) => /UPDATE\s+user_assignments/i.test(c.sql));
  assert.equal(updates.length, 0, '写入路径不应 UPDATE 快照列');
});

test('权限失败（非超管且无班级）：403，不开启事务、不写任何记录', async () => {
  // 让 findAdminClassIds 返回空：fakePool 默认对 teacher_classes 查询返回空行。
  const handler = extractHandler(mod.adminRouter, '/users/:userId/assignments', 'post');
  const req = {
    params: { userId: '5' },
    admin: { adminId: 9, role: 'teacher' },
    body: { objects: [{ objectType: 'video', objectId: 11 }] }
  };
  const res = makeRes();
  await handler(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 403, `应 403，实际 ${res.statusCode}`);
  assert.equal(lastClient, null, '权限失败不应开启事务');
  assert.equal(insertCalls.length, 0, '不应写入记录');
});
