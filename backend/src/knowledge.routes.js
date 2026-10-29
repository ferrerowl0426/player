import { Router } from 'express';
import { saveContentAttachments } from './attachment-save.js';
import { serializeAttachments } from './attachment-access.js';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireSuperAdmin, optionalContentViewer } from './auth.js';
import {
  canViewPrivate,
  publicCoursePredicate,
  normalizeStoredVisibility,
  PRIVATE,
  resolveVisibilityInput,
  lockCourse,
  refreshCourseVisibility
} from './content-visibility.js';
import {
  assertPrivateWriteAllowed,
  finalizeCourseVisibility,
  findPrivatePartPrerequisiteConflicts,
  PrerequisiteConflictError
} from './content-privacy-config.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createUploadUrl,
  createMultipartPartUrl,
  deleteFromBucket,
  ensureObjectExists,
  getPublicUrl,
  normalizePublicUrl
} from './storage.js';
import { createInitialRenditions, deleteVideoObjects } from './transcode.js';
import { toPlaybackUrl } from './playback-url.js';
import { deleteWithReferences } from './deletion.js';
import { recordVisibilityRevocations, getVideoObjectKeys } from './revocation.js';

function id(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value) {
  return String(value ?? '').trim();
}

function orderedIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = id(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function videoKey(value) {
  return typeof value === 'string' && value.startsWith('knowledge/') && !value.includes('..');
}

function extension(value) {
  const match = String(value || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function mapContent(row) {
  return { ...row, cover: normalizePublicUrl(row.cover) };
}

function size(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function mapPart(row) {
  const videoUrl = normalizePublicUrl(row.video_url);
  return {
    ...row,
    video_url: videoUrl,
    video_cover_url: normalizePublicUrl(row.video_cover_url),
    // 兼容式新增：CDN 播放地址；原 video_url 仍保留 COS 原值。
    play_url: toPlaybackUrl(videoUrl)
  };
}

function multipartParts(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((part) => ({ partNumber: Number(part?.partNumber), etag: String(part?.etag || '').trim() }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.partNumber <= 10000 && part.etag && !seen.has(part.partNumber) && seen.add(part.partNumber))
    .sort((first, second) => first.partNumber - second.partNumber);
}

async function findKnowledgePoint(pointId) {
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at, visibility FROM knowledge_points WHERE id = $1', [pointId]);
  return result.rows[0] || null;
}

async function attachments(objectType, objectId, viewer) {
  const result = await pool.query(
    `SELECT id, visibility, file_name, file_url, file_key, file_type, file_size, sort_order, created_at
     FROM content_attachments WHERE object_type = $1 AND object_id = $2
     ORDER BY sort_order ASC, created_at ASC, id ASC`,
    [objectType, objectId]
  );
  return serializeAttachments(result.rows.map((row) => ({ ...row, file_url: normalizePublicUrl(row.file_url) })), viewer);
}

async function pointParts(pointId, canView = true) {
  const visibilityFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public'`;
  const result = await pool.query(
    `SELECT kp.id, kp.part_no, kp.title, kp.duration, kp.video_id, kp.visibility,
            v.video_url, v.cover_url AS video_cover_url
     FROM knowledge_parts kp LEFT JOIN videos v ON v.id = kp.video_id
     WHERE kp.knowledge_point_id = $1 ${visibilityFilter} ORDER BY kp.part_no ASC, kp.id ASC`,
    [pointId]
  );

  const rows = result.rows;
  const videoIds = rows.map((row) => row.video_id).filter(Boolean);
  const renditionsByVideoId = new Map();

  if (videoIds.length > 0) {
    const renditions = await pool.query(
      `SELECT video_id, quality, video_url, file_size, status, updated_at
       FROM video_renditions
       WHERE video_id = ANY($1::int[])
       ORDER BY CASE quality WHEN '1080p' THEN 1 WHEN '720p' THEN 2 WHEN 'source' THEN 3 ELSE 4 END`,
      [videoIds]
    );

    for (const rendition of renditions.rows) {
      const videoUrl = normalizePublicUrl(rendition.video_url);
      const list = renditionsByVideoId.get(rendition.video_id) || [];
      // 兼容式新增：CDN 播放地址 play_url；原 video_url 仍保留 COS 原值。
      list.push({ ...rendition, video_url: videoUrl, play_url: toPlaybackUrl(videoUrl) });
      renditionsByVideoId.set(rendition.video_id, list);
    }
  }

  return rows.map((row) => ({
    ...mapPart(row),
    renditions: renditionsByVideoId.get(row.video_id) || []
  }));
}

async function pointCollections(pointId) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.cover, c.description
     FROM knowledge_collection_items ci JOIN knowledge_collections c ON c.id = ci.collection_id
     WHERE ci.knowledge_point_id = $1 ORDER BY c.name ASC, c.id ASC`,
    [pointId]
  );
  return result.rows.map(mapContent);
}

function mapLibraryResource(row) {
  return {
    ...row,
    cover: normalizePublicUrl(row.cover),
    file_url: normalizePublicUrl(row.file_url)
  };
}

async function linkedLibraryResources(objectType, objectId) {
  const result = await pool.query(
    `SELECT lr.id, lr.title, lr.cover, lr.file_name, lr.file_url, lr.file_size, lr.updated_at,
            'direct' AS link_source,
            NULL::int AS source_collection_id,
            NULL::text AS source_collection_name
     FROM library_resource_links l
     JOIN library_resources lr ON lr.id = l.library_resource_id
     WHERE l.object_type = $1 AND l.object_id = $2
     ORDER BY lr.updated_at DESC, lr.id DESC`,
    [objectType, objectId]
  );

  return result.rows.map(mapLibraryResource);
}

async function pointLibraryResources(pointId) {
  const result = await pool.query(
    `WITH direct_links AS (
       SELECT lr.id, lr.title, lr.cover, lr.file_name, lr.file_url, lr.file_size, lr.updated_at,
              TRUE AS direct_link,
              ARRAY[]::int[] AS inherited_collection_ids,
              ARRAY[]::text[] AS inherited_collection_names
       FROM library_resource_links l
       JOIN library_resources lr ON lr.id = l.library_resource_id
       WHERE l.object_type = 'knowledge_point' AND l.object_id = $1
     ), inherited_links AS (
       SELECT lr.id, lr.title, lr.cover, lr.file_name, lr.file_url, lr.file_size, lr.updated_at,
              FALSE AS direct_link,
              ARRAY_AGG(DISTINCT kc.id ORDER BY kc.id) AS inherited_collection_ids,
              ARRAY_AGG(DISTINCT kc.name ORDER BY kc.name) AS inherited_collection_names
       FROM knowledge_collection_items kci
       JOIN knowledge_collections kc ON kc.id = kci.collection_id
       JOIN library_resource_links l ON l.object_type = 'knowledge_collection' AND l.object_id = kc.id
       JOIN library_resources lr ON lr.id = l.library_resource_id
       WHERE kci.knowledge_point_id = $1
       GROUP BY lr.id
     ), merged AS (
       SELECT * FROM direct_links
       UNION ALL
       SELECT * FROM inherited_links
     )
     SELECT id, MAX(title) AS title, MAX(cover) AS cover, MAX(file_name) AS file_name,
            MAX(file_url) AS file_url, MAX(file_size) AS file_size, MAX(updated_at) AS updated_at,
            BOOL_OR(direct_link) AS is_direct,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT inherited_collection_id), NULL) AS inherited_collection_ids,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT inherited_collection_name), NULL) AS inherited_collection_names
     FROM merged
     LEFT JOIN LATERAL UNNEST(inherited_collection_ids) AS inherited_collection_id ON TRUE
     LEFT JOIN LATERAL UNNEST(inherited_collection_names) AS inherited_collection_name ON TRUE
     GROUP BY id
     ORDER BY MAX(updated_at) DESC, id DESC`,
    [pointId]
  );

  return result.rows.map((row) => mapLibraryResource({
    ...row,
    link_source: row.is_direct && row.inherited_collection_ids?.length ? 'direct_and_inherited' : (row.is_direct ? 'direct' : 'inherited')
  }));
}

async function findCollection(collectionId) {
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at FROM knowledge_collections WHERE id = $1', [collectionId]);
  return result.rows[0] || null;
}

// 当前登录者（经 optionalContentViewer 解析）是否能查看私密内容：仅有效 teacher / super_admin。
function viewerCanSeePrivate(req) {
  return canViewPrivate(req.contentViewer);
}

// 游客/学生读取时，仅统计/列出公开 P。
function publicPartCountExpression(canView) {
  return canView
    ? 'COUNT(kpp.id)'
    : "COUNT(CASE WHEN COALESCE(NULLIF(kpp.visibility, ''), 'public') = 'public' THEN kpp.id END)";
}

// 知识点（knowledge_point）列表 / 搜索查询构造。
// 游客/学生：父课程必须满足 public 且存在至少一个公开 P（publicCoursePredicate），P 计数仅公开 P。
export function buildKnowledgePointsListQuery({ canView, keyword }) {
  const params = [];
  const conditions = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
    conditions.push(`($1 = '' OR c.name ILIKE $2 OR c.description ILIKE $2)`);
  }
  if (!canView) {
    conditions.push(publicCoursePredicate('knowledge_point'));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT c.id, c.name, c.cover, c.description, c.updated_at,
           ${publicPartCountExpression(canView)}::int AS part_count
    FROM knowledge_points c
    LEFT JOIN knowledge_parts kpp ON kpp.knowledge_point_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.id DESC`;
  return { sql, params };
}

// 知识点集（knowledge_collections）列表 / 搜索查询构造。
// 知识点集本身无 visibility 字段；游客/学生仅展示包含至少一个公开知识点的合集，point_count 仅统计可见知识点。
export function buildKnowledgeCollectionsListQuery({ canView, keyword }) {
  const params = [];
  const conditions = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
    conditions.push(`($1 = '' OR c.name ILIKE $2 OR c.description ILIKE $2)`);
  }
  if (!canView) {
    conditions.push(`EXISTS (
      SELECT 1 FROM knowledge_collection_items ci
      JOIN knowledge_points kp ON kp.id = ci.knowledge_point_id
      WHERE ci.collection_id = c.id
        AND COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public'
        AND EXISTS (SELECT 1 FROM knowledge_parts pp WHERE pp.knowledge_point_id = kp.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pointCountExpr = canView
    ? 'COUNT(ci.knowledge_point_id)'
    : `COUNT(CASE WHEN COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public' THEN ci.knowledge_point_id END)`;
  const sql = `
    SELECT c.id, c.name, c.cover, c.description, c.updated_at,
           ${pointCountExpr}::int AS point_count
    FROM knowledge_collections c
    LEFT JOIN knowledge_collection_items ci ON ci.collection_id = c.id
    LEFT JOIN knowledge_points kp ON kp.id = ci.knowledge_point_id
    ${where}
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.id DESC`;
  return { sql, params };
}

// 知识点集详情内的知识点查询构造：游客/学生仅可见公开知识点，P 计数仅公开 P。
export function buildKnowledgeCollectionPointsQuery({ canView, collectionId }) {
  const params = [collectionId];
  const courseFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(kp.visibility, ''), 'public') = 'public'
       AND EXISTS (SELECT 1 FROM knowledge_parts pp WHERE pp.knowledge_point_id = kp.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')`;
  const sql = `
    SELECT kp.id, kp.name, kp.cover, kp.description, kp.updated_at,
           ${publicPartCountExpression(canView)}::int AS part_count
    FROM knowledge_collection_items ci
    JOIN knowledge_points kp ON kp.id = ci.knowledge_point_id
    LEFT JOIN knowledge_parts kpp ON kpp.knowledge_point_id = kp.id
    WHERE ci.collection_id = $1 ${courseFilter}
    GROUP BY kp.id, ci.sort_order
    ORDER BY ci.sort_order ASC, kp.id ASC`;
  return { sql, params };
}

// 统一把带有 status 的已知错误映射为对应的 HTTP 响应（VisibilityError / 私密写入 / 前置引用冲突等）。
function respondVisibilityError(res, error) {
  if (error && error.status) {
    res.status(error.status).json({ message: error.message });
    return true;
  }
  return false;
}

export const knowledgeRouter = Router();

knowledgeRouter.get('/', optionalContentViewer, async (req, res, next) => {
  try {
    const keyword = text(req.query.keyword);
    const canView = viewerCanSeePrivate(req);
    const { sql: pointsSql, params: pointsParams } = buildKnowledgePointsListQuery({ canView, keyword });
    const { sql: collectionsSql, params: collectionsParams } = buildKnowledgeCollectionsListQuery({ canView, keyword });

    const [points, knowledgeCollections] = await Promise.all([
      pool.query(pointsSql, pointsParams),
      pool.query(collectionsSql, collectionsParams)
    ]);
    // 口径统一：与 /api/tracks 的 track_points / track_collections 对齐。
    // points 仅为旧字段兼容别名，新代码一律读 knowledge_points。
    const mappedPoints = points.rows.map(mapContent);
    res.json({
      data: {
        knowledge_points: mappedPoints,
        points: mappedPoints,
        knowledge_collections: knowledgeCollections.rows.map(mapContent)
      }
    });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.get('/collections/:id', optionalContentViewer, async (req, res, next) => {
  try {
    const collectionId = id(req.params.id);
    const collection = collectionId ? await findCollection(collectionId) : null;
    if (!collection) {
      res.status(collectionId ? 404 : 400).json({ message: collectionId ? '知识点集不存在' : '知识点集 ID 无效' });
      return;
    }
    const canView = viewerCanSeePrivate(req);
    const { sql, params } = buildKnowledgeCollectionPointsQuery({ canView, collectionId });
    const [points, libraryResources] = await Promise.all([
      pool.query(sql, params),
      linkedLibraryResources('knowledge_collection', collectionId)
    ]);
    res.json({ data: { ...mapContent(collection), points: points.rows.map(mapContent), attachments: await attachments('knowledge_collection', collectionId, req.contentViewer), library_resources: libraryResources } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.get('/:id', optionalContentViewer, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const point = pointId ? await findKnowledgePoint(pointId) : null;
    if (!point) {
      res.status(pointId ? 404 : 400).json({ message: pointId ? '知识点不存在' : '知识点 ID 无效' });
      return;
    }
    // 私密知识点对非授权访问者不可见（与列表一致的隐藏策略）。
    if (!viewerCanSeePrivate(req) && normalizeStoredVisibility(point.visibility) === PRIVATE) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    const canView = viewerCanSeePrivate(req);
    const parts = await pointParts(pointId, canView);
    if (!canView && !parts.length) return res.status(404).json({ message: '知识点不存在' });
    res.json({ data: { ...mapContent(point), parts, attachments: await attachments('knowledge_point', pointId, req.contentViewer || (req.admin ? { role: 'super_admin', status: 'active' } : null)), knowledge_collections: await pointCollections(pointId), library_resources: await pointLibraryResources(pointId) } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = text(req.body.name);
    if (!name) {
      res.status(400).json({ message: '请填写知识点名称' });
      return;
    }
    // 新建空课默认为 private：此时没有任何公开 P，派生可见性即为 private。
    // 这是派生默认态，不经私密写入开关拦截（私密写入开关只保护“新的私密写入”）。
    const result = await pool.query(
      `INSERT INTO knowledge_points (name, cover, description, visibility) VALUES ($1, $2, $3, 'private')
       RETURNING id, name, cover, description, created_at, updated_at, visibility`,
      [name, text(req.body.cover), text(req.body.description)]
    );
    res.status(201).json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/knowledge/:id
// 课程字段 visibility 只能派生（刷新得到），不接收前端输入。同事务锁父后保存并刷新派生可见性。
knowledgeRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const pointId = id(req.params.id);
    const name = text(req.body.name);
    if (!pointId || !name) {
      res.status(400).json({ message: '知识点参数无效' });
      return;
    }
    await client.query('BEGIN');
    // 锁父（知识点）后保存再刷新派生可见性。
    await lockCourse(client, 'knowledge_point', pointId);
    const previousVisibility = (await client.query('SELECT visibility FROM knowledge_points WHERE id = $1 FOR UPDATE', [pointId])).rows[0]?.visibility;
    const result = await client.query(
      `UPDATE knowledge_points SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING id, name, cover, description, created_at, updated_at, visibility`,
      [name, text(req.body.cover), text(req.body.description), pointId]
    );
    // 刷新派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'knowledge_point', pointId, previousVisibility);
    await client.query('COMMIT');
    res.json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (respondVisibilityError(res, error)) return;
    next(error);
  } finally {
    client.release();
  }
});

knowledgeRouter.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    if (!pointId) {
      res.status(400).json({ message: '知识点 ID 无效' });
      return;
    }
    const point = await pool.query('SELECT id, name FROM knowledge_points WHERE id = $1', [pointId]);
    if (!point.rowCount) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    const videos = await pool.query(
      `SELECT DISTINCT v.id, v.video_url, v.cover_url FROM knowledge_parts kp JOIN videos v ON v.id = kp.video_id WHERE kp.knowledge_point_id = $1`,
      [pointId]
    );
    for (const video of videos.rows) {
      await deleteVideoObjects(video.id, [video.video_url, video.cover_url]);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'knowledge_point', objectId: pointId, objectTitle: point.rows[0].name, adminId: req.admin.adminId });
      await client.query('DELETE FROM knowledge_points WHERE id = $1', [pointId]);
      for (const video of videos.rows) {
        await client.query('DELETE FROM videos WHERE id = $1', [video.id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/collections', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = text(req.body.name);
    if (!name) {
      res.status(400).json({ message: '请填写知识点集名称' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO knowledge_collections (name, cover, description) VALUES ($1, $2, $3)
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, text(req.body.cover), text(req.body.description)]
    );
    res.status(201).json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.patch('/collections/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const collectionId = id(req.params.id);
    const name = text(req.body.name);
    if (!collectionId || !name) {
      res.status(400).json({ message: '知识点集参数无效' });
      return;
    }
    const result = await pool.query(
      `UPDATE knowledge_collections SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING id, name, cover, description, created_at, updated_at`,
      [name, text(req.body.cover), text(req.body.description), collectionId]
    );
    if (!result.rowCount) {
      res.status(404).json({ message: '知识点集不存在' });
      return;
    }
    res.json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.delete('/collections/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const collectionId = id(req.params.id);
    if (!collectionId) {
      res.status(400).json({ message: '知识点集 ID 无效' });
      return;
    }
    const existing = await pool.query('SELECT id, name FROM knowledge_collections WHERE id = $1', [collectionId]);
    if (!existing.rowCount) {
      res.status(404).json({ message: '知识点集不存在' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'knowledge_collection', objectId: collectionId, objectTitle: existing.rows[0].name, adminId: req.admin.adminId });
      await client.query('DELETE FROM knowledge_collections WHERE id = $1', [collectionId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.patch('/collections/:id/points', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const collectionId = id(req.params.id);
    const pointIds = orderedIds(req.body.pointIds);
    await client.query('BEGIN');
    if (!(await client.query('SELECT 1 FROM knowledge_collections WHERE id = $1', [collectionId])).rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '知识点集不存在' });
      return;
    }
    if (pointIds.length && (await client.query('SELECT id FROM knowledge_points WHERE id = ANY($1::int[])', [pointIds])).rowCount !== pointIds.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '部分知识点不存在' });
      return;
    }
    await client.query('DELETE FROM knowledge_collection_items WHERE collection_id = $1', [collectionId]);
    if (pointIds.length) {
      await client.query(
        `INSERT INTO knowledge_collection_items (collection_id, knowledge_point_id, sort_order)
         SELECT $1, item.knowledge_point_id, item.sort_order
           FROM unnest($2::int[]) WITH ORDINALITY AS item(knowledge_point_id, sort_order)`,
        [collectionId, pointIds]
      );
    }
    await client.query('UPDATE knowledge_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [collectionId]);
    await client.query('COMMIT');
    res.json({ data: { collectionId, pointIds } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

knowledgeRouter.post('/:id/attachments/upload-url', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const fileName = text(req.body.fileName || req.body.name);
    const fileType = text(req.body.fileType || req.body.type) || 'application/octet-stream';
    const fileSize = size(req.body.fileSize || req.body.size);
    const fileExt = extension(fileName);
    if (!pointId || !fileName || !fileExt) {
      res.status(400).json({ message: '附件上传参数无效' });
      return;
    }
    if (!(await findKnowledgePoint(pointId))) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    const key = `attachments/knowledge_point/${pointId}/${uuid()}${fileExt}`;
    res.json({ data: { key, uploadUrl: await createUploadUrl({ key, contentType: fileType }), publicUrl: getPublicUrl(key), fileName, fileType, fileSize } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.put('/:id/attachments', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    if (!pointId) {
      res.status(400).json({ message: '知识点 ID 无效' });
      return;
    }
    if (!(await findKnowledgePoint(pointId))) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    await saveContentAttachments({ pool, objectType: 'knowledge_point', objectId: pointId, values: req.body.attachments, ensureObjectExists, getPublicUrl });
    res.json({ data: await attachments('knowledge_point', pointId, req.contentViewer || (req.admin ? { role: 'super_admin', status: 'active' } : null)) });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/:id/parts/upload/create', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const file = req.body.video;
    const partNo = id(req.body.partNo);
    const title = text(req.body.title);
    if (!pointId || !partNo || !title || !file?.name || !Number(file.size) || !String(file.type || '').startsWith('video/')) {
      res.status(400).json({ message: '知识点 P 上传参数无效' });
      return;
    }
    if (!(await findKnowledgePoint(pointId))) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    const key = `knowledge/${pointId}/${uuid()}${extension(file.name)}`;
    const uploadId = await createMultipartUpload({ key, contentType: file.type });
    res.json({ data: { pointId, partNo, title, video: { key, uploadId, publicUrl: getPublicUrl(key) } } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/:id/parts/upload/part-url', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = text(req.body.key);
    const uploadId = text(req.body.uploadId);
    const partNumber = Number(req.body.partNumber);
    if (!videoKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      res.status(400).json({ message: '知识点 P 分片参数无效' });
      return;
    }
    res.json({ data: { uploadUrl: await createMultipartPartUrl({ key, uploadId, partNumber }) } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/:id/parts/upload/complete', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = text(req.body.key);
    const uploadId = text(req.body.uploadId);
    const parts = multipartParts(req.body.parts);
    if (!videoKey(key) || !uploadId || !parts.length) {
      res.status(400).json({ message: '知识点 P 完成上传参数无效' });
      return;
    }
    await completeMultipartUpload({ key, uploadId, parts });
    await ensureObjectExists(key);
    res.json({ data: { key, publicUrl: getPublicUrl(key) } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.post('/:id/parts/upload/abort', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = text(req.body.key);
    const uploadId = text(req.body.uploadId);
    if (!videoKey(key) || !uploadId) {
      res.status(400).json({ message: '知识点 P 取消上传参数无效' });
      return;
    }
    await abortMultipartUpload({ key, uploadId });
    res.json({ message: '已取消知识点 P 上传' });
  } catch (error) {
    next(error);
  }
});

// POST /api/knowledge/:id/parts
// 同事务锁父后保存并刷新派生可见性。新 P 缺省 public；显式 private 受私密写入开关保护。
knowledgeRouter.post('/:id/parts', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const pointId = id(req.params.id);
    const partNo = id(req.body.partNo);
    const title = text(req.body.title);
    const duration = Math.max(0, Number(req.body.duration) || 0);
    const key = text(req.body.videoKey);
    if (!pointId || !partNo || !title || !videoKey(key)) {
      res.status(400).json({ message: '知识点 P 参数无效' });
      return;
    }
    const point = await findKnowledgePoint(pointId);
    if (!point) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    // 新 P 缺省 public；显式 private 受私密写入开关保护。
    const partVisibility = resolveVisibilityInput(req.body.visibility, undefined);
    await client.query('BEGIN');
    // 锁父（知识点）后保存并刷新派生可见性。
    await lockCourse(client, 'knowledge_point', pointId);
    const previousVisibility = (await client.query('SELECT visibility FROM knowledge_points WHERE id = $1 FOR UPDATE', [pointId])).rows[0]?.visibility;
    // 新私密写入（之前不存在该 P）需经开关保护。
    if (partVisibility === PRIVATE) {
      assertPrivateWriteAllowed(PRIVATE, undefined);
    }
    const videoHead = await ensureObjectExists(key);
    const video = (await client.query(
      `INSERT INTO videos (title, description, video_url, cover_url) VALUES ($1, $2, $3, '') RETURNING id, video_url`,
      [title, `知识点 ${point.name} 的 P${partNo}`, getPublicUrl(key)]
    )).rows[0];
    await createInitialRenditions(client, {
      videoId: video.id,
      sourceUrl: video.video_url,
      sourceSize: Number(videoHead.ContentLength || 0)
    });
    const part = (await client.query(
      `INSERT INTO knowledge_parts (knowledge_point_id, part_no, video_id, title, duration, visibility) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, knowledge_point_id, part_no, video_id, title, duration, visibility, created_at, updated_at`,
      [pointId, partNo, video.id, title, duration, partVisibility]
    )).rows[0];
    // 刷新父课程派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'knowledge_point', pointId, previousVisibility);
    await client.query('COMMIT');
    res.status(201).json({ data: { ...part, video_url: getPublicUrl(key) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // 政策拦截（私密写入开关 / 前置引用冲突）不删除已上传文件，便于管理员修正后重试。
    if (respondVisibilityError(res, error)) return;
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      await deleteFromBucket(text(req.body.videoKey || '')).catch(() => {});
      return;
    }
    await deleteFromBucket(text(req.body.videoKey || '')).catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

// PATCH /api/knowledge/:id/parts/:partId
// 同事务锁父后保存并刷新派生可见性。P 的 visibility 缺省保留旧值（旧 private 不被重置），
// 显式改私密受私密写入开关保护；课程因此“新变私密”时再经前置引用检查保护。
knowledgeRouter.patch('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const pointId = id(req.params.id);
    const partId = id(req.params.partId);
    const partNo = id(req.body.partNo);
    const title = text(req.body.title);
    const duration = Math.max(0, Number(req.body.duration) || 0);
    if (!pointId || !partId || !partNo || !title) {
      res.status(400).json({ message: '知识点 P 参数无效' });
      return;
    }
    await client.query('BEGIN');
    // 锁父（知识点）后保存并刷新派生可见性。
    await lockCourse(client, 'knowledge_point', pointId);
    const previousVisibility = (await client.query('SELECT visibility FROM knowledge_points WHERE id = $1 FOR UPDATE', [pointId])).rows[0]?.visibility;
    const currentPart = await client.query('SELECT visibility FROM knowledge_parts WHERE id = $1 AND knowledge_point_id = $2 FOR UPDATE', [partId, pointId]);
    if (!currentPart.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '知识点 P 不存在' });
      return;
    }
    // 缺省保留旧值；显式改私密（之前非 private）受开关保护。
    const partVisibility = resolveVisibilityInput(req.body.visibility, currentPart.rows[0].visibility);
    const partBecamePrivate = partVisibility === PRIVATE && normalizeStoredVisibility(currentPart.rows[0].visibility) !== PRIVATE;
    if (partBecamePrivate) {
      assertPrivateWriteAllowed(PRIVATE, currentPart.rows[0].visibility);
      // P 改私密会令其失公开，若该 P 正被其它内容作为前置项引用，须阻止并回滚。
      const conflicts = await findPrivatePartPrerequisiteConflicts(client, 'knowledge_point', partId);
      if (conflicts.length > 0) {
        throw new PrerequisiteConflictError('该知识点 P 正被其它内容作为前置项引用，无法转为私密，请先移除相关前置项');
      }
      // 记录需撤销的旧公开直链（视频原画 + 转码 + 封面），供云端 purge 与授权回收（E04）。
      const videoIdResult = await client.query('SELECT video_id FROM knowledge_parts WHERE id = $1', [partId]);
      const revokedVideoId = videoIdResult.rows[0]?.video_id;
      if (revokedVideoId) {
        const keys = await getVideoObjectKeys(client, revokedVideoId);
        await recordVisibilityRevocations(client, {
          objectType: 'knowledge_part', objectId: partId, keys,
          reason: '知识点 P 改为私密，撤销旧公开直链', adminId: req.admin.adminId
        });
      }
    }
    const result = await client.query(
      `UPDATE knowledge_parts SET part_no = $1, title = $2, duration = $3, visibility = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND knowledge_point_id = $6 RETURNING id, knowledge_point_id, part_no, video_id, title, duration, visibility, created_at, updated_at`,
      [partNo, title, duration, partVisibility, partId, pointId]
    );
    // 刷新父课程派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'knowledge_point', pointId, previousVisibility);
    await client.query('COMMIT');
    res.json({ data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (respondVisibilityError(res, error)) return;
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

// DELETE /api/knowledge/:id/parts/:partId
// 同事务锁父后删除 P 并刷新派生可见性。删除 P 可能导致课程变私密，
// 若“新变私密”则经私密写入开关与前置引用检查保护（409 回滚）。
knowledgeRouter.delete('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const partId = id(req.params.partId);
    const part = await pool.query(
      `SELECT kp.video_id, kp.title, v.video_url, v.cover_url FROM knowledge_parts kp LEFT JOIN videos v ON v.id = kp.video_id
       WHERE kp.id = $1 AND kp.knowledge_point_id = $2`,
      [partId, pointId]
    );
    if (!part.rowCount) {
      res.status(404).json({ message: '知识点 P 不存在' });
      return;
    }
    const item = part.rows[0];
    // Cloud cleanup must not precede a transaction that can be rejected.
    let removedVideo = false;
    const deferredFileKeys = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 锁父（知识点）后删除 P 并刷新派生可见性。
      await lockCourse(client, 'knowledge_point', pointId);
      const previousVisibility = (await client.query('SELECT visibility FROM knowledge_points WHERE id = $1 FOR UPDATE', [pointId])).rows[0]?.visibility;
      // 删除 P 前：若该 P 正被其它内容作为前置项引用，删除会使前置关系失效，须阻止。
      const partPrereqConflicts = await findPrivatePartPrerequisiteConflicts(client, 'knowledge_point', partId);
      if (partPrereqConflicts.length > 0) {
        throw new PrerequisiteConflictError('该知识点 P 正被其它内容作为前置项引用，无法删除，请先移除相关前置项');
      }
      await deleteWithReferences(client, { objectType: 'knowledge_part', objectId: partId, objectTitle: item.title || '', adminId: req.admin.adminId, deferredFileKeys });
      await client.query('DELETE FROM knowledge_parts WHERE id = $1 AND knowledge_point_id = $2', [partId, pointId]);
      await client.query('UPDATE knowledge_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pointId]);
      if (item.video_id && !(await client.query('SELECT 1 FROM knowledge_parts WHERE video_id = $1 UNION ALL SELECT 1 FROM track_parts WHERE video_id = $1 LIMIT 1', [item.video_id])).rowCount) {
        await client.query('DELETE FROM videos WHERE id = $1', [item.video_id]);
        removedVideo = true;
      }
      // 删除 P 可能导致课程变私密；若“新变私密”则经私密写入开关与前置引用检查保护。
      await finalizeCourseVisibility(client, 'knowledge_point', pointId, previousVisibility);
      await client.query('COMMIT');
      await Promise.all(deferredFileKeys.map((key) => deleteFromBucket(key).catch(() => {})));
      if (removedVideo) await deleteVideoObjects(item.video_id, [item.video_url, item.cover_url]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (respondVisibilityError(res, error)) return;
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
