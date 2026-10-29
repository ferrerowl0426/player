import { canViewPrivate, normalizeStoredVisibility } from './content-visibility.js';
import { canReadContentObject } from './content-object-access.js';

export function serializeAttachments(rows, viewer, source = 'content') {
  return rows.filter((row) => normalizeStoredVisibility(row.visibility) === 'public' || canViewPrivate(viewer)).map((row) => {
    const result = { ...row, visibility: normalizeStoredVisibility(row.visibility), download_endpoint: `/api/attachments/${row.id}/download-url?source=${source}` };
    if (result.visibility === 'private') { delete result.file_url; delete result.file_key; }
    return result;
  });
}
export async function authorizeAttachment(client, { id, source = 'content', viewer }) {
  if (!Number.isSafeInteger(id) || id <= 0 || !['content', 'video'].includes(source)) return null;
  const table = source === 'content' ? 'content_attachments' : 'video_attachments';
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  const row = rows[0];
  if (!row || (normalizeStoredVisibility(row.visibility) === 'private' && !canViewPrivate(viewer))) return null;
  const type = source === 'video' ? 'video' : row.object_type;
  const parentId = source === 'video' ? row.video_id : row.object_id;
  // Staff bypass in the read helper does not prove existence: independently check host.
  const hostTables = { track_point: 'track_points', knowledge_point: 'knowledge_points', track_collection: 'track_collections', knowledge_collection: 'knowledge_collections', track_part: 'track_parts', knowledge_part: 'knowledge_parts', video: 'videos' };
  if (!Object.hasOwn(hostTables, type)) return null;
  const host = await client.query(`SELECT id FROM ${hostTables[type]} WHERE id=$1`, [parentId]);
  if (!host.rows.length || !(await canReadContentObject(client, type, parentId, viewer))) return null;
  if (!row.file_key || !row.file_key.startsWith('attachments/') || row.file_key.includes('..')) return null;
  return row;
}
