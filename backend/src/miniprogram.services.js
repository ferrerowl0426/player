import { pool } from './db.js';
import { getKeyFromPublicUrl, normalizePublicUrl } from './storage.js';

function toInt(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function formatDateText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function durationText(seconds) {
  const total = Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return '';
  const minutes = Math.floor(total / 60);
  const rest = Math.floor(total % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function fileTypeFromName(name = '') {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.zip')) return 'zip';
  return 'file';
}

function sizeText(size = 0) {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pagination(page, pageSize, total) {
  return {
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total
  };
}

function assignmentTarget(row) {
  const objectType = row.object_type || 'video';
  const partId = row.part_id || '';
  let objectId = row.object_id || row.video_id;

  if (objectType === 'track_part') objectId = row.parent_track_id || row.object_id || row.video_id;
  if (objectType === 'knowledge_part') objectId = row.parent_knowledge_id || row.object_id || row.video_id;

  const target = { type: objectType, id: objectId ? String(objectId) : '', partId: partId ? String(partId) : '' };

  if (objectType === 'track_collection') target.page = 'track-collection';
  else if (objectType === 'track_point' || objectType === 'track_part') target.page = 'track-detail';
  else if (objectType === 'knowledge_collection') target.page = 'knowledge-collection';
  else if (objectType === 'knowledge_point' || objectType === 'knowledge_part') target.page = 'knowledge-detail';
  else target.page = 'video-detail';

  return target;
}

function serializeAssignment(row) {
  return {
    id: String(row.id),
    type: row.object_type || 'video',
    title: row.title || row.assigned_object_title || row.assigned_video_title || '已删除内容',
    coverUrl: normalizePublicUrl(row.cover_url || ''),
    partId: row.part_id ? String(row.part_id) : '',
    partNo: row.part_no || null,
    teacherName: row.teacher_name || '',
    createdAt: row.created_at,
    dateText: formatDateText(row.created_at),
    deleted: Boolean(row.is_deleted),
    deleteReason: row.delete_reason || '',
    target: assignmentTarget(row)
  };
}

function assignmentTitleSql() {
  return `COALESCE(NULLIF(ua.assigned_object_title, ''), NULLIF(ua.assigned_video_title, ''), tp.name, tc.name, kp.name, kc.name, parent_tp.name, parent_kp.name, v.title, '已删除内容')`;
}

function assignmentCoverSql() {
  return `COALESCE(tp.cover, tc.cover, kp.cover, kc.cover, parent_tp.cover, parent_kp.cover, v.cover_url, '')`;
}

function assignmentJoinsSql() {
  return `LEFT JOIN videos v ON v.id = ua.video_id
          LEFT JOIN track_points tp ON ua.object_type = 'track_point' AND tp.id = ua.object_id
          LEFT JOIN track_collections tc ON ua.object_type = 'track_collection' AND tc.id = ua.object_id
          LEFT JOIN track_parts tpart ON ua.object_type = 'track_part' AND tpart.id = ua.part_id
          LEFT JOIN track_points parent_tp ON parent_tp.id = tpart.track_id
          LEFT JOIN knowledge_points kp ON ua.object_type = 'knowledge_point' AND kp.id = ua.object_id
          LEFT JOIN knowledge_collections kc ON ua.object_type = 'knowledge_collection' AND kc.id = ua.object_id
          LEFT JOIN knowledge_parts kpart ON ua.object_type = 'knowledge_part' AND kpart.id = ua.part_id
          LEFT JOIN knowledge_points parent_kp ON parent_kp.id = kpart.knowledge_point_id
          LEFT JOIN admins a ON a.id = ua.assigned_by_admin_id`;
}

export async function getTodayHomework(student) {
  const result = await pool.query(
    `SELECT ua.*,
            ${assignmentTitleSql()} AS title,
            ${assignmentCoverSql()} AS cover_url,
            COALESCE(tpart.part_no, kpart.part_no) AS part_no,
            parent_tp.id AS parent_track_id,
            parent_kp.id AS parent_knowledge_id,
            COALESCE(a.nickname, a.username, a.account, '') AS teacher_name
       FROM user_assignments ua
       ${assignmentJoinsSql()}
      WHERE ua.user_id = $1
        AND ua.is_deleted = FALSE
      ORDER BY ua.created_at DESC, ua.id DESC
      LIMIT 20`,
    [student.id]
  );

  if (result.rowCount === 0) {
    return { student, latestHomework: null };
  }

  const operationId = result.rows[0].operation_id;
  const rows = result.rows.filter((row) => row.operation_id === operationId).slice(0, 5);
  const first = rows[0];

  return {
    student,
    latestHomework: {
      id: String(operationId),
      operationId: String(operationId),
      title: '最新作业',
      teacherName: first.teacher_name || '',
      createdAt: first.created_at,
      dateText: formatDateText(first.created_at),
      practiceRequirement: first.practice_requirement || '',
      submitRequirement: first.submit_requirement || '',
      items: rows.map(serializeAssignment)
    }
  };
}

export async function getHomeworkHistory(student, { page = 1, pageSize = 20 } = {}) {
  const safePage = toInt(page, 1);
  const safePageSize = Math.min(toInt(pageSize, 20), 50);
  const offset = (safePage - 1) * safePageSize;

  const countResult = await pool.query(
    'SELECT COUNT(DISTINCT operation_id)::int AS total FROM user_assignments WHERE user_id = $1',
    [student.id]
  );
  const total = countResult.rows[0]?.total || 0;

  const operations = await pool.query(
    `SELECT operation_id, MAX(created_at) AS created_at
       FROM user_assignments
      WHERE user_id = $1
      GROUP BY operation_id
      ORDER BY MAX(created_at) DESC
      LIMIT $2 OFFSET $3`,
    [student.id, safePageSize, offset]
  );

  if (operations.rowCount === 0) {
    return { items: [], pagination: pagination(safePage, safePageSize, total) };
  }

  const operationIds = operations.rows.map((row) => row.operation_id);
  const rowsResult = await pool.query(
    `SELECT ua.*,
            ${assignmentTitleSql()} AS title,
            ${assignmentCoverSql()} AS cover_url,
            COALESCE(tpart.part_no, kpart.part_no) AS part_no,
            parent_tp.id AS parent_track_id,
            parent_kp.id AS parent_knowledge_id,
            COALESCE(a.nickname, a.username, a.account, '') AS teacher_name
       FROM user_assignments ua
       ${assignmentJoinsSql()}
      WHERE ua.user_id = $1 AND ua.operation_id = ANY($2::int[])
      ORDER BY ua.created_at DESC, ua.id ASC`,
    [student.id, operationIds]
  );

  const map = new Map();
  for (const operation of operations.rows) {
    map.set(operation.operation_id, {
      id: String(operation.operation_id),
      operationId: String(operation.operation_id),
      createdAt: operation.created_at,
      dateText: formatDateText(operation.created_at),
      teacherName: '',
      practiceRequirement: '',
      submitRequirement: '',
      items: []
    });
  }

  for (const row of rowsResult.rows) {
    const group = map.get(row.operation_id);
    if (!group) continue;
    group.teacherName ||= row.teacher_name || '';
    group.practiceRequirement ||= row.practice_requirement || '';
    group.submitRequirement ||= row.submit_requirement || '';
    if (group.items.length < 5) group.items.push(serializeAssignment(row));
  }

  return { items: [...map.values()], pagination: pagination(safePage, safePageSize, total) };
}

function resolveSort(sort = '') {
  // 支持三种：updated_desc 时间倒序、updated_asc 时间正序、title 按标题
  switch (String(sort || '')) {
    case 'updated_asc':
      return { column: 'updated_at', order: 'ASC' };
    case 'title':
      return { column: 'name', order: 'ASC' };
    case 'updated_desc':
    default:
      return { column: 'updated_at', order: 'DESC' };
  }
}

async function listContent({ table, collectionTable, kind, keyword = '', page = 1, pageSize = 20, sort = 'updated_desc' }) {
  const safePage = toInt(page, 1);
  const safePageSize = Math.min(toInt(pageSize, 20), 50);
  const offset = (safePage - 1) * safePageSize;
  const order = resolveSort(sort);
  const params = [];
  let where = '';
  if (keyword) {
    params.push(`%${keyword}%`);
    where = `WHERE name ILIKE $${params.length}`;
  }

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table} ${where}`, params);
  params.push(safePageSize, offset);
  const result = await pool.query(
    `SELECT id, name, cover, description, created_at, updated_at
       FROM ${table}
       ${where}
      ORDER BY ${order.column} ${order.order}, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countColumn = kind === 'track_collection' ? 'track_id' : 'knowledge_point_id';
  const collectionIds = result.rows.map((row) => row.id);
  let countMap = new Map();
  if (collectionTable && collectionIds.length > 0) {
    const countResult = await pool.query(
      `SELECT collection_id, COUNT(${countColumn})::int AS count FROM ${collectionTable} WHERE collection_id = ANY($1::int[]) GROUP BY collection_id`,
      [collectionIds]
    );
    countMap = new Map(countResult.rows.map((row) => [row.collection_id, row.count]));
  }

  return {
    items: result.rows.map((row) => ({
      id: String(row.id),
      type: kind,
      title: row.name,
      coverUrl: normalizePublicUrl(row.cover || ''),
      description: row.description || '',
      contentCount: countMap.get(row.id) || 0,
      updateDateText: formatDateText(row.updated_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    pagination: pagination(safePage, safePageSize, totalResult.rows[0]?.total || 0)
  };
}

export async function listTracks(query) {
  const type = query.type || 'track_point';
  if (type === 'track_collection') {
    return listContent({ table: 'track_collections', collectionTable: 'track_collection_items', kind: 'track_collection', ...query });
  }
  return listContent({ table: 'track_points', collectionTable: '', kind: 'track_point', ...query });
}

export async function listKnowledge(query) {
  const type = query.type || 'knowledge_point';
  if (type === 'knowledge_collection') {
    return listContent({ table: 'knowledge_collections', collectionTable: 'knowledge_collection_items', kind: 'knowledge_collection', ...query });
  }
  return listContent({ table: 'knowledge_points', collectionTable: '', kind: 'knowledge_point', ...query });
}

function formatRendition(row = {}) {
  const quality = String(row.quality || 'source');
  return {
    quality,
    label: quality === 'source' ? '原画' : quality.toUpperCase(),
    videoUrl: normalizePublicUrl(row.video_url || ''),
    fileSize: Number(row.file_size || 0),
    status: row.status || '',
    updatedAt: row.updated_at || ''
  };
}

async function getParts(table, parentColumn, parentId) {
  const result = await pool.query(
    `SELECT p.id, p.part_no, p.title, p.duration, p.video_id, v.video_url, v.cover_url
       FROM ${table} p
       LEFT JOIN videos v ON v.id = p.video_id
      WHERE p.${parentColumn} = $1
      ORDER BY p.part_no ASC`,
    [parentId]
  );

  const videoIds = result.rows.map((row) => row.video_id).filter(Boolean);
  const renditionsByVideoId = new Map();

  if (videoIds.length > 0) {
    const renditions = await pool.query(
      `SELECT video_id, quality, video_url, file_size, status, updated_at
         FROM video_renditions
        WHERE video_id = ANY($1::int[])
          AND status = 'ready'
          AND video_url <> ''
        ORDER BY CASE quality WHEN 'source' THEN 1 WHEN '1080p' THEN 2 WHEN '720p' THEN 3 ELSE 4 END`,
      [videoIds]
    );

    for (const row of renditions.rows) {
      const list = renditionsByVideoId.get(row.video_id) || [];
      list.push(formatRendition(row));
      renditionsByVideoId.set(row.video_id, list);
    }
  }

  return result.rows.map((row) => {
    const sourceUrl = normalizePublicUrl(row.video_url || '');
    const renditions = renditionsByVideoId.get(row.video_id) || [];
    if (sourceUrl && !renditions.some((item) => item.quality === 'source')) {
      renditions.unshift({ quality: 'source', label: '原画', videoUrl: sourceUrl, fileSize: 0, status: 'ready', updatedAt: '' });
    }

    return {
      id: String(row.id),
      partNo: row.part_no,
      title: row.title,
      duration: row.duration,
      durationText: durationText(row.duration),
      videoId: row.video_id ? String(row.video_id) : '',
      videoUrl: sourceUrl,
      coverUrl: normalizePublicUrl(row.cover_url || ''),
      renditions
    };
  });
}

export async function getTrackDetail(id) {
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at FROM track_points WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  const [attachments, directResources, prerequisites] = await Promise.all([
    getAttachments('track_point', row.id),
    getLinkedLibraryResources('track_point', row.id),
    getPrerequisites('track_point', row.id)
  ]);

  return {
    id: String(row.id),
    type: 'track_point',
    title: row.name,
    coverUrl: normalizePublicUrl(row.cover || ''),
    description: row.description || '',
    parts: await getParts('track_parts', 'track_id', row.id),
    attachments,
    libraryResources: directResources,
    prerequisites
  };
}

export async function getKnowledgeDetail(id) {
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at FROM knowledge_points WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  const [attachments, directResources, prerequisites] = await Promise.all([
    getAttachments('knowledge_point', row.id),
    getLinkedLibraryResources('knowledge_point', row.id),
    getPrerequisites('knowledge_point', row.id)
  ]);

  return {
    id: String(row.id),
    type: 'knowledge_point',
    title: row.name,
    coverUrl: normalizePublicUrl(row.cover || ''),
    description: row.description || '',
    parts: await getParts('knowledge_parts', 'knowledge_point_id', row.id),
    attachments,
    libraryResources: directResources,
    prerequisites
  };
}

async function getCollectionDetail({ id, table, itemsTable, itemTable, itemColumn, type, itemType }) {
  const result = await pool.query(`SELECT id, name, cover, description, created_at, updated_at FROM ${table} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;

  const items = await pool.query(
    `SELECT i.id, i.name, i.cover, i.description, i.updated_at
       FROM ${itemsTable} ci
       JOIN ${itemTable} i ON i.id = ci.${itemColumn}
      WHERE ci.collection_id = $1
      ORDER BY ci.sort_order ASC, ci.created_at ASC, i.id ASC`,
    [id]
  );

  const resources = await getLinkedLibraryResources(type, row.id);

  return {
    id: String(row.id),
    type,
    title: row.name,
    coverUrl: normalizePublicUrl(row.cover || ''),
    description: row.description || '',
    contentCount: items.rowCount,
    items: items.rows.map((item) => ({
      id: String(item.id),
      type: itemType,
      title: item.name,
      coverUrl: normalizePublicUrl(item.cover || ''),
      description: item.description || '',
      updateDateText: formatDateText(item.updated_at)
    })),
    resources
  };
}

export function getTrackCollectionDetail(id) {
  return getCollectionDetail({ id, table: 'track_collections', itemsTable: 'track_collection_items', itemTable: 'track_points', itemColumn: 'track_id', type: 'track_collection', itemType: 'track_point' });
}

export function getKnowledgeCollectionDetail(id) {
  return getCollectionDetail({ id, table: 'knowledge_collections', itemsTable: 'knowledge_collection_items', itemTable: 'knowledge_points', itemColumn: 'knowledge_point_id', type: 'knowledge_collection', itemType: 'knowledge_point' });
}

export async function listLibrary({ keyword = '', page = 1, pageSize = 20 } = {}) {
  const safePage = toInt(page, 1);
  const safePageSize = Math.min(toInt(pageSize, 20), 50);
  const offset = (safePage - 1) * safePageSize;
  const params = [];
  let where = '';
  if (keyword) {
    params.push(`%${keyword}%`);
    where = `WHERE title ILIKE $${params.length}`;
  }
  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM library_resources ${where}`, params);
  params.push(safePageSize, offset);
  const result = await pool.query(
    `SELECT id, title, cover, file_url, file_size, file_type, created_at, updated_at
       FROM library_resources
       ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    items: result.rows.map(serializeLibraryResource),
    pagination: pagination(safePage, safePageSize, totalResult.rows[0]?.total || 0)
  };
}

function serializeLibraryResource(row) {
  const title = row.title || '';
  const type = row.file_type || fileTypeFromName(row.file_url || title);
  return {
    id: String(row.id),
    title,
    type,
    coverUrl: normalizePublicUrl(row.cover || ''),
    fileUrl: normalizePublicUrl(row.file_url || ''),
    objectKey: getKeyFromPublicUrl(row.file_url || ''),
    sizeText: sizeText(row.file_size),
    mimeType: row.file_type || '',
    updateDateText: formatDateText(row.updated_at),
    updatedAt: row.updated_at,
    canPreview: ['pdf', 'jpg', 'png'].includes(type),
    canPlay: type === 'mp3',
    canDownload: true
  };
}

function serializeAttachment(row) {
  const type = row.file_type || fileTypeFromName(row.file_name || row.file_url || '');
  return {
    id: String(row.id),
    name: row.file_name || '',
    type,
    sizeText: sizeText(row.file_size),
    url: normalizePublicUrl(row.file_url || ''),
    objectKey: row.file_key || getKeyFromPublicUrl(row.file_url || ''),
    canPreview: ['pdf', 'jpg', 'png'].includes(type),
    canPlay: type === 'mp3',
    canDownload: true
  };
}

async function getAttachments(objectType, objectId) {
  const result = await pool.query(
    `SELECT id, file_name, file_url, file_key, file_type, file_size, sort_order, created_at
       FROM content_attachments
      WHERE object_type = $1 AND object_id = $2
      ORDER BY sort_order ASC, created_at ASC, id ASC`,
    [objectType, objectId]
  );
  return result.rows.map(serializeAttachment);
}

async function getLinkedLibraryResources(objectType, objectId) {
  const result = await pool.query(
    `SELECT DISTINCT lr.id, lr.title, lr.file_url, lr.file_size, lr.file_type, lr.created_at, lr.updated_at
       FROM library_resource_links l
       JOIN library_resources lr ON lr.id = l.library_resource_id
      WHERE l.object_type = $1 AND l.object_id = $2
      ORDER BY lr.updated_at DESC, lr.id DESC`,
    [objectType, objectId]
  );
  return result.rows.map(serializeLibraryResource);
}

async function getPrerequisites(objectType, objectId) {
  const result = await pool.query(
    `SELECT p.prerequisite_type,
            p.prerequisite_id,
            COALESCE(tp.name, kp.name, tc.name, kc.name, '') AS title,
            COALESCE(tp.cover, kp.cover, tc.cover, kc.cover, '') AS cover_url
       FROM prerequisites p
       LEFT JOIN track_points tp ON p.prerequisite_type = 'track_point' AND tp.id = p.prerequisite_id
       LEFT JOIN knowledge_points kp ON p.prerequisite_type = 'knowledge_point' AND kp.id = p.prerequisite_id
       LEFT JOIN track_collections tc ON p.prerequisite_type = 'track_collection' AND tc.id = p.prerequisite_id
       LEFT JOIN knowledge_collections kc ON p.prerequisite_type = 'knowledge_collection' AND kc.id = p.prerequisite_id
      WHERE p.object_type = $1 AND p.object_id = $2
      ORDER BY p.prerequisite_type ASC, p.prerequisite_id ASC`,
    [objectType, objectId]
  );
  return result.rows
    .filter((row) => row.title)
    .map((row) => ({
      id: String(row.prerequisite_id),
      type: row.prerequisite_type,
      title: row.title,
      coverUrl: normalizePublicUrl(row.cover_url || '')
    }));
}

function mergeResources(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const item of group) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
  }
  return [...map.values()];
}

async function getLibraryRelatedCourses(resourceId) {
  const result = await pool.query(
    `SELECT l.object_type,
            l.object_id,
            COALESCE(tp.name, tc.name, kp.name, kc.name, '') AS title,
            COALESCE(tp.cover, tc.cover, kp.cover, kc.cover, '') AS cover_url
       FROM library_resource_links l
       LEFT JOIN track_points tp ON l.object_type = 'track_point' AND tp.id = l.object_id
       LEFT JOIN track_collections tc ON l.object_type = 'track_collection' AND tc.id = l.object_id
       LEFT JOIN knowledge_points kp ON l.object_type = 'knowledge_point' AND kp.id = l.object_id
       LEFT JOIN knowledge_collections kc ON l.object_type = 'knowledge_collection' AND kc.id = l.object_id
      WHERE l.library_resource_id = $1
      ORDER BY l.object_type ASC, l.object_id ASC`,
    [resourceId]
  );

  return result.rows
    .filter((row) => row.title)
    .map((row) => ({
      id: String(row.object_id),
      type: row.object_type,
      title: row.title,
      coverUrl: normalizePublicUrl(row.cover_url || '')
    }));
}

export async function getLibraryDetail(id) {
  const result = await pool.query(
    'SELECT id, title, cover, file_url, file_size, file_type, created_at, updated_at FROM library_resources WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...serializeLibraryResource(row), relatedCourses: await getLibraryRelatedCourses(row.id) };
}
