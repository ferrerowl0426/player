import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireSuperAdmin } from './auth.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartPartUrl,
  createMultipartUpload,
  deleteFromBucket,
  ensureObjectExists,
  getPublicUrl,
  normalizePublicUrl
} from './storage.js';
import { createInitialRenditions, deleteVideoObjects } from './transcode.js';
import { deleteWithReferences } from './deletion.js';

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
  return {
    ...row,
    video_url: normalizePublicUrl(row.video_url),
    video_cover_url: normalizePublicUrl(row.video_cover_url)
  };
}

async function findTrack(trackId) {
  const result = await pool.query(
    `SELECT id, name, cover, description, created_at, updated_at
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

async function getTrackParts(trackId) {
  const result = await pool.query(
    `SELECT tp.id, tp.part_no, tp.title, tp.duration, tp.video_id,
            v.video_url, v.cover_url AS video_cover_url
     FROM track_parts tp
     LEFT JOIN videos v ON v.id = tp.video_id
     WHERE tp.track_id = $1
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
      const list = renditionsByVideoId.get(rendition.video_id) || [];
      list.push({ ...rendition, video_url: normalizePublicUrl(rendition.video_url) });
      renditionsByVideoId.set(rendition.video_id, list);
    }
  }

  return rows.map((row) => ({
    ...mapPart(row),
    renditions: renditionsByVideoId.get(row.video_id) || []
  }));
}

async function getContentAttachments(objectType, objectId) {
  const result = await pool.query(
    `SELECT id, file_name, file_url, file_key, file_type, file_size, created_at
     FROM content_attachments
     WHERE object_type = $1 AND object_id = $2
     ORDER BY created_at DESC, id DESC`,
    [objectType, objectId]
  );
  return result.rows.map((row) => ({ ...row, file_url: normalizePublicUrl(row.file_url) }));
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

export const tracksRouter = Router();

// GET /api/tracks
// 曲目库首页公开接口：游客、学员、老师和教导主任都可以访问。
// 当前只返回曲目和曲谱集首页所需数据，前置知识点暂不读取。
tracksRouter.get('/', async (req, res, next) => {
  try {
    const keyword = normalizeKeyword(req.query.keyword);
    const searchPattern = `%${keyword}%`;
    const params = keyword ? [searchPattern] : [];
    const whereClause = keyword ? 'WHERE name ILIKE $1' : '';

    const [tracksResult, collectionsResult] = await Promise.all([
      pool.query(
        `SELECT
           t.id,
           t.name,
           t.cover,
           t.description,
           t.updated_at,
           COUNT(tp.id)::int AS part_count
         FROM track_points t
         LEFT JOIN track_parts tp ON tp.track_id = t.id
         ${whereClause}
         GROUP BY t.id
         ORDER BY t.updated_at DESC, t.id DESC`,
        params
      ),
      pool.query(
        `SELECT
           c.id,
           c.name,
           c.cover,
           c.description,
           c.updated_at,
           COUNT(ct.track_id)::int AS track_count
         FROM track_collections c
         LEFT JOIN track_collection_items ct ON ct.collection_id = c.id
         ${whereClause}
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC`,
        params
      )
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
tracksRouter.get('/:id', async (req, res, next) => {
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

    const [parts, attachments, track_collections] = await Promise.all([
      getTrackParts(trackId),
      getContentAttachments('track_point', trackId),
      getTrackCollections(trackId)
    ]);

    res.json({
      data: {
        ...mapTrack(track),
        parts,
        attachments,
        track_collections
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tracks/collections/:id
// 曲谱集详情公开接口
tracksRouter.get('/collections/:id', async (req, res, next) => {
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

    const tracksResult = await pool.query(
      `SELECT t.id, t.name, t.cover, t.description, t.updated_at,
              COUNT(tp.id)::int AS part_count
       FROM track_collection_items ct
       JOIN track_points t ON t.id = ct.track_id
       LEFT JOIN track_parts tp ON tp.track_id = t.id
       WHERE ct.collection_id = $1
       GROUP BY t.id
       ORDER BY t.name ASC, t.id ASC`,
      [collectionId]
    );

    res.json({
      data: {
        ...mapTrack(collection),
        track_points: tracksResult.rows.map(mapTrack),
        attachments: await getContentAttachments('track_collection', collectionId)
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

    const result = await pool.query(
      `INSERT INTO track_points (name, cover, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, cover, description]
    );

    res.status(201).json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tracks/:id
tracksRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const trackId = normalizeId(req.params.id);
    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const cover = normalizeText(req.body.cover);

    if (!trackId || !name) {
      res.status(400).json({ message: '曲目参数无效' });
      return;
    }

    const result = await pool.query(
      `UPDATE track_points
       SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, cover, description, trackId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '曲目不存在' });
      return;
    }

    res.json({ data: mapTrack(result.rows[0]) });
  } catch (error) {
    next(error);
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
tracksRouter.post('/:id/parts', requireSuperAdmin, async (req, res, next) => {
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

    const videoHead = await ensureObjectExists(videoKey);
    const videoUrl = getPublicUrl(videoKey);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
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
        `INSERT INTO track_parts (track_id, part_no, video_id, title, duration)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, track_id, part_no, video_id, title, duration, created_at, updated_at`,
        [trackId, partNo, video.id, title, duration]
      );
      await client.query('UPDATE track_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [trackId]);
      await client.query('COMMIT');
      res.status(201).json({ data: { ...partResult.rows[0], video_url: videoUrl, video_size: Number(videoHead.ContentLength || 0) } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      await deleteFromBucket(videoKey).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      return;
    }
    next(error);
  }
});

// PATCH /api/tracks/:id/parts/:partId
tracksRouter.patch('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
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

    const result = await pool.query(
      `UPDATE track_parts
       SET part_no = $1, title = $2, duration = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND track_id = $5
       RETURNING id, track_id, part_no, video_id, title, duration, created_at, updated_at`,
      [partNo, title, duration, partId, trackId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: 'P 分段不存在' });
      return;
    }

    await pool.query('UPDATE track_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [trackId]);
    res.json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      return;
    }
    next(error);
  }
});

// DELETE /api/tracks/:id/parts/:partId
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
    if (part.video_id) {
      await deleteVideoObjects(part.video_id, [part.video_url, part.cover_url]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'track_part', objectId: partId, objectTitle: part.title || '', adminId: req.admin.adminId });
      await client.query('DELETE FROM track_parts WHERE id = $1 AND track_id = $2', [partId, trackId]);
      await client.query('UPDATE track_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [trackId]);
      if (part.video_id) {
        const referenceResult = await client.query('SELECT 1 FROM track_parts WHERE video_id = $1 LIMIT 1', [part.video_id]);
        if (referenceResult.rowCount === 0) {
          await client.query('DELETE FROM videos WHERE id = $1', [part.video_id]);
        }
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
    const trackIds = normalizeIds(req.body.trackIds);

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
        `INSERT INTO track_collection_items (collection_id, track_id)
         SELECT $1, unnest($2::int[])`,
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
