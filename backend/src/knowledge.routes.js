import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireSuperAdmin } from './auth.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createMultipartPartUrl,
  deleteFromBucket,
  ensureObjectExists,
  getPublicUrl,
  normalizePublicUrl
} from './storage.js';
import { createInitialRenditions, deleteVideoObjects } from './transcode.js';
import { deleteWithReferences } from './deletion.js';

function id(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value) {
  return String(value ?? '').trim();
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

function mapPart(row) {
  return {
    ...row,
    video_url: normalizePublicUrl(row.video_url),
    video_cover_url: normalizePublicUrl(row.video_cover_url)
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
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at FROM knowledge_points WHERE id = $1', [pointId]);
  return result.rows[0] || null;
}

async function attachments(objectType, objectId) {
  const result = await pool.query(
    `SELECT id, file_name, file_url, file_key, file_type, file_size, created_at
     FROM content_attachments WHERE object_type = $1 AND object_id = $2
     ORDER BY created_at DESC, id DESC`,
    [objectType, objectId]
  );
  return result.rows.map((row) => ({ ...row, file_url: normalizePublicUrl(row.file_url) }));
}

async function pointParts(pointId) {
  const result = await pool.query(
    `SELECT kp.id, kp.part_no, kp.title, kp.duration, kp.video_id,
            v.video_url, v.cover_url AS video_cover_url
     FROM knowledge_parts kp LEFT JOIN videos v ON v.id = kp.video_id
     WHERE kp.knowledge_point_id = $1 ORDER BY kp.part_no ASC, kp.id ASC`,
    [pointId]
  );
  return result.rows.map(mapPart);
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

async function findCollection(collectionId) {
  const result = await pool.query('SELECT id, name, cover, description, created_at, updated_at FROM knowledge_collections WHERE id = $1', [collectionId]);
  return result.rows[0] || null;
}

export const knowledgeRouter = Router();

knowledgeRouter.get('/', async (req, res, next) => {
  try {
    const keyword = text(req.query.keyword);
    const query = `%${keyword}%`;
    const [points, knowledgeCollections] = await Promise.all([
      pool.query(
        `SELECT kp.id, kp.name, kp.cover, kp.description, kp.updated_at, COUNT(kpp.id)::int AS part_count
         FROM knowledge_points kp LEFT JOIN knowledge_parts kpp ON kpp.knowledge_point_id = kp.id
         WHERE $1 = '' OR kp.name ILIKE $2 OR kp.description ILIKE $2
         GROUP BY kp.id ORDER BY kp.updated_at DESC, kp.id DESC`,
        [keyword, query]
      ),
      pool.query(
        `SELECT c.id, c.name, c.cover, c.description, c.updated_at, COUNT(ci.knowledge_point_id)::int AS point_count
         FROM knowledge_collections c LEFT JOIN knowledge_collection_items ci ON ci.collection_id = c.id
         WHERE $1 = '' OR c.name ILIKE $2 OR c.description ILIKE $2
         GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC`,
        [keyword, query]
      )
    ]);
    res.json({ data: { points: points.rows.map(mapContent), knowledge_collections: knowledgeCollections.rows.map(mapContent) } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.get('/collections/:id', async (req, res, next) => {
  try {
    const collectionId = id(req.params.id);
    const collection = collectionId ? await findCollection(collectionId) : null;
    if (!collection) {
      res.status(collectionId ? 404 : 400).json({ message: collectionId ? '知识点集不存在' : '知识点集 ID 无效' });
      return;
    }
    const points = await pool.query(
      `SELECT kp.id, kp.name, kp.cover, kp.description, kp.updated_at, COUNT(kpp.id)::int AS part_count
       FROM knowledge_collection_items ci JOIN knowledge_points kp ON kp.id = ci.knowledge_point_id
       LEFT JOIN knowledge_parts kpp ON kpp.knowledge_point_id = kp.id
       WHERE ci.collection_id = $1 GROUP BY kp.id ORDER BY kp.name ASC, kp.id ASC`,
      [collectionId]
    );
    res.json({ data: { ...mapContent(collection), points: points.rows.map(mapContent), attachments: await attachments('knowledge_collection', collectionId) } });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.get('/:id', async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const point = pointId ? await findKnowledgePoint(pointId) : null;
    if (!point) {
      res.status(pointId ? 404 : 400).json({ message: pointId ? '知识点不存在' : '知识点 ID 无效' });
      return;
    }
    res.json({ data: { ...mapContent(point), parts: await pointParts(pointId), attachments: await attachments('knowledge_point', pointId), knowledge_collections: await pointCollections(pointId) } });
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
    const result = await pool.query(
      `INSERT INTO knowledge_points (name, cover, description) VALUES ($1, $2, $3)
       RETURNING id, name, cover, description, created_at, updated_at`,
      [name, text(req.body.cover), text(req.body.description)]
    );
    res.status(201).json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

knowledgeRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const pointId = id(req.params.id);
    const name = text(req.body.name);
    if (!pointId || !name) {
      res.status(400).json({ message: '知识点参数无效' });
      return;
    }
    const result = await pool.query(
      `UPDATE knowledge_points SET name = $1, cover = $2, description = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING id, name, cover, description, created_at, updated_at`,
      [name, text(req.body.cover), text(req.body.description), pointId]
    );
    if (!result.rowCount) {
      res.status(404).json({ message: '知识点不存在' });
      return;
    }
    res.json({ data: mapContent(result.rows[0]) });
  } catch (error) {
    next(error);
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
    const pointIds = [...new Set((Array.isArray(req.body.pointIds) ? req.body.pointIds : []).map(id).filter(Boolean))];
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
    if (pointIds.length) await client.query('INSERT INTO knowledge_collection_items (collection_id, knowledge_point_id) SELECT $1, unnest($2::int[])', [collectionId, pointIds]);
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

knowledgeRouter.post('/:id/parts', requireSuperAdmin, async (req, res, next) => {
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
    const videoHead = await ensureObjectExists(key);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
        `INSERT INTO knowledge_parts (knowledge_point_id, part_no, video_id, title, duration) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, knowledge_point_id, part_no, video_id, title, duration, created_at, updated_at`,
        [pointId, partNo, video.id, title, duration]
      )).rows[0];
      await client.query('UPDATE knowledge_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pointId]);
      await client.query('COMMIT');
      res.status(201).json({ data: { ...part, video_url: getPublicUrl(key) } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      await deleteFromBucket(key).catch(() => {});
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

knowledgeRouter.patch('/:id/parts/:partId', requireSuperAdmin, async (req, res, next) => {
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
    const result = await pool.query(
      `UPDATE knowledge_parts SET part_no = $1, title = $2, duration = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND knowledge_point_id = $5 RETURNING id, knowledge_point_id, part_no, video_id, title, duration, created_at, updated_at`,
      [partNo, title, duration, partId, pointId]
    );
    if (!result.rowCount) {
      res.status(404).json({ message: '知识点 P 不存在' });
      return;
    }
    await pool.query('UPDATE knowledge_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pointId]);
    res.json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      res.status(409).json({ message: '这个 P 序号已经存在' });
      return;
    }
    next(error);
  }
});

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
    if (item.video_id) {
      await deleteVideoObjects(item.video_id, [item.video_url, item.cover_url]);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteWithReferences(client, { objectType: 'knowledge_part', objectId: partId, objectTitle: item.title || '', adminId: req.admin.adminId });
      await client.query('DELETE FROM knowledge_parts WHERE id = $1 AND knowledge_point_id = $2', [partId, pointId]);
      await client.query('UPDATE knowledge_points SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pointId]);
      if (item.video_id && !(await client.query('SELECT 1 FROM knowledge_parts WHERE video_id = $1 LIMIT 1', [item.video_id])).rowCount) {
        await client.query('DELETE FROM videos WHERE id = $1', [item.video_id]);
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
