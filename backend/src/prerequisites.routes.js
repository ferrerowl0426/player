import { Router } from 'express';
import { pool } from './db.js';
import { requireSuperAdmin } from './auth.js';

const prerequisiteRouter = Router();
const OBJECT_TYPES = new Set(['track_point', 'track_collection', 'knowledge_point', 'knowledge_collection', 'track_part', 'knowledge_part', 'video']);

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function normalizeType(value) {
  return String(value ?? '').trim();
}

async function findObject(type, id) {
  if (type === 'track_point') {
    return pool.query('SELECT id, name AS title, cover FROM track_points WHERE id = $1', [id]);
  }
  if (type === 'track_collection') {
    return pool.query('SELECT id, name AS title, cover FROM track_collections WHERE id = $1', [id]);
  }
  if (type === 'knowledge_point') {
    return pool.query('SELECT id, name AS title, cover FROM knowledge_points WHERE id = $1', [id]);
  }
  if (type === 'knowledge_collection') {
    return pool.query('SELECT id, name AS title, cover FROM knowledge_collections WHERE id = $1', [id]);
  }
  if (type === 'track_part') {
    return pool.query('SELECT id, title, track_id AS parent_id FROM track_parts WHERE id = $1', [id]);
  }
  if (type === 'knowledge_part') {
    return pool.query('SELECT id, title, knowledge_point_id AS parent_id FROM knowledge_parts WHERE id = $1', [id]);
  }
  if (type === 'video') {
    return pool.query('SELECT id, title, thumbnail_url AS cover FROM videos WHERE id = $1', [id]);
  }
  return { rows: [] };
}

async function ensureObjectExists(type, id) {
  if (!OBJECT_TYPES.has(type) || !id) return false;
  const result = await findObject(type, id);
  return result.rowCount > 0;
}

async function listPrerequisites(objectType, objectId) {
  const result = await pool.query(
    `SELECT prerequisite_type, prerequisite_id, created_at
     FROM prerequisites
     WHERE object_type = $1 AND object_id = $2
     ORDER BY created_at ASC`,
    [objectType, objectId]
  );

  const rows = [];
  for (const row of result.rows) {
    const objectResult = await findObject(row.prerequisite_type, row.prerequisite_id);
    rows.push({
      objectType: row.prerequisite_type,
      objectId: row.prerequisite_id,
      title: objectResult.rows[0]?.title || '',
      cover: objectResult.rows[0]?.cover || '',
      createdAt: row.created_at
    });
  }
  return rows;
}

// GET /api/prerequisites?objectType=track_point&objectId=1
prerequisiteRouter.get('/', async (req, res, next) => {
  try {
    const objectType = normalizeType(req.query.objectType);
    const objectId = normalizeId(req.query.objectId);

    if (!OBJECT_TYPES.has(objectType) || !objectId) {
      res.status(400).json({ message: '前置对象参数无效' });
      return;
    }

    if (!(await ensureObjectExists(objectType, objectId))) {
      res.status(404).json({ message: '对象不存在' });
      return;
    }

    const prerequisites = await listPrerequisites(objectType, objectId);
    res.json({ data: prerequisites });
  } catch (error) {
    next(error);
  }
});

// PUT /api/prerequisites
prerequisiteRouter.put('/', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const objectType = normalizeType(req.body.objectType);
    const objectId = normalizeId(req.body.objectId);
    const prerequisites = Array.isArray(req.body.prerequisites) ? req.body.prerequisites : [];

    if (!OBJECT_TYPES.has(objectType) || !objectId) {
      res.status(400).json({ message: '前置对象参数无效' });
      return;
    }

    if (!(await ensureObjectExists(objectType, objectId))) {
      res.status(404).json({ message: '对象不存在' });
      return;
    }

    const normalized = [];
    for (const item of prerequisites) {
      const prerequisiteType = normalizeType(item.objectType ?? item.prerequisiteType);
      const prerequisiteId = normalizeId(item.objectId ?? item.prerequisiteId);

      if (!OBJECT_TYPES.has(prerequisiteType) || !prerequisiteId) {
        res.status(400).json({ message: '前置项参数无效' });
        return;
      }

      if (objectType === prerequisiteType && objectId === prerequisiteId) {
        res.status(400).json({ message: '不能把对象自身设为前置项' });
        return;
      }

      if (!(await ensureObjectExists(prerequisiteType, prerequisiteId))) {
        res.status(404).json({ message: `前置项不存在：${prerequisiteType} ${prerequisiteId}` });
        return;
      }

      if (!normalized.some((row) => row.prerequisiteType === prerequisiteType && row.prerequisiteId === prerequisiteId)) {
        normalized.push({ prerequisiteType, prerequisiteId });
      }
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM prerequisites WHERE object_type = $1 AND object_id = $2', [objectType, objectId]);
    for (const item of normalized) {
      await client.query(
        `INSERT INTO prerequisites (object_type, object_id, prerequisite_type, prerequisite_id)
         VALUES ($1, $2, $3, $4)`,
        [objectType, objectId, item.prerequisiteType, item.prerequisiteId]
      );
    }
    await client.query('COMMIT');

    const data = await listPrerequisites(objectType, objectId);
    res.json({ data });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

export { prerequisiteRouter };
