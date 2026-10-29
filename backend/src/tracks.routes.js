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
  createMultipartPartUrl,
  createMultipartUpload,
  createUploadUrl,
  deleteFromBucket,
  ensureObjectExists,
  getPublicUrl,
  normalizePublicUrl
} from './storage.js';
import { createInitialRenditions, deleteVideoObjects } from './transcode.js';
import { toPlaybackUrl } from './playback-url.js';
import { filterPubliclyReadableVideos } from './playback-access.js';
import { deleteWithReferences } from './deletion.js';
import { recordVisibilityRevocations, getVideoObjectKeys } from './revocation.js';

function normalizeKeyword(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];
}

function normalizeOrderedIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = normalizeId(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function normalizeMultipartParts(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const parts = [];

  for (const value of values) {
    const partNumber = Number(value?.partNumber);
    const etag = String(value?.etag || '').trim();

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !etag || seen.has(partNumber)) {
      continue;
    }

    seen.add(partNumber);
    parts.push({ partNumber, etag });
  }

  return parts.sort((first, second) => first.partNumber - second.partNumber);
}

function getExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function isVideoKey(key) {
  return typeof key === 'string' && key.startsWith('tracks/') && !key.includes('..');
}

function mapTrack(row) {
  return {
    ...row,
    cover: normalizePublicUrl(row.cover),
    description: normalizeText(row.description)
  };
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

async function findTrack(trackId) {
  const result = await pool.query(
    `SELECT id, name, cover, description, created_at, updated_at, visibility
     FROM track_points WHERE id = $1`,
    [trackId]
  );
  return result.rows[0] || null;
}

async function findCollection(collectionId) {
  const result = await pool.query(
    `SELECT id, name, cover, description, created_at, updated_at
     FROM track_collections WHERE id = $1`,
    [collectionId]
  );
  return result.rows[0] || null;
}

async function getTrackParts(trackId, canView = true) {
  const visibilityFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(tp.visibility, ''), 'public') = 'public'`;
  const result = await pool.query(
    `SELECT tp.id, tp.part_no, tp.title, tp.duration, tp.video_id, tp.visibility,
            v.video_url, v.cover_url AS video_cover_url
     FROM track_parts tp
     LEFT JOIN videos v ON v.id = tp.video_id
     WHERE tp.track_id = $1 ${visibilityFilter}
     ORDER BY tp.part_no ASC, tp.id ASC`,
    [trackId]
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

  // 共享视频：任一宿主私密即视为私密（fail-closed）。非授权查看者需据此抹掉永久播放地址。
  // 授权查看者（教师/主任）本就能看私密内容，无需额外拦截。
  const publiclyReadableVideos = (videoIds.length > 0)
    ? await filterPubliclyReadableVideos(pool, videoIds)
    : null;

  return rows.map((row) => {
    const renditions = (renditionsByVideoId.get(row.video_id) || []).map((rendition) => ({ ...rendition }));
    if (isPartPlaybackCleared(row, canView, publiclyReadableVideos)) {
      // 私密 P / 共享私密宿主：返回 video_id 与 visibility，但清空永久 video_url / play_url
      // 与转码 URL，交由前端经授权端点（/playback/videos/:id/play-url）播放。
      return {
        ...mapPart(row),
        video_url: '',
        play_url: '',
        visibility: PRIVATE,
        renditions: renditions.map((rendition) => ({ ...rendition, video_url: '', play_url: '' }))
      };
    }
    return { ...mapPart(row), renditions };
  });
}

// 是否应抹掉该 P 的永久播放地址（fail-closed）：
//   - 私密 P：一律抹掉（教师/主任也走授权端点，由 /playback 端点按角色放行）。
//   - 公开 P 但所属视频存在任意私密宿主：非授权查看者抹掉（共享视频 fail-closed）。
function isPartPlaybackCleared(row, canView, publiclyReadableVideos) {
  if (normalizeStoredVisibility(row.visibility) === PRIVATE) return true;
  if (publiclyReadableVideos && !publiclyReadableVideos.has(row.video_id)) return true;
  return false;
}

async function getContentAttachments(objectType, objectId, viewer) {
  const result = await pool.query(
    `SELECT id, visibility, file_name, file_url, file_key, file_type, file_size, sort_order, created_at
     FROM content_attachments
     WHERE object_type = $1 AND object_id = $2
     ORDER BY sort_order ASC, created_at ASC, id ASC`,
    [objectType, objectId]
  );
  return serializeAttachments(result.rows.map((row) => ({ ...row, file_url: normalizePublicUrl(row.file_url) })), viewer);
}

function normalizeFileSize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

async function getTrackCollections(trackId) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.cover, c.description
     FROM track_collection_items ct
     JOIN track_collections c ON c.id = ct.collection_id
     WHERE ct.track_id = $1
     ORDER BY c.name ASC, c.id ASC`,
    [trackId]
  );
  return result.rows.map(mapTrack);
}

function mapLibraryResource(row) {
  return {
    ...row,
    cover: normalizePublicUrl(row.cover),
    file_url: normalizePublicUrl(row.file_url)
  };
}

async function getLinkedLibraryResources(objectType, objectId) {
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

async function getTrackLibraryResources(trackId) {
  const result = await pool.query(
    `WITH direct_links AS (
       SELECT lr.id, lr.title, lr.cover, lr.file_name, lr.file_url, lr.file_size, lr.updated_at,
              TRUE AS direct_link,
              ARRAY[]::int[] AS inherited_collection_ids,
              ARRAY[]::text[] AS inherited_collection_names
       FROM library_resource_links l
       JOIN library_resources lr ON lr.id = l.library_resource_id
       WHERE l.object_type = 'track_point' AND l.object_id = $1
     ), inherited_links AS (
       SELECT lr.id, lr.title, lr.cover, lr.file_name, lr.file_url, lr.file_size, lr.updated_at,
              FALSE AS direct_link,
              ARRAY_AGG(DISTINCT tc.id ORDER BY tc.id) AS inherited_collection_ids,
              ARRAY_AGG(DISTINCT tc.name ORDER BY tc.name) AS inherited_collection_names
       FROM track_collection_items tci
       JOIN track_collections tc ON tc.id = tci.collection_id
       JOIN library_resource_links l ON l.object_type = 'track_collection' AND l.object_id = tc.id
       JOIN library_resources lr ON lr.id = l.library_resource_id
       WHERE tci.track_id = $1
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
    [trackId]
  );

  return result.rows.map((row) => mapLibraryResource({
    ...row,
    link_source: row.is_direct && row.inherited_collection_ids?.length ? 'direct_and_inherited' : (row.is_direct ? 'direct' : 'inherited')
  }));
}

// 当前登录者（经 optionalContentViewer 解析）是否能查看私密内容：仅有效 teacher / super_admin。
function viewerCanSeePrivate(req) {
  return canViewPrivate(req.contentViewer);
}

// 游客/学生读取时，仅统计/列出公开 P。
function publicPartCountExpression(canView) {
  return canView
    ? 'COUNT(tp.id)'
    : "COUNT(CASE WHEN COALESCE(NULLIF(tp.visibility, ''), 'public') = 'public' THEN tp.id END)";
}

// 曲目（track_point）列表 / 搜索查询构造。
// 游客/学生：父课程必须满足 public 且存在至少一个公开 P（publicCoursePredicate），P 计数仅公开 P。
export function buildTrackPointsListQuery({ canView, keyword }) {
  const params = [];
  const conditions = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  if (!canView) {
    conditions.push(publicCoursePredicate('track_point'));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT c.id, c.name, c.cover, c.description, c.updated_at,
           ${publicPartCountExpression(canView)}::int AS part_count
    FROM track_points c
    LEFT JOIN track_parts tp ON tp.track_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.id DESC`;
  return { sql, params };
}

// 曲谱集（track_collections）列表 / 搜索查询构造。
// 曲谱集本身无 visibility 字段；游客/学生仅展示包含至少一个公开曲目的合集，track_count 仅统计可见曲目。
export function buildTrackCollectionsListQuery({ canView, keyword }) {
  const params = [];
  const conditions = [];
  if (keyword) {
    params.push(`%${keyword}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  if (!canView) {
    conditions.push(`EXISTS (
      SELECT 1 FROM track_collection_items ci
      JOIN track_points tp ON tp.id = ci.track_id
      WHERE ci.collection_id = c.id
        AND COALESCE(NULLIF(tp.visibility, ''), 'public') = 'public'
        AND EXISTS (SELECT 1 FROM track_parts pp WHERE pp.track_id = tp.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const trackCountExpr = canView
    ? 'COUNT(ct.track_id)'
    : `COUNT(CASE WHEN COALESCE(NULLIF(tp.visibility, ''), 'public') = 'public' THEN ct.track_id END)`;
  const sql = `
    SELECT c.id, c.name, c.cover, c.description, c.updated_at,
           ${trackCountExpr}::int AS track_count
    FROM track_collections c
    LEFT JOIN track_collection_items ct ON ct.collection_id = c.id
    LEFT JOIN track_points tp ON tp.id = ct.track_id
    ${where}
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.id DESC`;
  return { sql, params };
}

// 曲谱集详情内的曲目查询构造：游客/学生仅可见公开曲目，P 计数仅公开 P。
export function buildTrackCollectionTracksQuery({ canView, collectionId }) {
  const params = [collectionId];
  const courseFilter = canView
    ? ''
    : `AND COALESCE(NULLIF(t.visibility, ''), 'public') = 'public'
       AND EXISTS (SELECT 1 FROM track_parts pp WHERE pp.track_id = t.id AND COALESCE(NULLIF(pp.visibility, ''), 'public') = 'public')`;
  const sql = `
    SELECT t.id, t.name, t.cover, t.description, t.updated_at,
           ${publicPartCountExpression(canView)}::int AS part_count
    FROM track_collection_items ct
    JOIN track_points t ON t.id = ct.track_id
    LEFT JOIN track_parts tp ON tp.track_id = t.id
    WHERE ct.collection_id = $1 ${courseFilter}
    GROUP BY t.id, ct.sort_order
    ORDER BY ct.sort_order ASC, t.id ASC`;
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

export const tracksRouter = Router();

// GET /api/tracks
// 曲目库首页公开接口：游客、学员、老师和教导主任都可以访问。
// 仅有效 teacher / super_admin 能读取私密；游客/学生按父课程可见性 + 公开 P 过滤，P 计数仅公开 P。
tracksRouter.get('/', optionalContentViewer, async (req, res, next) => {
  try {
    const keyword = normalizeKeyword(req.query.keyword);
    const canView = viewerCanSeePrivate(req);
    const { sql: tracksSql, params: tracksParams } = buildTrackPointsListQuery({ canView, keyword });
    const { sql: collectionsSql, params: collectionsParams } = buildTrackCollectionsListQuery({ canView, keyword });

    const [tracksResult, collectionsResult] = await Promise.all([
      pool.query(tracksSql, tracksParams),
      pool.query(collectionsSql, collectionsParams)
    ]);

    res.json({
      data: {
        track_points: tracksResult.rows.map(mapTrack),
        track_collections: collectionsResult.rows.map(mapTrack)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tracks/:id
tracksRouter.get('/:id', optionalContentViewer, async (req, res, next) => {
  if (req.params.id === 'collections') {
    next();
    return;
  }

  try {
    const trackId = normalizeId(req.params.id);

    if (!trackId) {
      res.status(400).json({ message: '曲目 ID 无效' });
      return;
    }

    const track = await findTrack(trackId);

    if (!track) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    // 私密曲目对非授权访问者不可见（与列表一致的隐藏策略）。
    if (!viewerCanSeePrivate(req) && normalizeStoredVisibility(track.visibility) === PRIVATE) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    const canView = viewerCanSeePrivate(req);
    const [parts, attachments, track_collections, library_resources] = await Promise.all([
      getTrackParts(trackId, canView),
      getContentAttachments('track_point', trackId, req.contentViewer || (req.admin ? { role: 'super_admin', status: 'active' } : null)),
      getTrackCollections(trackId),
      getTrackLibraryResources(trackId)
    ]);
    if (!canView && !parts.length) return res.status(404).json({ message: '曲目不存在' });

    res.json({
      data: {
        ...mapTrack(track),
        parts,
        attachments,
        track_collections,
        library_resources
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tracks/collections/:id
// 曲谱集详情公开接口。游客/学生仅可见公开曲目，P 计数仅公开 P。
tracksRouter.get('/collections/:id', optionalContentViewer, async (req, res, next) => {
  try {
    const collectionId = normalizeId(req.params.id);

    if (!collectionId) {
      res.status(400).json({ message: '曲谱集 ID 无效' });
      return;
    }

    const collection = await findCollection(collectionId);

    if (!collection) {
      res.status(404).json({ message: '曲谱集不存在' });
      return;
    }

    const canView = viewerCanSeePrivate(req);
    const { sql, params } = buildTrackCollectionTracksQuery({ canView, collectionId });

    const [tracksResult, libraryResources] = await Promise.all([
      pool.query(sql, params),
      getLinkedLibraryResources('track_collection', collectionId)
    ]);

    res.json({
      data: {
        ...mapTrack(collection),
        track_points: tracksResult.rows.map(mapTrack),
        attachments: await getContentAttachments('track_collection', collectionId, req.contentViewer),
        library_resources: libraryResources
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks
tracksRouter.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const cover = normalizeText(req.body.cover);

    if (!name) {
      res.status(400).json({ message: '请填写曲目名称' });
      return;
    }

    // 新建空课默认为 private：此时没有任何公开 P，派生可见性即为 private。
    // 这是派生默认态，不经私密写入开关拦截（私密写入开关只保护“新的私密写入”）。
    const result = await pool.query(
      `INSERT INTO track_points (name, cover, description, visibility)
       VALUES ($1, $2, $3, 'private')
       RETURNING id, name, cover, description, created_at, updated_at, visibility`,
      [name, cover, description]
    );

    res.status(201).json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tracks/:id
// 课程字段 visibility 只能派生（刷新得到），不接收前端输入。同事务锁父后保存并刷新派生可见性。
tracksRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const trackId = normalizeId(req.params.id);
    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const cover = normalizeText(req.body.cover);

    if (!trackId || !name) {
      res.status(400).json({ message: '曲目参数无效' });
      return;
    }

    await client.query('BEGIN');
    // 锁父（曲目）后保存再刷新派生可见性。
    await lockCourse(client, 'track_point', trackId);
    const previousVisibility = (await client.query('SELECT visibility FROM track_points WHERE id = $1 FOR UPDATE', [trackId])).rows[0]?.visibility;
    const result = await client.query(
      `UPDATE track_points
       SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, name, cover, description, created_at, updated_at, visibility`,
      [name, cover, description, trackId]
    );
    // 刷新派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'track_point', trackId, previousVisibility);
    await client.query('COMMIT');
    res.json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (respondVisibilityError(res, error)) return;
    next(error);
  } finally {
    client.release();
  }
});

// DELETE /api/tracks/:id
tracksRouter.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);

    if (!trackId) {
      res.status(400).json({ message: '曲目 ID 无效' });
      return;
    }

    const track = await findTrack(trackId);
    if (!track) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    const partsResult = await pool.query(
      `SELECT DISTINCT v.id, v.video_url, v.cover_url
       FROM track_parts tp
       JOIN videos v ON v.id = tp.video_id
       WHERE tp.track_id = $1`,
      [trackId]
    );

    for (const video of partsResult.rows) {
      await deleteVideoObjects(video.id, [video.video_url, video.cover_url]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'track_point', objectId: trackId, objectTitle: track.name, adminId: req.admin.adminId });
      const result = await client.query('DELETE FROM track_points WHERE id = $1 RETURNING id', [trackId]);
      for (const video of partsResult.rows) {
        await client.query('DELETE FROM videos WHERE id = $1', [video.id]);
      }
      await client.query('COMMIT');
      if (result.rowCount === 0) {
        res.status(404).json({ message: '曲目不存在' });
        return;
      }
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

// POST /api/tracks/:id/attachments/upload-url
tracksRouter.post('/:id/attachments/upload-url', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);
    const fileName = normalizeText(req.body.fileName || req.body.name);
    const fileType = normalizeText(req.body.fileType || req.body.type) || 'application/octet-stream';
    const fileSize = normalizeFileSize(req.body.fileSize || req.body.size);
    const fileExt = getExtension(fileName);

    if (!trackId || !fileName || !fileExt) {
      res.status(400).json({ message: '附件上传参数无效' });
      return;
    }

    if (!(await findTrack(trackId))) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    const key = `attachments/track_point/${trackId}/${uuid()}${fileExt}`;
    const uploadUrl = await createUploadUrl({ key, contentType: fileType });
    res.json({ data: { key, uploadUrl, publicUrl: getPublicUrl(key), fileName, fileType, fileSize } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tracks/:id/attachments
tracksRouter.put('/:id/attachments', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);
    if (!trackId) {
      res.status(400).json({ message: '曲目 ID 无效' });
      return;
    }

    if (!(await findTrack(trackId))) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    await saveContentAttachments({ pool, objectType: 'track_point', objectId: trackId, values: req.body.attachments, ensureObjectExists, getPublicUrl });
    res.json({ data: await getContentAttachments('track_point', trackId, req.contentViewer || (req.admin ? { role: 'super_admin', status: 'active' } : null)) });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks/:id/parts/upload/create
tracksRouter.post('/:id/parts/upload/create', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);
    const file = req.body.video;
    const title = normalizeText(req.body.title);
    const partNo = normalizeId(req.body.partNo);

    if (!trackId || !partNo || !title || !file?.name || !Number(file.size) || !String(file.type || '').startsWith('video/')) {
      res.status(400).json({ message: 'P 分段上传参数无效' });
      return;
    }

    const track = await findTrack(trackId);
    if (!track) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    const videoKey = `tracks/${trackId}/${uuid()}${getExtension(file.name)}`;
    const uploadId = await createMultipartUpload({ key: videoKey, contentType: file.type });

    res.json({ data: { trackId, partNo, title, video: { key: videoKey, uploadId, publicUrl: getPublicUrl(videoKey) } } });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks/:id/parts/upload/part-url
tracksRouter.post('/:id/parts/upload/part-url', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = String(req.body.key || '');
    const uploadId = String(req.body.uploadId || '').trim();
    const partNumber = Number(req.body.partNumber);

    if (!isVideoKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      res.status(400).json({ message: 'P 分段分片参数无效' });
      return;
    }

    const uploadUrl = await createMultipartPartUrl({ key, uploadId, partNumber });
    res.json({ data: { uploadUrl } });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks/:id/parts/upload/complete
tracksRouter.post('/:id/parts/upload/complete', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = String(req.body.key || '');
    const uploadId = String(req.body.uploadId || '').trim();
    const parts = normalizeMultipartParts(req.body.parts);

    if (!isVideoKey(key) || !uploadId || parts.length === 0) {
      res.status(400).json({ message: 'P 分段完成上传参数无效' });
      return;
    }

    await completeMultipartUpload({ key, uploadId, parts });
    await ensureObjectExists(key);
    res.json({ data: { key, publicUrl: getPublicUrl(key) } });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks/:id/parts/upload/abort
tracksRouter.post('/:id/parts/upload/abort', requireSuperAdmin, async (req, res, next) => {
  try {
    const key = String(req.body.key || '');
    const uploadId = String(req.body.uploadId || '').trim();

    if (!isVideoKey(key) || !uploadId) {
      res.status(400).json({ message: 'P 分段取消上传参数无效' });
      return;
    }

    await abortMultipartUpload({ key, uploadId });
    res.json({ message: '已取消 P 分段上传' });
  } catch (error) {
    next(error);
  }
});

// POST /api/tracks/:id/parts
// 同事务锁父后保存并刷新派生可见性。新 P 缺省 public；显式 private 受私密写入开关保护。
tracksRouter.post('/:id/parts', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const trackId = normalizeId(req.params.id);
    const partNo = normalizeId(req.body.partNo);
    const title = normalizeText(req.body.title);
    const duration = Math.max(0, Number(req.body.duration) || 0);
    const videoKey = String(req.body.videoKey || '');

    if (!trackId || !partNo || !title || !isVideoKey(videoKey)) {
      res.status(400).json({ message: 'P 分段参数无效' });
      return;
    }

    const track = await findTrack(trackId);
    if (!track) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    // 新 P 缺省 public；显式 private 受私密写入开关保护。
    const partVisibility = resolveVisibilityInput(req.body.visibility, undefined);

    await client.query('BEGIN');
    // 锁父（曲目）后保存并刷新派生可见性。
    await lockCourse(client, 'track_point', trackId);
    const previousVisibility = (await client.query('SELECT visibility FROM track_points WHERE id = $1 FOR UPDATE', [trackId])).rows[0]?.visibility;
    // 新私密写入（之前不存在该 P）需经开关保护。
    if (partVisibility === PRIVATE) {
      assertPrivateWriteAllowed(PRIVATE, undefined);
    }
    const videoHead = await ensureObjectExists(videoKey);
    const videoUrl = getPublicUrl(videoKey);
    const videoResult = await client.query(
      `INSERT INTO videos (title, description, video_url, cover_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, video_url, cover_url, created_at`,
      [title, `曲目 ${track.name} 的 P${partNo}`, videoUrl, '']
    );
    const video = videoResult.rows[0];
    await createInitialRenditions(client, {
      videoId: video.id,
      sourceUrl: video.video_url,
      sourceSize: Number(videoHead.ContentLength || 0)
    });
    const partResult = await client.query(
      `INSERT INTO track_parts (track_id, part_no, video_id, title, duration, visibility)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, track_id, part_no, video_id, title, duration, visibility, created_at, updated_at`,
      [trackId, partNo, video.id, title, duration, partVisibility]
    );
    // 刷新父课程派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'track_point', trackId, previousVisibility);
    await client.query('COMMIT');
    res.status(201).json({ data: { ...partResult.rows[0], video_url: videoUrl, video_size: Number(videoHead.ContentLength || 0) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // 政策拦截（私密写入开关 / 前置引用冲突）不删除已上传文件，便于管理员修正后重试。
    if (respondVisibilityError(res, error)) return;
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      await deleteFromBucket(videoKey).catch(() => {});
      return;
    }
    await deleteFromBucket(videoKey).catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

// PATCH /api/tracks/:id/parts/:partId
// 同事务锁父后保存并刷新派生可见性。P 的 visibility 缺省保留旧值（旧 private 不被重置），
// 显式改私密受私密写入开关保护；课程因此“新变私密”时再经前置引用检查保护。
tracksRouter.patch('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const trackId = normalizeId(req.params.id);
    const partId = normalizeId(req.params.partId);
    const partNo = normalizeId(req.body.partNo);
    const title = normalizeText(req.body.title);
    const duration = Math.max(0, Number(req.body.duration) || 0);

    if (!trackId || !partId || !partNo || !title) {
      res.status(400).json({ message: 'P 分段参数无效' });
      return;
    }

    await client.query('BEGIN');
    // 锁父（曲目）后保存并刷新派生可见性。
    await lockCourse(client, 'track_point', trackId);
    const previousVisibility = (await client.query('SELECT visibility FROM track_points WHERE id = $1 FOR UPDATE', [trackId])).rows[0]?.visibility;
    const currentPart = await client.query('SELECT visibility FROM track_parts WHERE id = $1 AND track_id = $2 FOR UPDATE', [partId, trackId]);
    if (currentPart.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'P 分段不存在' });
      return;
    }
    // 缺省保留旧值；显式改私密（之前非 private）受开关保护。
    const partVisibility = resolveVisibilityInput(req.body.visibility, currentPart.rows[0].visibility);
    const partBecamePrivate = partVisibility === PRIVATE && normalizeStoredVisibility(currentPart.rows[0].visibility) !== PRIVATE;
    if (partBecamePrivate) {
      assertPrivateWriteAllowed(PRIVATE, currentPart.rows[0].visibility);
      // P 改私密会令其失公开，若该 P 正被其它内容作为前置项引用，须阻止并回滚。
      const conflicts = await findPrivatePartPrerequisiteConflicts(client, 'track_point', partId);
      if (conflicts.length > 0) {
        throw new PrerequisiteConflictError('该分 P 正被其它内容作为前置项引用，无法转为私密，请先移除相关前置项');
      }
      // 记录需撤销的旧公开直链（视频原画 + 转码 + 封面），供云端 purge 与授权回收（E04）。
      const videoIdResult = await client.query('SELECT video_id FROM track_parts WHERE id = $1', [partId]);
      const revokedVideoId = videoIdResult.rows[0]?.video_id;
      if (revokedVideoId) {
        const keys = await getVideoObjectKeys(client, revokedVideoId);
        await recordVisibilityRevocations(client, {
          objectType: 'track_part', objectId: partId, keys,
          reason: '分 P 改为私密，撤销旧公开直链', adminId: req.admin.adminId
        });
      }
    }
    const result = await client.query(
      `UPDATE track_parts
       SET part_no = $1, title = $2, duration = $3, visibility = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND track_id = $6
       RETURNING id, track_id, part_no, video_id, title, duration, visibility, created_at, updated_at`,
      [partNo, title, duration, partVisibility, partId, trackId]
    );
    // 刷新父课程派生可见性；若因此“新变私密”则经私密写入开关与前置引用检查保护。
    await finalizeCourseVisibility(client, 'track_point', trackId, previousVisibility);
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

// DELETE /api/tracks/:id/parts/:partId
// 同事务锁父后删除 P 并刷新派生可见性。删除 P 可能导致课程变私密，
// 若“新变私密”则经私密写入开关与前置引用检查保护（409 回滚）。
tracksRouter.delete('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);
    const partId = normalizeId(req.params.partId);

    if (!trackId || !partId) {
      res.status(400).json({ message: 'P 分段参数无效' });
      return;
    }

    const partResult = await pool.query(
      `SELECT tp.video_id, v.video_url, v.cover_url
       FROM track_parts tp
       LEFT JOIN videos v ON v.id = tp.video_id
       WHERE tp.id = $1 AND tp.track_id = $2`,
      [partId, trackId]
    );

    if (partResult.rowCount === 0) {
      res.status(404).json({ message: 'P 分段不存在' });
      return;
    }

    const part = partResult.rows[0];
    // Only remove cloud objects after authorization and database commit succeed.
    let removedVideo = false;
    const deferredFileKeys = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 锁父（曲目）后删除 P 并刷新派生可见性。
      await lockCourse(client, 'track_point', trackId);
      const previousVisibility = (await client.query('SELECT visibility FROM track_points WHERE id = $1 FOR UPDATE', [trackId])).rows[0]?.visibility;
      // 删除 P 前：若该 P 正被其它内容作为前置项引用，删除会使前置关系失效，须阻止。
      const partPrereqConflicts = await findPrivatePartPrerequisiteConflicts(client, 'track_point', partId);
      if (partPrereqConflicts.length > 0) {
        throw new PrerequisiteConflictError('该分 P 正被其它内容作为前置项引用，无法删除，请先移除相关前置项');
      }
      await deleteWithReferences(client, { objectType: 'track_part', objectId: partId, objectTitle: part.title || '', adminId: req.admin.adminId, deferredFileKeys });
      await client.query('DELETE FROM track_parts WHERE id = $1 AND track_id = $2', [partId, trackId]);
      await client.query('UPDATE track_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [trackId]);
      if (part.video_id) {
        const referenceResult = await client.query('SELECT 1 FROM track_parts WHERE video_id = $1 UNION ALL SELECT 1 FROM knowledge_parts WHERE video_id = $1 LIMIT 1', [part.video_id]);
        if (referenceResult.rowCount === 0) {
          await client.query('DELETE FROM videos WHERE id = $1', [part.video_id]);
          removedVideo = true;
        }
      }
      // 删除 P 可能导致课程变私密；若“新变私密”则经私密写入开关与前置引用检查保护。
      await finalizeCourseVisibility(client, 'track_point', trackId, previousVisibility);
      await client.query('COMMIT');
      await Promise.all(deferredFileKeys.map((key) => deleteFromBucket(key).catch(() => {})));
      if (removedVideo) await deleteVideoObjects(part.video_id, [part.video_url, part.cover_url]);
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

tracksRouter.post('/collections', requireSuperAdmin, async (req, res, next) => {
  try {
    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const cover = normalizeText(req.body.cover);

    if (!name) {
      res.status(400).json({ message: '请填写曲谱集名称' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO track_collections (name, cover, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, cover, description]
    );

    res.status(201).json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tracks/collections/:id
tracksRouter.patch('/collections/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const collectionId = normalizeId(req.params.id);
    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const cover = normalizeText(req.body.cover);

    if (!collectionId || !name) {
      res.status(400).json({ message: '曲谱集参数无效' });
      return;
    }

    const result = await pool.query(
      `UPDATE track_collections
       SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, cover, description, collectionId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '曲谱集不存在' });
      return;
    }

    res.json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tracks/collections/:id
tracksRouter.delete('/collections/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const collectionId = normalizeId(req.params.id);

    if (!collectionId) {
      res.status(400).json({ message: '曲谱集 ID 无效' });
      return;
    }

    const existing = await pool.query('SELECT id, name FROM track_collections WHERE id = $1', [collectionId]);
    if (existing.rowCount === 0) {
      res.status(404).json({ message: '曲谱集不存在' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'track_collection', objectId: collectionId, objectTitle: existing.rows[0].name, adminId: req.admin.adminId });
      await client.query('DELETE FROM track_collections WHERE id = $1', [collectionId]);
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

// PATCH /api/tracks/collections/:id/tracks
tracksRouter.patch('/collections/:id/tracks', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();

  try {
    const collectionId = normalizeId(req.params.id);
    const trackIds = normalizeOrderedIds(req.body.trackIds);

    if (!collectionId) {
      res.status(400).json({ message: '曲谱集 ID 无效' });
      return;
    }

    await client.query('BEGIN');

    const collectionResult = await client.query('SELECT id FROM track_collections WHERE id = $1', [collectionId]);
    if (collectionResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '曲谱集不存在' });
      return;
    }

    if (trackIds.length > 0) {
      const trackResult = await client.query('SELECT id FROM track_points WHERE id = ANY($1::int[])', [trackIds]);
      if (trackResult.rowCount !== trackIds.length) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: '部分曲目不存在' });
        return;
      }
    }

    await client.query('DELETE FROM track_collection_items WHERE collection_id = $1', [collectionId]);
    if (trackIds.length > 0) {
      await client.query(
        `INSERT INTO track_collection_items (collection_id, track_id, sort_order)
         SELECT $1, item.track_id, item.sort_order
           FROM unnest($2::int[]) WITH ORDINALITY AS item(track_id, sort_order)`,
        [collectionId, trackIds]
      );
    }
    await client.query('UPDATE track_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [collectionId]);
    await client.query('COMMIT');

    res.json({ data: { collectionId, trackIds } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
