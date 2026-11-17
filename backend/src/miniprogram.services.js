import { pool } from './db.js';
import { getKeyFromPublicUrl, normalizePublicUrl } from './storage.js';
import { toPlaybackUrl } from './playback-url.js';
import {
  canViewPrivate,
  normalizeStoredVisibility,
  PUBLIC,
  PRIVATE,
  publicCoursePredicate
} from './content-visibility.js';
import { buildAssignmentNavigationTarget } from './assignment-navigation.js';
// 复用阶段一共享投影：当前标题/封面/P序号/稳定ID/公开资格统一口径，避免再手写漂移的 video CASE。
import {
  UNAVAILABLE_TITLE,
  assignmentTargetJoins,
  assignmentTargetProjection,
  assignmentTargetStatusExpr,
  assignmentTargetPrivateExpr,
  assignmentSnapshotTitleExpr
} from './assignment-targets.js';

// 两类课程的表名/列名映射，用于复用“父课程公开且存在公开 P”的判定。
const CONTENT_TYPES = {
  track_point: {
    courseTable: 'track_points',
    partsTable: 'track_parts',
    partParentCol: 'track_id',
    collectionTable: 'track_collection_items',
    collectionItemCol: 'track_id'
  },
  knowledge_point: {
    courseTable: 'knowledge_points',
    partsTable: 'knowledge_parts',
    partParentCol: 'knowledge_point_id',
    collectionTable: 'knowledge_collection_items',
    collectionItemCol: 'knowledge_point_id'
  }
};

// 曲谱集/知识点集本身无 visibility 字段：集合可见当且仅当“包含至少一个可见子项”。
// 子项可见 = 子项本身 public 且存在至少一个公开 P（与父课程派生可见性口径一致）。
function publicCollectionPredicate(contentType) {
  const cfg = CONTENT_TYPES[contentType];
  return `EXISTS (
    SELECT 1 FROM ${cfg.collectionTable} ci
    JOIN ${cfg.courseTable} i ON i.id = ci.${cfg.collectionItemCol}
    WHERE ci.collection_id = c.id
      AND COALESCE(NULLIF(i.visibility, ''), 'public') = 'public'
      AND EXISTS (SELECT 1 FROM ${cfg.partsTable} pp WHERE pp.${cfg.partParentCol} = i.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')
  )`;
}

// 单个关联课程（前置/相关课程）是否对“非私密查看者”可见：
// 课程点需 public 且存在公开 P；集合需包含至少一个可见子项。
function relatedCourseVisibleConditions(typeColumn = 'l.object_type') {
  return `(
    (${typeColumn} = 'track_point' AND tp.id IS NOT NULL
       AND COALESCE(NULLIF(tp.visibility, ''), 'public') = 'public'
       AND EXISTS (SELECT 1 FROM track_parts pp WHERE pp.track_id = tp.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public'))
    OR (${typeColumn} = 'knowledge_point' AND kp.id IS NOT NULL
       AND COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public'
       AND EXISTS (SELECT 1 FROM knowledge_parts pp WHERE pp.knowledge_point_id = kp.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public'))
    OR (${typeColumn} = 'track_collection' AND tc.id IS NOT NULL
       AND EXISTS (SELECT 1 FROM track_collection_items ci JOIN track_points ti ON ti.id = ci.track_id WHERE ci.collection_id = tc.id
                   AND COALESCE(NULLIF(ti.visibility, ''), 'public') = 'public'
                   AND EXISTS (SELECT 1 FROM track_parts pp WHERE pp.track_id = ti.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')))
    OR (${typeColumn} = 'knowledge_collection' AND kc.id IS NOT NULL
       AND EXISTS (SELECT 1 FROM knowledge_collection_items ci JOIN knowledge_points ki ON ki.id = ci.knowledge_point_id WHERE ci.collection_id = kc.id
                   AND COALESCE(NULLIF(ki.visibility, ''), 'public') = 'public'
                   AND EXISTS (SELECT 1 FROM knowledge_parts pp WHERE pp.knowledge_point_id = ki.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')))
  )`;
}

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

// 作业导航目标对象：复用共享 assignment-navigation 的“作业目标 part_id 口径”，保证两端一致。
// 优先用共享投影下发的稳定ID/父ID（兼容旧记录 part_id 为空但 object_id 为 P）。
function assignmentTarget(row) {
  const objectType = row.object_type || 'video';
  const isPart = objectType === 'track_part' || objectType === 'knowledge_part';
  const objectId = row.normalized_object_id || row.object_id || row.video_id;
  const parentId = row.parent_id || row.parent_track_id || row.parent_knowledge_id;
  const partId = isPart ? (row.normalized_object_id || row.part_id) : row.part_id;
  return buildAssignmentNavigationTarget(objectType, objectId, partId, parentId);
}

// mode='today'：实时标题/封面/P序号，失效目标统一灰框（精确文案、空封面、无 target）。
// mode='history'：只读布置快照标题，不套失效文案、不输出任何可绕过权限的导航 target。
export function serializeAssignment(row, mode = 'today') {
  const isHistory = mode === 'history';
  const objectType = row.object_type || 'video';
  const isMessage = objectType === 'message';
  const status = String(row.target_status || (row.target_private ? 'private' : 'available')).toLowerCase();
  const unavailable = status !== 'available';
  const title = isHistory
    ? (row.title || row.assigned_object_title || row.assigned_video_title || '已删除内容')
    : (unavailable ? UNAVAILABLE_TITLE : (row.title || row.assigned_object_title || row.assigned_video_title || '已删除内容'));
  return {
    id: String(row.id),
    type: objectType,
    title,
    coverUrl: (unavailable || isHistory) ? '' : normalizePublicUrl(row.cover_url || ''),
    partId: row.part_id ? String(row.part_id) : '',
    partNo: row.part_no || null,
    parentId: row.parent_id || row.parent_track_id || row.parent_knowledge_id || null,
    normalizedObjectId: row.normalized_object_id ? String(row.normalized_object_id) : '',
    teacherName: row.teacher_name || '',
    createdAt: row.created_at,
    dateText: formatDateText(row.created_at),
    deleted: Boolean(row.is_deleted),
    deleteReason: row.delete_reason || '',
    isMessage,
    targetStatus: status,
    targetPrivate: unavailable,
    // 失效、历史与 message 均不下发可点击 target，杜绝旧 target 绕过导航复核。
    target: (unavailable || isHistory || isMessage) ? null : assignmentTarget(row)
  };
}

export async function getTodayHomework(student) {
  // 先确定最新有效批次的 operation_id，再取整批全部行；不再 LIMIT 20 后在 JS 里猜批次。
  const latest = await pool.query(
    `SELECT operation_id, MAX(created_at) AS created_at
       FROM user_assignments
      WHERE user_id = $1
        AND is_deleted = FALSE
      GROUP BY operation_id
      ORDER BY MAX(created_at) DESC, operation_id DESC
      LIMIT 1`,
    [student.id]
  );
  if (latest.rowCount === 0 || !latest.rows[0]) {
    return { student, latestHomework: null };
  }
  const operation = latest.rows[0];

  // 当前显示（标题/封面/P序号/父ID/稳定ID/状态）统一复用共享投影。
  const result = await pool.query(
    `SELECT ua.id, ua.operation_id, ua.object_type, ua.object_id, ua.video_id, ua.part_id,
            ua.message, ua.is_deleted, ua.delete_reason, ua.created_at,
            COALESCE(NULLIF(ua.practice_requirement, ''), CASE WHEN COALESCE(ua.object_type, CASE WHEN ua.video_id IS NOT NULL THEN 'video' ELSE 'message' END) = 'message' THEN ua.message ELSE '' END) AS practice_requirement,
            COALESCE(ua.submit_requirement, '') AS submit_requirement,
            ${assignmentTargetProjection().join(',\n            ')},
            COALESCE(a.nickname, a.username, a.account, '') AS teacher_name
       FROM user_assignments ua
       ${assignmentTargetJoins()}
      WHERE ua.user_id = $1
        AND ua.operation_id = $2
        AND ua.is_deleted = FALSE
      ORDER BY ua.created_at ASC, ua.id ASC`,
    [student.id, operation.operation_id]
  );

  const rows = result.rows;
  const first = rows[0] || {};
  // 要求从整批聚合：message 行不算资源卡也不占 5 项额度，但它的 message 仍需作为练习要求独立保留。
  const messageText = rows.find((row) => row.object_type === 'message' && row.message)?.message || '';
  const practiceRequirement = rows.find((row) => row.practice_requirement)?.practice_requirement || messageText;
  const submitRequirement = rows.find((row) => row.submit_requirement)?.submit_requirement || '';
  // 失效目标（private/missing）全量保留灰框。
  const items = rows
    .filter((row) => (row.object_type || (row.video_id ? 'video' : 'message')) !== 'message')
    .map((row) => serializeAssignment(row, 'today'));

  return {
    student,
    latestHomework: {
      id: String(operation.operation_id),
      operationId: String(operation.operation_id),
      title: '最新作业',
      teacherName: first.teacher_name || '',
      createdAt: first.created_at || operation.created_at,
      dateText: formatDateText(first.created_at || operation.created_at),
      practiceRequirement,
      submitRequirement,
      items
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
  // 快照专用投影：标题只读布置时固化的快照列，不套失效文案、不输出任何导航 target。
  const rowsResult = await pool.query(
    `SELECT ua.id, ua.operation_id, ua.object_type, ua.object_id, ua.video_id, ua.part_id,
            ua.created_at, ua.is_deleted, ua.delete_reason,
            ua.practice_requirement, ua.submit_requirement,
            ${assignmentSnapshotTitleExpr()} AS title,
            ${assignmentTargetStatusExpr()} AS target_status,
            ${assignmentTargetPrivateExpr()} AS target_private,
            COALESCE(a.nickname, a.username, a.account, '') AS teacher_name
       FROM user_assignments ua
       ${assignmentTargetJoins()}
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
    // message 不渲染为资源卡；已撤销作业仍保留（deleteReason 展示），保持原口径。
    if ((row.object_type || (row.video_id ? 'video' : 'message')) === 'message') continue;
    if (group.items.length < 5) group.items.push(serializeAssignment(row, 'history'));
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

async function listContent({ table, collectionTable, kind, contentType, keyword = '', page = 1, pageSize = 20, sort = 'updated_desc', canView = true }) {
  const safePage = toInt(page, 1);
  const safePageSize = Math.min(toInt(pageSize, 20), 50);
  const offset = (safePage - 1) * safePageSize;
  const order = resolveSort(sort);
  const params = [];
  const conditions = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  // 非私密查看者（学生/游客）：课程点需父 public 且存在公开 P；集合需含至少一个可见子项。
  if (!canView) {
    conditions.push(collectionTable ? publicCollectionPredicate(contentType) : publicCoursePredicate(contentType));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table} c ${where}`, params);
  params.push(safePageSize, offset);
  const result = await pool.query(
    `SELECT id, name, cover, description, created_at, updated_at
       FROM ${table} c
       ${where}
      ORDER BY ${order.column} ${order.order}, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const collectionIds = result.rows.map((row) => row.id);
  let countMap = new Map();
  if (collectionTable && collectionIds.length > 0) {
    // 统计仅计入对当前查看者可见的子项（子项本身 public）。
    const cfg = CONTENT_TYPES[contentType];
    const countResult = await pool.query(
      `SELECT ci.collection_id, COUNT(CASE WHEN ${canView ? 'TRUE' : publicCoursePredicate(contentType).replaceAll('c.', 'i.')} THEN ci.collection_id END)::int AS count
         FROM ${collectionTable} ci
         JOIN ${cfg.courseTable} i ON i.id = ci.${cfg.collectionItemCol}
        WHERE ci.collection_id = ANY($1::int[])
        GROUP BY ci.collection_id`,
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

export async function listTracks(query, viewer) {
  const canView = canViewPrivate(viewer);
  const type = query.type || 'track_point';
  if (type === 'track_collection') {
    return listContent({ ...query, table: 'track_collections', collectionTable: 'track_collection_items', kind: 'track_collection', contentType: 'track_point', canView });
  }
  return listContent({ ...query, table: 'track_points', collectionTable: '', kind: 'track_point', contentType: 'track_point', canView });
}

export async function listKnowledge(query, viewer) {
  const canView = canViewPrivate(viewer);
  const type = query.type || 'knowledge_point';
  if (type === 'knowledge_collection') {
    return listContent({ ...query, table: 'knowledge_collections', collectionTable: 'knowledge_collection_items', kind: 'knowledge_collection', contentType: 'knowledge_point', canView });
  }
  return listContent({ ...query, table: 'knowledge_points', collectionTable: '', kind: 'knowledge_point', contentType: 'knowledge_point', canView });
}

function formatRendition(row = {}, options = {}) {
  const quality = String(row.quality || 'source');
  const videoUrl = normalizePublicUrl(row.video_url || '');
  // 可见性仅为业务展示（阶段 A/B 已是实际文件）：始终返回经 CDN 转换后的原 COS 公开播放地址，
  // 不再按可见性剥离永久 URL。
  return {
    quality,
    label: quality === 'source' ? '原画' : quality.toUpperCase(),
    videoUrl,
    // 兼容式新增：CDN 播放地址；原 videoUrl 仍保留 COS 原值。
    playUrl: toPlaybackUrl(videoUrl),
    fileSize: Number(row.file_size || 0),
    status: row.status || '',
    updatedAt: row.updated_at || ''
  };
}

async function getParts(table, parentColumn, parentId, canView = true) {
  const visibilityFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(p.visibility, ''), 'public') = 'public'`;
  const result = await pool.query(
    `SELECT p.id, p.part_no, p.title, p.duration, p.video_id, p.visibility, v.video_url, v.cover_url
       FROM ${table} p
       LEFT JOIN videos v ON v.id = p.video_id
      WHERE p.${parentColumn} = $1 ${visibilityFilter}
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

  // 可见性仅为业务展示（阶段 A/B 已是实际文件）：所有返回的 P 均返回经 CDN 转换后的
  // 原 COS 公开播放地址，不再按可见性剥离永久 URL。学生等未授权查看者已在上面的
  // SQL visibilityFilter 中过滤掉私密 P，不会拿到私密记录。
  return result.rows.map((row) => {
    const sourceUrl = normalizePublicUrl(row.video_url || '');
    const renditions = renditionsByVideoId.get(row.video_id) || [];
    if (sourceUrl && !renditions.some((item) => item.quality === 'source')) {
      // 兼容式新增：source 补项也提供 CDN 播放地址；原 videoUrl 保留 COS 原值。
      renditions.unshift({ quality: 'source', label: '原画', videoUrl: sourceUrl, playUrl: toPlaybackUrl(sourceUrl), fileSize: 0, status: 'ready', updatedAt: '' });
    }

    return {
      id: String(row.id),
      partNo: row.part_no,
      title: row.title,
      duration: row.duration,
      durationText: durationText(row.duration),
      videoId: row.video_id ? String(row.video_id) : '',
      videoUrl: sourceUrl,
      // 兼容式新增：CDN 播放地址；原 videoUrl 保留 COS 原值。
      playUrl: toPlaybackUrl(sourceUrl),
      coverUrl: normalizePublicUrl(row.cover_url || ''),
      renditions
    };
  });
}

export async function getTrackDetail(id, viewer) {
  const canView = canViewPrivate(viewer);
  const result = await pool.query(`SELECT id, name, cover, description, created_at, updated_at, visibility FROM track_points WHERE id = $1 ${canView ? '' : `AND ${publicCoursePredicate('track_point').replaceAll('c.', 'track_points.')}`}`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  // 私密曲目对非授权查看者不可见（与列表一致：隐藏而非暴露）。
  if (!canView && normalizeStoredVisibility(row.visibility) === PRIVATE) return null;
  const [attachments, directResources, prerequisites] = await Promise.all([
    getAttachments('track_point', row.id),
    getLinkedLibraryResources('track_point', row.id),
    getPrerequisites('track_point', row.id, canView)
  ]);

  return {
    id: String(row.id),
    type: 'track_point',
    title: row.name,
    coverUrl: normalizePublicUrl(row.cover || ''),
    description: row.description || '',
    parts: await getParts('track_parts', 'track_id', row.id, canView),
    attachments,
    libraryResources: directResources,
    prerequisites
  };
}

export async function getKnowledgeDetail(id, viewer) {
  const canView = canViewPrivate(viewer);
  const result = await pool.query(`SELECT id, name, cover, description, created_at, updated_at, visibility FROM knowledge_points WHERE id = $1 ${canView ? '' : `AND ${publicCoursePredicate('knowledge_point').replaceAll('c.', 'knowledge_points.')}`}`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  // 私密知识点对非授权查看者不可见（与列表一致：隐藏而非暴露）。
  if (!canView && normalizeStoredVisibility(row.visibility) === PRIVATE) return null;
  const [attachments, directResources, prerequisites] = await Promise.all([
    getAttachments('knowledge_point', row.id),
    getLinkedLibraryResources('knowledge_point', row.id),
    getPrerequisites('knowledge_point', row.id, canView)
  ]);

  return {
    id: String(row.id),
    type: 'knowledge_point',
    title: row.name,
    coverUrl: normalizePublicUrl(row.cover || ''),
    description: row.description || '',
    parts: await getParts('knowledge_parts', 'knowledge_point_id', row.id, canView),
    attachments,
    libraryResources: directResources,
    prerequisites
  };
}

async function getCollectionDetail({ id, table, itemsTable, itemTable, itemColumn, type, itemType, partsTable, canView = true }) {
  const result = await pool.query(`SELECT id, name, cover, description, created_at, updated_at FROM ${table} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;

  // 非私密查看者：仅可见“子项本身 public 且存在公开 P”的子项；无可见子项则整体隐藏。
  const itemVisibilityFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(i.visibility, ''), 'public') = 'public' AND EXISTS (SELECT 1 FROM ${partsTable} pp WHERE pp.${itemColumn} = i.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')`;
  const items = await pool.query(
    `SELECT i.id, i.name, i.cover, i.description, i.updated_at
       FROM ${itemsTable} ci
       JOIN ${itemTable} i ON i.id = ci.${itemColumn}
      WHERE ci.collection_id = $1 ${itemVisibilityFilter}
      ORDER BY ci.sort_order ASC, ci.created_at ASC, i.id ASC`,
    [id]
  );

  // 合集本身无 visibility：对非私密查看者，若没有任何可见子项则等同于“私密”，整体不可见。
  if (!canView && items.rowCount === 0) return null;

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

export function getTrackCollectionDetail(id, viewer) {
  const canView = canViewPrivate(viewer);
  return getCollectionDetail({ id, table: 'track_collections', itemsTable: 'track_collection_items', itemTable: 'track_points', itemColumn: 'track_id', type: 'track_collection', itemType: 'track_point', partsTable: 'track_parts', canView });
}

export function getKnowledgeCollectionDetail(id, viewer) {
  const canView = canViewPrivate(viewer);
  return getCollectionDetail({ id, table: 'knowledge_collections', itemsTable: 'knowledge_collection_items', itemTable: 'knowledge_points', itemColumn: 'knowledge_point_id', type: 'knowledge_collection', itemType: 'knowledge_point', partsTable: 'knowledge_parts', canView });
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
      WHERE object_type = $1 AND object_id = $2 AND visibility = 'public'
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

async function getPrerequisites(objectType, objectId, canView = true) {
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
        AND ($3::boolean = TRUE OR ${relatedCourseVisibleConditions('p.prerequisite_type')})
      ORDER BY p.prerequisite_type ASC, p.prerequisite_id ASC`,
    [objectType, objectId, canView]
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

async function getLibraryRelatedCourses(resourceId, canView = true) {
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
        AND ($2::boolean = TRUE OR ${relatedCourseVisibleConditions()})
      ORDER BY l.object_type ASC, l.object_id ASC`,
    [resourceId, canView]
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

export async function getLibraryDetail(id, viewer) {
  const canView = canViewPrivate(viewer);
  const result = await pool.query(
    'SELECT id, title, cover, file_url, file_size, file_type, created_at, updated_at FROM library_resources WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...serializeLibraryResource(row), relatedCourses: await getLibraryRelatedCourses(row.id, canView) };
}
