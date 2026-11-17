// 作业目标共享解析层（阶段一 B1）的纯 SQL 片段测试。
// 不连接数据库：验证片段结构、与 content-object-access.js 的公开口径一致性、
// 快照/当前显示分离，防止后续改动再次引入漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadContentObject } from './content-object-access.js';
import {
  ASSIGNMENT_TARGET_TYPES,
  ASSIGNMENT_TARGET_STATUS,
  UNAVAILABLE_TITLE,
  assignmentTargetJoins,
  assignmentTargetExistsExpr,
  assignmentTargetPublicExpr,
  assignmentTargetStatusExpr,
  assignmentSnapshotTitleExpr,
  assignmentCurrentTitleExpr,
  assignmentCurrentCoverExpr,
  assignmentPartNoExpr,
  assignmentParentIdExpr,
  assignmentNormalizedObjectIdExpr,
  assignmentNavigationUrlExpr,
  assignmentTargetProjection
} from './assignment-targets.js';

test('类型白名单固定为七类内容目标，不含 message', () => {
  assert.deepEqual([...ASSIGNMENT_TARGET_TYPES], [
    'video', 'track_point', 'track_collection',
    'knowledge_point', 'knowledge_collection', 'track_part', 'knowledge_part'
  ]);
  assert.ok(!ASSIGNMENT_TARGET_TYPES.includes('message'));
});

test('P 的 JOIN 与规范化 ID 使用 COALESCE(part_id, object_id) 兼容旧记录', () => {
  const joins = assignmentTargetJoins();
  assert.match(joins, /track_parts tp ON tp\.id = COALESCE\(ua\.part_id, ua\.object_id\)/);
  assert.match(joins, /knowledge_parts kpp ON kpp\.id = COALESCE\(ua\.part_id, ua\.object_id\)/);
  assert.match(assignmentNormalizedObjectIdExpr(), /COALESCE\(ua\.part_id, ua\.object_id\)/);
});

test('当前标题来自实时父名 + part_no + 自定义标题，绝不读快照列', () => {
  const title = assignmentCurrentTitleExpr();
  assert.match(title, /parent_t\.name/);
  assert.match(title, /tp\.part_no/);
  assert.match(title, /tp\.title/);
  assert.match(title, /parent_kp\.name/);
  assert.match(title, /kpp\.part_no/);
  assert.doesNotMatch(title, /assigned_object_title|assigned_video_title/);
});

test('历史快照表达式只读 assigned_*_title，缺失时固定文案', () => {
  const snap = assignmentSnapshotTitleExpr();
  assert.match(snap, /ua\.assigned_object_title/);
  assert.match(snap, /ua\.assigned_video_title/);
  assert.match(snap, /已删除内容/);
  assert.doesNotMatch(snap, /part_no|cover/);
});

test('P 封面取实时父课程封面（修复 activeVideos 漏父封面）', () => {
  const cover = assignmentCurrentCoverExpr();
  assert.match(cover, /parent_t\.cover/);
  assert.match(cover, /parent_kp\.cover/);
});

test('状态表达式：存在性优先于公开资格，缺失->missing、私密->private', () => {
  const status = assignmentTargetStatusExpr();
  assert.match(status, /'missing'/);
  assert.match(status, /'private'/);
  assert.match(status, /'available'/);
  assert.ok(status.indexOf('missing') < status.indexOf('private'), '先判存在性');
  assert.equal(ASSIGNMENT_TARGET_STATUS.AVAILABLE, 'available');
  assert.equal(UNAVAILABLE_TITLE, '此资料已经被老师更改');
});

test('投影：private/missing 用统一失效文案、空封面、空导航、灰框状态', () => {
  const projection = assignmentTargetProjection().join('\n');
  assert.match(projection, /AS title/);
  assert.match(projection, /AS cover_url/);
  assert.match(projection, /AS navigation_url/);
  assert.match(projection, /AS target_status/);
  assert.match(projection, /AS target_private/);
  assert.match(projection, /AS part_no/);
  assert.match(projection, /AS parent_id/);
  assert.ok(projection.includes(UNAVAILABLE_TITLE), '失效标题为精确统一文案');
});

test('公开判定与 content-object-access.js 视频口径一致：有公开宿主或无宿主即可见', () => {
  const pub = assignmentTargetPublicExpr();
  // 必须含「任一公开宿主」与「无任何宿主（旧独立视频）」两条腿。
  assert.match(pub, /x\.visibility = 'public'/);
  assert.match(pub, /OR NOT EXISTS/);
  // 不能出现旧的漂移口径：任一私密宿主即判不可见。
  assert.doesNotMatch(pub, /<> 'public'/);
  // 与真实函数语义交叉验证：无宿主(rows=[]) 在 canReadContentObject 里由调用方决定，
  // 这里只证明片段不含「任一私密宿主封死」的反向谓词。
  assert.equal(typeof canReadContentObject, 'function');
});

test('part_no / parent_id 非 P 为 NULL，P 取实时列', () => {
  assert.match(assignmentPartNoExpr(), /tp\.part_no/);
  assert.match(assignmentPartNoExpr(), /kpp\.part_no/);
  assert.match(assignmentParentIdExpr(), /parent_t\.id/);
  assert.match(assignmentParentIdExpr(), /parent_kp\.id/);
  assert.match(assignmentPartNoExpr(), /ELSE NULL/);
  assert.match(assignmentParentIdExpr(), /ELSE NULL/);
});

test('导航地址仅对白名单类型生成，P 用父课程 id + 规范化 part id', () => {
  const url = assignmentNavigationUrlExpr();
  assert.match(url, /\/tracks\/' \|\| parent_t\.id \|\| '\?part=' \|\| COALESCE\(ua\.part_id, ua\.object_id\)/);
  assert.match(url, /\/knowledge\/' \|\| parent_kp\.id \|\| '\?part=' \|\| COALESCE\(ua\.part_id, ua\.object_id\)/);
});

test('存在性表达式：删除目标保留行（由投影标记 missing），不再作为过滤条件', () => {
  const exists = assignmentTargetExistsExpr();
  assert.match(exists, /v\.id IS NOT NULL/);
  assert.match(exists, /tp\.id IS NOT NULL AND parent_t\.id IS NOT NULL/);
});
