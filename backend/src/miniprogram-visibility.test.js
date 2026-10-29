// 针对 miniprogram.services.js 的可见性逻辑测试：课程/合集列表、搜索、详情的 SQL 过滤，
// parts / 关联课程 / 前置课程的私密屏蔽。不连接真实数据库，仅用受控假 pool 校验生成的 SQL 与返回结果。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DB = new URL('./db.js', import.meta.url).href;

let courseRow = null;
let fakePool;

const GENERIC_ROW = { id: 1, name: 'x', cover: '', description: '', created_at: new Date(), updated_at: new Date() };

function makePool() {
  const calls = [];
  fakePool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM track_points WHERE id = \$1/.test(sql) || /FROM knowledge_points WHERE id = \$1/.test(sql)) {
        return { rows: courseRow ? [courseRow] : [], rowCount: courseRow ? 1 : 0 };
      }
      if (/WHERE id = \$1/.test(sql)) {
        // 合集 / 图书馆资源等单行查询：返回占位行即可（无 visibility 概念）。
        return { rows: [GENERIC_ROW], rowCount: 1 };
      }
      // 列表 / 统计 / 子查询统一返回空结果，便于只校验生成的 SQL。
      if (/FROM (track_collections|knowledge_collections) c/.test(sql) && !/COUNT\(\*\)/.test(sql)) return { rows: [GENERIC_ROW], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    _calls: () => calls,
    _reset: () => { calls.length = 0; }
  };
  return fakePool;
}

const STUDENT = { role: 'user', status: 'active' };
const TEACHER = { role: 'teacher', status: 'active' };

let mod;
test.before(async () => {
  mock.module(SRC_DB, { namedExports: { pool: makePool() } });
  mod = await import('./miniprogram.services.js');
});
test.after(() => { mock.reset(); });
test.beforeEach(() => { courseRow = null; fakePool._reset(); });

function capturedSqls() {
  return fakePool._calls().map((c) => c.sql);
}
function firstMatching(pattern) {
  return capturedSqls().find((sql) => pattern.test(sql));
}

// ---------- 列表 / 搜索：学生（非私密查看者）必须过滤 ----------

test('listTracks 曲目：学生过滤父 public + 存在公开 P；教师不过滤', async () => {
  await mod.listTracks({ type: 'track_point' }, STUDENT);
  const studentSql = firstMatching(/SELECT COUNT\(\*\)::int AS total FROM track_points c/);
  assert.ok(studentSql, '应有曲目统计查询');
  assert.ok(/COALESCE\(NULLIF\(c\.visibility/.test(studentSql), '缺少父 public 判定');
  assert.ok(/EXISTS \(SELECT 1 FROM track_parts p WHERE p\.track_id = c\.id/.test(studentSql), '缺少 EXISTS 公开 P 判定');

  fakePool._reset();
  await mod.listTracks({ type: 'track_point' }, TEACHER);
  const teacherSql = firstMatching(/SELECT COUNT\(\*\)::int AS total FROM track_points c/);
  assert.ok(!/NULLIF\(c\.visibility/.test(teacherSql), '教师不应过滤父可见性');
});

test('listTracks 曲目：关键字命中 name ILIKE', async () => {
  await mod.listTracks({ type: 'track_point', keyword: 'sonata' }, STUDENT);
  assert.ok(/c\.name ILIKE \$1/.test(firstMatching(/SELECT COUNT\(\*\)::int AS total FROM track_points c/)));
});

test('listTracks 曲谱集：学生仅展示含可见曲目的合集，且计数仅统计公开曲目', async () => {
  await mod.listTracks({ type: 'track_collection' }, STUDENT);
  const listSql = firstMatching(/SELECT COUNT\(\*\)::int AS total FROM track_collections c/);
  assert.ok(/FROM track_collection_items ci/.test(listSql), '合集需含曲目');
  assert.ok(/COALESCE\(NULLIF\(i\.visibility/.test(listSql), '合集曲目可见性过滤缺失');
  const countSql = firstMatching(/COUNT\(CASE WHEN/);
  assert.ok(countSql && /i\.visibility/.test(countSql) && /EXISTS/.test(countSql), '计数必须同时检查父状态和公开P');
});

test('listKnowledge 知识点：学生过滤知识点 public + 存在公开 P', async () => {
  await mod.listKnowledge({ type: 'knowledge_point' }, STUDENT);
  const sql = firstMatching(/SELECT COUNT\(\*\)::int AS total FROM knowledge_points c/);
  assert.ok(/COALESCE\(NULLIF\(c\.visibility/.test(sql), '缺少知识点父 public 判定');
  assert.ok(/EXISTS \(SELECT 1 FROM knowledge_parts p WHERE p\.knowledge_point_id = c\.id/.test(sql), '缺少知识点 EXISTS 公开 P 判定');
});

test('listKnowledge 知识点集：学生仅展示含可见知识点的合集', async () => {
  await mod.listKnowledge({ type: 'knowledge_collection' }, STUDENT);
  const sql = firstMatching(/SELECT COUNT\(\*\)::int AS total FROM knowledge_collections c/);
  assert.ok(/FROM knowledge_collection_items ci/.test(sql), '知识点集需含知识点');
  assert.ok(/COALESCE\(NULLIF\(i\.visibility/.test(sql), '知识点集知识点可见性过滤缺失');
});

// ---------- 详情：私密父课程对学生对隐藏 ----------

test('getTrackDetail：私密曲目对学生返回 null（隐藏而非暴露）', async () => {
  courseRow = { id: 1, name: '私密曲', visibility: 'private' };
  assert.equal(await mod.getTrackDetail('1', STUDENT), null);
});

test('getTrackDetail：公开曲目对学生返回数据，且 parts 仅公开 P', async () => {
  courseRow = { id: 1, name: '公开曲', visibility: 'public' };
  const detail = await mod.getTrackDetail('1', STUDENT);
  assert.ok(detail, '公开曲目应可见');
  const partsSql = firstMatching(/SELECT p.id, p.part_no/);
  assert.ok(partsSql && /COALESCE\(NULLIF\(p\.visibility/.test(partsSql), 'parts 应过滤私密 P');
  // 前置课程查询也应带私密过滤（学生视角）。
  const prereqSql = firstMatching(/FROM prerequisites p/);
  assert.ok(prereqSql && /\$3::boolean = TRUE OR \(/.test(prereqSql), '前置课程应带可见性条件');
});

test('getTrackDetail：教师可见私密曲目', async () => {
  courseRow = { id: 1, name: '私密曲', visibility: 'private' };
  assert.ok(await mod.getTrackDetail('1', TEACHER));
});

test('getKnowledgeDetail：私密知识点对学生返回 null', async () => {
  courseRow = { id: 2, name: '私密点', visibility: 'private' };
  assert.equal(await mod.getKnowledgeDetail('2', STUDENT), null);
});

test('getKnowledgeDetail：公开知识点 parts 仅公开 P', async () => {
  courseRow = { id: 2, name: '公开点', visibility: 'public' };
  assert.ok(await mod.getKnowledgeDetail('2', STUDENT));
  const partsSql = firstMatching(/SELECT p.id, p.part_no/);
  assert.ok(partsSql && /COALESCE\(NULLIF\(p\.visibility/.test(partsSql), 'knowledge_parts 应过滤私密 P');
});

// ---------- 合集详情：无可见子项则整体隐藏 ----------

test('getTrackCollectionDetail：学生无任何可见子项时返回 null', async () => {
  assert.equal(await mod.getTrackCollectionDetail('5', STUDENT), null);
});

test('getTrackCollectionDetail：教师可见合集且 items 不过滤', async () => {
  const detail = await mod.getTrackCollectionDetail('5', TEACHER);
  assert.ok(detail, '教师可见合集');
  const itemsSql = firstMatching(/FROM track_collection_items ci/);
  assert.ok(itemsSql, '应查询合集子项');
  assert.ok(!/COALESCE\(NULLIF\(i\.visibility/.test(itemsSql), '教师子项不应被可见性过滤');
});

test('getKnowledgeCollectionDetail：学生无可见子项时返回 null', async () => {
  assert.equal(await mod.getKnowledgeCollectionDetail('6', STUDENT), null);
});

// ---------- 关联课程 / 前置课程：私密标题不泄露 ----------

test('getLibraryDetail：relatedCourses 对学生过滤私密关联课程', async () => {
  await mod.getLibraryDetail('9', STUDENT);
  const sql = firstMatching(/FROM library_resource_links l/);
  assert.ok(sql, '应查询关联课程');
  assert.ok(/\$2::boolean = TRUE OR \(/.test(sql), '关联课程应带可见性条件');
  assert.ok(/EXISTS \(SELECT 1 FROM track_parts pp WHERE pp\.track_id = tp\.id/.test(sql), '曲目关联需查公开 P');
});
