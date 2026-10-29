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
    // Shared media is accessible only when all linked hosts permit public reading.
    sql = `SELECT 1 FROM videos v WHERE v.id=$1 AND NOT EXISTS (
      SELECT 1 FROM track_parts x JOIN track_points c ON c.id=x.track_id WHERE x.video_id=v.id AND (x.visibility<>'public' OR c.visibility<>'public')
      UNION ALL SELECT 1 FROM knowledge_parts x JOIN knowledge_points c ON c.id=x.knowledge_point_id WHERE x.video_id=v.id AND (x.visibility<>'public' OR c.visibility<>'public'))`;
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
