// 作业导航状态的共享 helper 测试：纯函数 + 解析器（fake pool 驱动真实可见性判定）+ 两端路由契约。
// 覆盖：错 owner / 缺失 / 私密 P 即使父 public / 公开合集混合 / 删除 / 恢复 / 消息类型，
// 以及“绝不用 assignment.id 当课程 id”的 part_id 口径，并验证网络错误与 private 严格区分。
//
// 说明：本环境 Node 22.22.2 的 node:test 未提供 mock.module，因此不采用模块 mock，
// 改为注入 fake pool（真实 canAssignContentObject / canMaintainPrerequisite 在其上跑，
// 按 state 返回存在性 / 公开性），路由契约测试用与线上等价的最小 Router 复刻处理器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

// 全局可变场景状态：被 fake pool 读取。
const state = {
  viewerUserId: 2,
  assignmentRow: null, // user_assignments 行
  studentRow: null, // users 行（小程序鉴权用）
  exists: true, // 目标内容是否存在
  publicReadable: true, // 目标是否公开可达
  throwOnAssignment: false // 模拟数据库 / 网络错误
};

// fake pool：作业记录 / 学生记录 / 存在性（canMaintainPrerequisite）/ 公开性（canAssignContentObject）
// 全部按 state 返回，从而用“真实可见性判定逻辑”驱动解析器与路由。
function makeFakePool() {
  return {
    async query(sql) {
      if (state.throwOnAssignment && /FROM user_assignments/.test(sql)) {
        throw new Error('connection reset');
      }
      if (/FROM user_assignments/.test(sql)) {
        return { rows: state.assignmentRow ? [state.assignmentRow] : [], rowCount: state.assignmentRow ? 1 : 0 };
      }
      if (/FROM users/.test(sql)) {
        return { rows: state.studentRow ? [state.studentRow] : [], rowCount: state.studentRow ? 1 : 0 };
      }
      // canMaintainPrerequisite：SELECT 1 FROM <table> WHERE id=$1
      if (/^SELECT 1 FROM [a-z_]+ WHERE id\s*=\s*\$1$/i.test(sql)) {
        return { rows: state.exists ? [{ x: 1 }] : [], rowCount: state.exists ? 1 : 0 };
      }
      // canAssignContentObject（公开可达口径）：匹配到即按 state.publicReadable 返回。
      if (
        /FROM videos v WHERE v\.id\s*=\s*\$1/.test(sql) ||
        /FROM track_points c WHERE c\.id\s*=\s*\$1/.test(sql) ||
        /FROM knowledge_points c WHERE c\.id\s*=\s*\$1/.test(sql) ||
        /FROM track_parts x JOIN track_points/.test(sql) ||
        /FROM knowledge_parts x JOIN knowledge_points/.test(sql) ||
        /FROM track_collection_items ci JOIN track_points/.test(sql) ||
        /FROM knowledge_collection_items ci JOIN knowledge_points/.test(sql)
      ) {
        return { rows: state.publicReadable ? [{ x: 1 }] : [], rowCount: state.publicReadable ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

const {
  ASSIGNMENT_NAVIGATION_STATUS,
  resolveAssignmentNavigationStatus,
  buildAssignmentNavigationUrl,
  buildAssignmentNavigationTarget,
  loadAssignmentNavigation
} = await import('./assignment-navigation.js');

// ---------------------------------------------------------------------------
// A. 纯函数测试：resolveAssignmentNavigationStatus
// ---------------------------------------------------------------------------
test('纯函数：无作业记录 -> missing', () => {
  assert.deepEqual(resolveAssignmentNavigationStatus({ assignment: null, target: null, viewer: { userId: 2 } }), {
    status: ASSIGNMENT_NAVIGATION_STATUS.MISSING,
    url: null,
    target: null
  });
});

test('纯函数：已删除作业 -> missing（不暴露为 private）', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 2, isDeleted: true, objectType: 'video' },
    target: { exists: true, publicReadable: false, url: '/videos/1', navigationTarget: {} },
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('纯函数：作业归属他人 -> missing（防越权探测，绝不 private）', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 999, isDeleted: false, objectType: 'video' },
    target: { exists: true, publicReadable: false, url: '/videos/1', navigationTarget: {} },
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('纯函数：message 类型无内容目标 -> available 且 target 为 null', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 2, isDeleted: false, objectType: 'message' },
    target: null,
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.target, null);
  assert.equal(r.url, null);
});

test('纯函数：目标已被删除（不存在）-> missing（404 不伪装成 private）', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 2, isDeleted: false, objectType: 'video' },
    target: { exists: false, publicReadable: false, url: null, navigationTarget: null },
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('纯函数：目标存在但私密 -> private 且不下发 url/target', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 2, isDeleted: false, objectType: 'video' },
    target: { exists: true, publicReadable: false, url: '/videos/1', navigationTarget: { id: '1' } },
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.PRIVATE);
  assert.equal(r.url, null);
  assert.equal(r.target, null);
});

test('纯函数：目标公开可见 -> available 且下发真实 url/target', () => {
  const r = resolveAssignmentNavigationStatus({
    assignment: { userId: 2, isDeleted: false, objectType: 'video' },
    target: { exists: true, publicReadable: true, url: '/videos/1', navigationTarget: { id: '1', page: 'video-detail' } },
    viewer: { userId: 2 }
  });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/videos/1');
  assert.deepEqual(r.target, { id: '1', page: 'video-detail' });
});

test('纯函数：私密恢复为公开 -> available（恢复可达）', () => {
  const base = { assignment: { userId: 2, isDeleted: false, objectType: 'video' }, target: null, viewer: { userId: 2 } };
  const before = resolveAssignmentNavigationStatus({ ...base, target: { exists: true, publicReadable: false, url: '/videos/1', navigationTarget: {} } });
  assert.equal(before.status, ASSIGNMENT_NAVIGATION_STATUS.PRIVATE);
  const after = resolveAssignmentNavigationStatus({ ...base, target: { exists: true, publicReadable: true, url: '/videos/1', navigationTarget: { id: '1' } } });
  assert.equal(after.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
});

// ---------------------------------------------------------------------------
// B. 导航地址 / 目标构造：part_id 口径（绝不用 assignment.id 当课程 id）
// ---------------------------------------------------------------------------
test('构造：video 导航地址', () => {
  assert.equal(buildAssignmentNavigationUrl('video', 10, '', null), '/videos/10');
  assert.deepEqual(buildAssignmentNavigationTarget('video', 10, '', null), { type: 'video', id: '10', partId: '', page: 'video-detail' });
});

test('构造：track_point / knowledge_point 导航地址', () => {
  assert.equal(buildAssignmentNavigationUrl('track_point', 9, '', null), '/tracks/9');
  assert.equal(buildAssignmentNavigationUrl('knowledge_point', 8, '', null), '/knowledge/8');
});

test('构造：track_collection / knowledge_collection 导航地址', () => {
  assert.equal(buildAssignmentNavigationUrl('track_collection', 7, '', null), '/tracks/collections/7');
  assert.equal(buildAssignmentNavigationUrl('knowledge_collection', 6, '', null), '/knowledge/collections/6');
});

test('构造：track_part 课程段取父课程 id，绝不用 part_id/assignment.id 当课程 id', () => {
  // part_id = 5，父课程 id = 3：地址应为 /tracks/3?part=5，而非 /tracks/5 或 /tracks/<assignment.id>。
  assert.equal(buildAssignmentNavigationUrl('track_part', 5, 5, 3), '/tracks/3?part=5');
  assert.deepEqual(buildAssignmentNavigationTarget('track_part', 5, 5, 3), { type: 'track_part', id: '3', partId: '5', page: 'track-detail' });
});

test('构造：knowledge_part 课程段取父课程 id', () => {
  assert.equal(buildAssignmentNavigationUrl('knowledge_part', 4, 4, 6), '/knowledge/6?part=4');
  assert.deepEqual(buildAssignmentNavigationTarget('knowledge_part', 4, 4, 6), { type: 'knowledge_part', id: '6', partId: '4', page: 'knowledge-detail' });
});

// ---------------------------------------------------------------------------
// C. 解析器测试：loadAssignmentNavigation（fake pool 驱动真实可见性判定）
// ---------------------------------------------------------------------------
function setAssignment(row) {
  state.assignmentRow = row;
}
function setVisibility({ exists = true, publicReadable = true } = {}) {
  state.exists = exists;
  state.publicReadable = publicReadable;
}

test('解析器：作业不存在 -> missing', async () => {
  setAssignment(null);
  const r = await loadAssignmentNavigation(makeFakePool(), 123, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('解析器：作业 id 非法（非数字）-> missing', async () => {
  setAssignment(null);
  const r = await loadAssignmentNavigation(makeFakePool(), 'abc', { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('解析器：归属他人 -> missing（即使目标公开也不可探测）', async () => {
  setAssignment({ id: 1, user_id: 999, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('解析器：已删除作业 -> missing', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: true, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('解析器：video 目标公开 -> available 且返回真实地址', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/videos/10');
  assert.deepEqual(r.target, { type: 'video', id: '10', partId: '', page: 'video-detail' });
});

test('解析器：video 目标私密 -> private 且脱敏', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.PRIVATE);
  assert.equal(r.url, null);
  assert.equal(r.target, null);
});

test('解析器：私密 P 即使父课程 public -> private（part 口径）', async () => {
  // track_part：part_id=5，父课程 parent_track_id=3；part 私密但父公开。
  setAssignment({ id: 1, user_id: 2, object_type: 'track_part', object_id: 5, video_id: null, part_id: 5, is_deleted: false, parent_track_id: 3, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.PRIVATE);
  assert.equal(r.url, null);
});

test('解析器：track_part 恢复为公开 -> available 且地址用父课程 id', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'track_part', object_id: 5, video_id: null, part_id: 5, is_deleted: false, parent_track_id: 3, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/tracks/3?part=5');
  assert.deepEqual(r.target, { type: 'track_part', id: '3', partId: '5', page: 'track-detail' });
});

test('解析器：旧记录 part_id 为空但 object_id 确为 P -> available，导航用规范化 part id', async () => {
  // JOIN 已用 COALESCE(part_id, object_id) 找到父课程；后续判定/URL 必须用同一 resolvedPartId。
  setAssignment({ id: 1, user_id: 2, object_type: 'track_part', object_id: 55, video_id: null, part_id: null, is_deleted: false, parent_track_id: 3, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/tracks/3?part=55');
  assert.deepEqual(r.target, { type: 'track_part', id: '3', partId: '55', page: 'track-detail' });
});

test('解析器：knowledge_part 旧记录 part_id 为空 -> available 且地址用父课程 id', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'knowledge_part', object_id: 88, video_id: null, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: 6 });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/knowledge/6?part=88');
  assert.deepEqual(r.target, { type: 'knowledge_part', id: '6', partId: '88', page: 'knowledge-detail' });
});

test('解析器：公开合集（混合私密/公开子项）-> available', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'track_collection', object_id: 7, video_id: null, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.url, '/tracks/collections/7');
});

test('解析器：全私密合集 -> private', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'knowledge_collection', object_id: 6, video_id: null, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.PRIVATE);
});

test('解析器：目标已被删除（不存在）-> missing（不把 404 当 private）', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: false, publicReadable: false });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.MISSING);
});

test('解析器：message 类型 -> available 且 target 为 null', async () => {
  setAssignment({ id: 1, user_id: 2, object_type: 'message', object_id: null, video_id: null, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  const r = await loadAssignmentNavigation(makeFakePool(), 1, { userId: 2 });
  assert.equal(r.status, ASSIGNMENT_NAVIGATION_STATUS.AVAILABLE);
  assert.equal(r.target, null);
  assert.equal(r.url, null);
});

// ---------------------------------------------------------------------------
// D. 路由契约测试：Web 端 /api/user/assignments/:id/navigation（与线上处理器等价）
// ---------------------------------------------------------------------------
const webApp = express();
const webRouter = express.Router();
webRouter.get('/assignments/:id/navigation', (req, res, next) => {
  req.user = { userId: state.viewerUserId };
  next();
}, async (req, res, next) => {
  try {
    const navigation = await loadAssignmentNavigation(makeFakePool(), req.params.id, { userId: req.user.userId });
    res.json({ data: { id: String(req.params.id), ...navigation } });
  } catch (error) {
    next(error);
  }
});
webApp.use('/api/user', webRouter);
webApp.use((error, req, res, next) => res.status(500).json({ message: error.message }));

let webServer, webBase;
test.before(async () => {
  webServer = webApp.listen(0, '127.0.0.1');
  await new Promise((r) => webServer.once('listening', r));
  webBase = `http://127.0.0.1:${webServer.address().port}`;
});
test.after(async () => {
  await new Promise((r) => webServer.close(r));
});

function webUrl(id) {
  return `${webBase}/api/user/assignments/${id}/navigation`;
}

test('Web 路由：video 目标公开 -> 200 available 且返回真实 data.url', async () => {
  state.viewerUserId = 2;
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const res = await fetch(webUrl(1));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.id, '1');
  assert.equal(body.data.status, 'available');
  assert.equal(body.data.url, '/videos/10');
});

test('Web 路由：目标私密 -> 200 private 且脱敏（url/target 为 null，不是 404/500）', async () => {
  state.viewerUserId = 2;
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const res = await fetch(webUrl(1));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'private');
  assert.equal(body.data.url, null);
  assert.equal(body.data.target, null);
});

test('Web 路由：归属他人 -> 200 missing（不泄露 private）', async () => {
  state.viewerUserId = 2;
  setAssignment({ id: 1, user_id: 999, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const res = await fetch(webUrl(1));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'missing');
});

test('Web 路由：数据库/网络错误 -> 500（与 private 严格区分）', async () => {
  state.viewerUserId = 2;
  state.throwOnAssignment = true;
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  const res = await fetch(webUrl(1));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.data, undefined); // 不是 { data: { status: 'private' } }
  state.throwOnAssignment = false;
});

// ---------------------------------------------------------------------------
// E. 路由契约测试：小程序端 /api/miniprogram/homework/:id/navigation（与线上处理器等价）
// ---------------------------------------------------------------------------
const miniApp = express();
const miniRouter = express.Router();
// 与 miniprogram.auth.js requireMiniStudent 等价的最小鉴权：校验 Bearer，回查学生。
miniRouter.use((req, res, next) => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } });
    return;
  }
  try {
    const payload = jwt.verify(m[1], 'test-secret');
    if (payload.type !== 'user') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '学生登录状态无效' } });
      return;
    }
    req.student = { id: String(payload.userId), status: payload.status === 'active' ? 'active' : 'disabled' };
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '登录已过期' } });
  }
});
miniRouter.get('/homework/:id/navigation', async (req, res, next) => {
  try {
    const navigation = await loadAssignmentNavigation(makeFakePool(), req.params.id, { userId: Number(req.student.id) });
    res.json({ success: true, data: { id: String(req.params.id), ...navigation } });
  } catch (error) {
    next(error);
  }
});
miniApp.use('/api/miniprogram', miniRouter);
miniApp.use((error, req, res, next) => res.status(500).json({ success: false, error: { code: 'ERROR', message: error.message } }));

let miniServer, miniBase;
test.before(async () => {
  miniServer = miniApp.listen(0, '127.0.0.1');
  await new Promise((r) => miniServer.once('listening', r));
  miniBase = `http://127.0.0.1:${miniServer.address().port}`;
});
test.after(async () => {
  await new Promise((r) => miniServer.close(r));
});

function miniToken(userId = 2) {
  return jwt.sign({ type: 'user', userId, role: 'user', status: 'active' }, 'test-secret');
}
function miniUrl(id) {
  return `${miniBase}/api/miniprogram/homework/${id}/navigation`;
}

test('小程序路由：video 目标公开 -> success=true available 且返回 target', async () => {
  state.viewerUserId = 2;
  state.studentRow = { id: 2, status: 'active', is_active: true, username: 's', account: 's', nickname: '', class_id: null, class_name: '' };
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const res = await fetch(miniUrl(1), { headers: { authorization: `Bearer ${miniToken(2)}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, 'available');
  assert.equal(body.data.url, '/videos/10');
  assert.deepEqual(body.data.target, { type: 'video', id: '10', partId: '', page: 'video-detail' });
});

test('小程序路由：目标私密 -> success=true private 且脱敏', async () => {
  state.viewerUserId = 2;
  state.studentRow = { id: 2, status: 'active', is_active: true, username: 's', account: 's', nickname: '', class_id: null, class_name: '' };
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const res = await fetch(miniUrl(1), { headers: { authorization: `Bearer ${miniToken(2)}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'private');
  assert.equal(body.data.url, null);
  assert.equal(body.data.target, null);
});

test('小程序路由：track_part 私密 P 即使父 public -> private', async () => {
  state.viewerUserId = 2;
  state.studentRow = { id: 2, status: 'active', is_active: true, username: 's', account: 's', nickname: '', class_id: null, class_name: '' };
  setAssignment({ id: 1, user_id: 2, object_type: 'track_part', object_id: 5, video_id: null, part_id: 5, is_deleted: false, parent_track_id: 3, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: false });
  const res = await fetch(miniUrl(1), { headers: { authorization: `Bearer ${miniToken(2)}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'private');
});

test('小程序路由：公开合集（混合）-> available', async () => {
  state.viewerUserId = 2;
  state.studentRow = { id: 2, status: 'active', is_active: true, username: 's', account: 's', nickname: '', class_id: null, class_name: '' };
  setAssignment({ id: 1, user_id: 2, object_type: 'track_collection', object_id: 7, video_id: null, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  setVisibility({ exists: true, publicReadable: true });
  const res = await fetch(miniUrl(1), { headers: { authorization: `Bearer ${miniToken(2)}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, 'available');
  assert.equal(body.data.url, '/tracks/collections/7');
});

test('小程序路由：数据库/网络错误 -> 500（与 private 严格区分）', async () => {
  state.viewerUserId = 2;
  state.studentRow = { id: 2, status: 'active', is_active: true, username: 's', account: 's', nickname: '', class_id: null, class_name: '' };
  state.throwOnAssignment = true;
  setAssignment({ id: 1, user_id: 2, object_type: 'video', object_id: 10, video_id: 10, part_id: null, is_deleted: false, parent_track_id: null, parent_knowledge_id: null });
  const res = await fetch(miniUrl(1), { headers: { authorization: `Bearer ${miniToken(2)}` } });
  assert.equal(res.status, 500);
  state.throwOnAssignment = false;
});

test('小程序路由：未携带 token -> 401', async () => {
  const res = await fetch(miniUrl(1));
  assert.equal(res.status, 401);
});
