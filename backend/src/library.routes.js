import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireSuperAdmin } from './auth.js';
import { createUploadUrl, deleteFromBucket, ensureObjectExists, getPublicUrl, normalizePublicUrl } from './storage.js';

const LINK_TYPES = new Set(['track_point', 'track_collection', 'knowledge_point', 'knowledge_collection']);
const TITLE_MAX_LENGTH = 120;
// PRD §4.9：图书馆 PDF ≤ 500MB，封面 ≤ 10MB。前端提示同样以这里为准，但后端必须独立复核。
const PDF_MAX_SIZE = 500 * 1024 * 1024;
const COVER_MAX_SIZE = 10 * 1024 * 1024;
const PDF_TYPES = new Set(['application/pdf', 'application/x-pdf']);

function text(value) {
  return String(value ?? '').trim();
}

function id(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function size(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function ext(value) {
  const match = String(value || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function isLibraryKey(value) {
  return typeof value === 'string' && value.startsWith('library/') && !value.includes('..');
}

function mapResource(row) {
  return {
    ...row,
    cover: normalizePublicUrl(row.cover),
    file_url: normalizePublicUrl(row.file_url)
  };
}

function normalizeLinks(value) {
  const seen = new Set();
  const links = [];

  for (const item of Array.isArray(value) ? value : []) {
    const objectType = text(item?.objectType || item?.object_type);
    const objectId = id(item?.objectId || item?.object_id);
    const key = `${objectType}:${objectId}`;

    if (!LINK_TYPES.has(objectType) || !objectId || seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push({ objectType, objectId });
  }

  return links;
}

async function getLinks(resourceId) {
  const result = await pool.query(
    `SELECT l.object_type, l.object_id,
            COALESCE(tp.name, tc.name, kp.name, kc.name, '') AS title
     FROM library_resource_links l
     LEFT JOIN track_points tp ON l.object_type = 'track_point' AND tp.id = l.object_id
     LEFT JOIN track_collections tc ON l.object_type = 'track_collection' AND tc.id = l.object_id
     LEFT JOIN knowledge_points kp ON l.object_type = 'knowledge_point' AND kp.id = l.object_id
     LEFT JOIN knowledge_collections kc ON l.object_type = 'knowledge_collection' AND kc.id = l.object_id
     WHERE l.library_resource_id = $1
     ORDER BY l.created_at ASC`,
    [resourceId]
  );

  return result.rows.filter((row) => row.title).map((row) => ({
    objectType: row.object_type,
    objectId: row.object_id,
    title: row.title
  }));
}

async function setLinks(client, resourceId, links) {
  await client.query('DELETE FROM library_resource_links WHERE library_resource_id = $1', [resourceId]);

  for (const link of links) {
    await client.query(
      `INSERT INTO library_resource_links (library_resource_id, object_type, object_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [resourceId, link.objectType, link.objectId]
    );
  }
}

// 取当前操作管理员的展示名，冗余写进资料记录。
async function findUploader(admin) {
  const adminId = Number(admin?.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) return { id: null, name: '' };

  const result = await pool.query('SELECT id, nickname, username, account FROM admins WHERE id = $1', [adminId]);
  const row = result.rows[0];
  if (!row) return { id: null, name: '' };
  return { id: row.id, name: text(row.nickname || row.username || row.account) };
}

async function findResource(resourceId) {
  const result = await pool.query(
    `SELECT id, title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name, created_at, updated_at
     FROM library_resources WHERE id = $1`,
    [resourceId]
  );
  return result.rows[0] || null;
}

export const libraryRouter = Router();

libraryRouter.get('/', async (req, res, next) => {
  try {
    const keyword = text(req.query.keyword);
    const query = `%${keyword}%`;
    const result = await pool.query(
      `SELECT id, title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name, created_at, updated_at
       FROM library_resources
       WHERE $1 = '' OR title ILIKE $2 OR description ILIKE $2 OR file_name ILIKE $2
       ORDER BY updated_at DESC, id DESC`,
      [keyword, query]
    );

    res.json({ data: result.rows.map(mapResource) });
  } catch (error) {
    next(error);
  }
});

libraryRouter.get('/:id', async (req, res, next) => {
  try {
    const resourceId = id(req.params.id);
    const resource = resourceId ? await findResource(resourceId) : null;

    if (!resource) {
      res.status(resourceId ? 404 : 400).json({ message: resourceId ? '资料不存在' : '资料 ID 无效' });
      return;
    }

    res.json({ data: { ...mapResource(resource), links: await getLinks(resourceId) } });
  } catch (error) {
    next(error);
  }
});

libraryRouter.post('/upload-url', requireSuperAdmin, async (req, res, next) => {
  try {
    const kind = text(req.body.kind) === 'cover' ? 'cover' : 'pdf';
    const fileName = text(req.body.fileName || req.body.name);
    const fileType = text(req.body.fileType || req.body.type) || (kind === 'cover' ? 'image/jpeg' : 'application/pdf');
    const fileSize = size(req.body.fileSize || req.body.size);
    const fileExt = ext(fileName);

    if (kind === 'pdf' && (!fileName || !PDF_TYPES.has(fileType) || fileExt !== '.pdf')) {
      res.status(400).json({ message: '请上传 PDF 文件' });
      return;
    }

    if (kind === 'cover' && (!fileName || !fileType.startsWith('image/') || !['.jpg', '.jpeg', '.png', '.webp'].includes(fileExt))) {
      res.status(400).json({ message: '请上传 JPG / PNG / WEBP 封面' });
      return;
    }

    // 前端上报的大小不可信，但至少在这里挡掉明显超限的申请；落库时再复核一次。
    if (fileSize > (kind === 'cover' ? COVER_MAX_SIZE : PDF_MAX_SIZE)) {
      res.status(400).json({
        message: kind === 'cover' ? '封面不能超过 10MB' : 'PDF 文件不能超过 500MB'
      });
      return;
    }

    const key = kind === 'cover' ? `library/covers/${uuid()}${fileExt}` : `library/${uuid()}.pdf`;
    const uploadUrl = await createUploadUrl({ key, contentType: fileType });
    res.json({ data: { key, uploadUrl, publicUrl: getPublicUrl(key), fileName, fileType, fileSize, kind } });
  } catch (error) {
    next(error);
  }
});

libraryRouter.post('/', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const title = text(req.body.title);
    const description = text(req.body.description);
    const cover = text(req.body.cover);
    const fileName = text(req.body.fileName);
    const fileType = text(req.body.fileType) || 'application/pdf';
    const fileSize = size(req.body.fileSize);
    const fileKey = text(req.body.fileKey);
    const links = normalizeLinks(req.body.links);

    if (!title || title.length > TITLE_MAX_LENGTH) {
      res.status(400).json({ message: `资料名称必填且最多 ${TITLE_MAX_LENGTH} 个字` });
      return;
    }

    if (!fileName || !isLibraryKey(fileKey)) {
      res.status(400).json({ message: '请先上传 PDF 文件' });
      return;
    }

    // 封面必填（设计稿 admin-upload-pdf.html：A4 竖版 · 必填）
    if (!cover) {
      res.status(400).json({ message: '封面为必填项（A4 竖版 210 : 297）' });
      return;
    }

    if (fileSize > PDF_MAX_SIZE) {
      res.status(400).json({ message: 'PDF 文件不能超过 500MB' });
      return;
    }

    await ensureObjectExists(fileKey);
    const uploader = await findUploader(req.admin);
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO library_resources (title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name, created_at, updated_at`,
      [title, description, cover, fileName, getPublicUrl(fileKey), fileKey, fileType, fileSize, uploader.id, uploader.name]
    );
    await setLinks(client, result.rows[0].id, links);
    await client.query('COMMIT');

    res.status(201).json({ data: { ...mapResource(result.rows[0]), links: await getLinks(result.rows[0].id) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

libraryRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const resourceId = id(req.params.id);
    const title = text(req.body.title);
    const description = text(req.body.description);
    const cover = text(req.body.cover);
    const links = normalizeLinks(req.body.links);

    if (!resourceId || !title || title.length > TITLE_MAX_LENGTH) {
      res.status(400).json({ message: '资料参数无效' });
      return;
    }

    if (!cover) {
      res.status(400).json({ message: '封面为必填项（A4 竖版 210 : 297）' });
      return;
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE library_resources SET title = $1, description = $2, cover = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, title, description, cover, file_name, file_url, file_key, file_type, file_size, uploader_id, uploader_name, created_at, updated_at`,
      [title, description, cover, resourceId]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '资料不存在' });
      return;
    }

    await setLinks(client, resourceId, links);
    await client.query('COMMIT');
    res.json({ data: { ...mapResource(result.rows[0]), links: await getLinks(resourceId) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

libraryRouter.patch('/:id/links', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const resourceId = id(req.params.id);
    if (!resourceId || !await findResource(resourceId)) {
      res.status(resourceId ? 404 : 400).json({ message: resourceId ? '资料不存在' : '资料 ID 无效' });
      return;
    }

    await client.query('BEGIN');
    await setLinks(client, resourceId, normalizeLinks(req.body.links));
    await client.query('COMMIT');
    res.json({ data: await getLinks(resourceId) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

libraryRouter.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const resourceId = id(req.params.id);
    if (!resourceId) {
      res.status(400).json({ message: '资料 ID 无效' });
      return;
    }

    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM library_resources
       WHERE id = $1
       RETURNING id, title, file_key`,
      [resourceId]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: '资料不存在' });
      return;
    }

    await logStandaloneDeletion({ objectType: 'library_resource', objectId: resourceId, objectTitle: result.rows[0].title, adminId: req.admin?.adminId || null });
    await client.query('COMMIT');
    await deleteFromBucket(result.rows[0].file_key).catch(() => {});
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});
