import { canViewPrivate, publicCoursePredicate } from './content-visibility.js';

// An empty/guest viewer is used to test "is this target publicly reachable".
// Staff must not short-circuit an assignability check via canViewPrivate.
const GUEST_VIEWER = Object.freeze({ role: 'user', status: 'active' });

// Read authorization for polymorphic links. Write eligibility is handled separately.
export async function canReadContentObject(client, type, id, viewer) {
  if (canViewPrivate(viewer)) return true;
  let sql;
  if (['track_point', 'knowledge_point'].includes(type)) {
    const table = type === 'track_point' ? 'track_points' : 'knowledge_points';
    sql = `SELECT 1 FROM ${table} c WHERE c.id=$1 AND ${publicCoursePredicate(type)}`;
  } else if (['track_part', 'knowledge_part'].includes(type)) {
    const track = type === 'track_part';
    sql = `SELECT 1 FROM ${track ? 'track_parts' : 'knowledge_parts'} x JOIN ${track ? 'track_points' : 'knowledge_points'} c ON c.id=x.${track ? 'track_id' : 'knowledge_point_id'} WHERE x.id=$1 AND x.visibility='public' AND ${publicCoursePredicate(track ? 'track_point' : 'knowledge_point')}`;
  } else if (['track_collection', 'knowledge_collection'].includes(type)) {
    const track = type === 'track_collection';
    sql = `SELECT 1 FROM ${track ? 'track_collection_items' : 'knowledge_collection_items'} ci JOIN ${track ? 'track_points' : 'knowledge_points'} c ON c.id=ci.${track ? 'track_id' : 'knowledge_point_id'} WHERE ci.collection_id=$1 AND ${publicCoursePredicate(track ? 'track_point' : 'knowledge_point')} LIMIT 1`;
  } else if (type === 'video') {
    // 共享视频：只要存在任一“公开宿主”（P 与所属课程均 public）即视为公开可读；
    // 若无任何宿主，亦视为公开可读（旧规则）。不得因单个私密宿主封死全部公开宿主。
    sql = `SELECT 1 FROM videos v WHERE v.id=$1 AND (
      EXISTS (
        SELECT 1 FROM track_parts x JOIN track_points c ON c.id=x.track_id WHERE x.video_id=v.id AND x.visibility='public' AND c.visibility='public'
        UNION ALL SELECT 1 FROM knowledge_parts x JOIN knowledge_points c ON c.id=x.knowledge_point_id WHERE x.video_id=v.id AND x.visibility='public' AND c.visibility='public')
      OR NOT EXISTS (
        SELECT 1 FROM track_parts x WHERE x.video_id=v.id
        UNION ALL SELECT 1 FROM knowledge_parts x WHERE x.video_id=v.id))`;
  } else return false;
  const result = await client.query(sql, [id]);
  return result.rows.length > 0;
}

// Assignability / prerequisite eligibility: the target must be publicly reachable,
// regardless of the caller's own role. A staff viewer must NOT bypass this (a
// private target is never assignable or usable as a prerequisite, even by staff).
export function canAssignContentObject(client, type, id) {
  return canReadContentObject(client, type, id, GUEST_VIEWER);
}

// 前置维护资格：仅要求目标对象真实存在（按类型查真实行），允许私密内容，
// 且不做角色 bypass。与作业资格 canAssignContentObject 区分——后者要求公开可读、
// 拒绝私密（私密内容不可作为作业提交）。本函数用于“老师维护前置”场景：
// 只要对象真实存在即可被设为前置，私密前置同样允许。
export async function canMaintainPrerequisite(client, type, id) {
  const table = {
    track_point: 'track_points',
    knowledge_point: 'knowledge_points',
    track_part: 'track_parts',
    knowledge_part: 'knowledge_parts',
    track_collection: 'track_collections',
    knowledge_collection: 'knowledge_collections',
    video: 'videos'
  }[type];
  if (!table) return false;
  const result = await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id]);
  return result.rowCount > 0;
}
