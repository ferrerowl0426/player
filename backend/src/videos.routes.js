import path from 'node:path';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireAdmin } from './auth.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartPartUrl,
  createMultipartUpload,
  createUploadUrl,
  deleteFromBucket,
  ensureObjectExists,
  getKeyFromPublicUrl,
  getPublicUrl
} from './storage.js';

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 1000;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];
const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isInvalidTextValue(value) {
  return INVALID_TEXT_VALUES.includes(value.toLowerCase());
}

function formatFileSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function getExtension(fileName) {
  return path.extname(String(fileName || '')).toLowerCase();
}

function validateUploadInput({ title, description, videoFile, coverFile }) {
  if (!title) {
    return '请填写视频标题';
  }

  if (isInvalidTextValue(title)) {
    return '视频标题不能是 null、undefined、NaN 这类无意义内容';
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return `视频标题最多 ${TITLE_MAX_LENGTH} 个字`;
  }

  if (description && isInvalidTextValue(description)) {
    return '视频介绍不能是 null、undefined、NaN 这类无意义内容';
  }

  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return `视频介绍最多 ${DESCRIPTION_MAX_LENGTH} 个字`;
  }

  if (!videoFile) {
    return '请上传视频文件';
  }

  if (videoFile.size > MAX_VIDEO_SIZE) {
    return `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}`;
  }

  if (!videoFile.type?.startsWith('video/')) {
    return '请上传视频文件';
  }

  if (!ALLOWED_VIDEO_EXTENSIONS.includes(getExtension(videoFile.name))) {
    return '视频格式只支持 mp4、webm、mov';
  }

  if (!coverFile) {
    return '请上传封面图片';
  }

  if (coverFile.size > MAX_COVER_SIZE) {
    return `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}`;
  }

  if (!coverFile.type?.startsWith('image/')) {
    return '封面必须是图片文件';
  }

  if (!ALLOWED_IMAGE_EXTENSIONS.includes(getExtension(coverFile.name))) {
    return '封面格式只支持 jpg、jpeg、png、webp';
  }

  return '';
}

function isExpectedUploadKey(key, prefix) {
  return typeof key === 'string' && key.startsWith(prefix) && !key.includes('..');
}

function normalizePartNumber(value) {
  const partNumber = Number(value);
  return Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= 10000 ? partNumber : 0;
}

function normalizeMultipartParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  return parts
    .map((part) => ({
      etag: String(part.etag || '').trim(),
      partNumber: normalizePartNumber(part.partNumber)
    }))
    .filter((part) => part.etag && part.partNumber)
    .sort((first, second) => first.partNumber - second.partNumber);
}

function normalizeDate(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export const videoRouter = Router();

// GET /api/videos
// 获取首页视频列表。
// 前端、小程序以后都可以调用这个接口。
videoRouter.get('/', async (req, res, next) => {
  try {
    const keyword = normalizeText(req.query.keyword).slice(0, 120);
    const startDate = normalizeDate(req.query.startDate);
    const endDate = normalizeDate(req.query.endDate);

    if (startDate === null || endDate === null) {
      res.status(400).json({ message: '日期格式必须是 YYYY-MM-DD' });
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({ message: '开始日期不能晚于结束日期' });
      return;
    }

    const whereClauses = [];
    const params = [];

    if (keyword) {
      params.push(`%${keyword}%`);
      whereClauses.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    if (startDate) {
      params.push(startDate);
      whereClauses.push(`created_at >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      whereClauses.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, title, description, video_url, cover_url, created_at
       FROM videos
       ${whereSql}
       ORDER BY created_at DESC`,
      params
    );

    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/multipart/create
// 创建视频分片上传任务。前端只提交文件元数据，后端返回 uploadId 和 object key。
videoRouter.post('/multipart/create', requireAdmin, async (req, res, next) => {
  try {
    const videoFile = req.body.video;
    const validationMessage = validateUploadInput({
      title: normalizeText(req.body.title),
      description: normalizeText(req.body.description),
      videoFile,
      coverFile: req.body.cover
    });

    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }

    const videoKey = `videos/${uuid()}${getExtension(videoFile.name)}`;
    const coverKey = `covers/${uuid()}${getExtension(req.body.cover.name)}`;
    const [uploadId, coverUploadUrl] = await Promise.all([
      createMultipartUpload({
        key: videoKey,
        contentType: videoFile.type
      }),
      createUploadUrl({
        key: coverKey,
        contentType: req.body.cover.type
      })
    ]);

    res.json({
      data: {
        video: {
          key: videoKey,
          uploadId,
          publicUrl: getPublicUrl(videoKey)
        },
        cover: {
          key: coverKey,
          uploadUrl: coverUploadUrl,
          publicUrl: getPublicUrl(coverKey)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/multipart/part-url
// 为单个分片生成预签名 URL。浏览器随后用 PUT 把对应 Blob 分片直传 COS。
videoRouter.post('/multipart/part-url', requireAdmin, async (req, res, next) => {
  try {
    const key = req.body.key;
    const uploadId = String(req.body.uploadId || '').trim();
    const partNumber = normalizePartNumber(req.body.partNumber);

    if (!isExpectedUploadKey(key, 'videos/') || !uploadId || !partNumber) {
      res.status(400).json({ message: '分片上传参数无效' });
      return;
    }

    const uploadUrl = await createMultipartPartUrl({ key, uploadId, partNumber });

    res.json({ data: { uploadUrl } });
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/multipart/complete
// 前端上传完所有分片后，把每片的 PartNumber 和 ETag 交给后端，由后端通知 COS 合并。
videoRouter.post('/multipart/complete', requireAdmin, async (req, res, next) => {
  try {
    const key = req.body.key;
    const uploadId = String(req.body.uploadId || '').trim();
    const parts = normalizeMultipartParts(req.body.parts);

    if (!isExpectedUploadKey(key, 'videos/') || !uploadId || parts.length === 0) {
      res.status(400).json({ message: '完成分片上传参数无效' });
      return;
    }

    await completeMultipartUpload({ key, uploadId, parts });
    await ensureObjectExists(key);

    res.json({ data: { key, publicUrl: getPublicUrl(key) } });
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/multipart/abort
// 上传失败或取消时终止 Multipart Upload，避免 COS 保留未完成的分片。
videoRouter.post('/multipart/abort', requireAdmin, async (req, res, next) => {
  try {
    const key = req.body.key;
    const uploadId = String(req.body.uploadId || '').trim();

    if (!isExpectedUploadKey(key, 'videos/') || !uploadId) {
      res.status(400).json({ message: '取消分片上传参数无效' });
      return;
    }

    await abortMultipartUpload({ key, uploadId });
    res.json({ message: '已取消分片上传' });
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/complete
// 浏览器直传对象存储成功后，再调用这个接口把视频信息写入数据库。
videoRouter.post('/complete', requireAdmin, async (req, res, next) => {
  try {
    const title = normalizeText(req.body.title);
    const description = normalizeText(req.body.description);
    const videoKey = req.body.videoKey;
    const coverKey = req.body.coverKey;

    if (!title) {
      res.status(400).json({ message: '请填写视频标题' });
      return;
    }

    if (isInvalidTextValue(title)) {
      res.status(400).json({ message: '视频标题不能是 null、undefined、NaN 这类无意义内容' });
      return;
    }

    if (title.length > TITLE_MAX_LENGTH) {
      res.status(400).json({ message: `视频标题最多 ${TITLE_MAX_LENGTH} 个字` });
      return;
    }

    if (description && isInvalidTextValue(description)) {
      res.status(400).json({ message: '视频介绍不能是 null、undefined、NaN 这类无意义内容' });
      return;
    }

    if (description.length > DESCRIPTION_MAX_LENGTH) {
      res.status(400).json({ message: `视频介绍最多 ${DESCRIPTION_MAX_LENGTH} 个字` });
      return;
    }

    if (!isExpectedUploadKey(videoKey, 'videos/') || !isExpectedUploadKey(coverKey, 'covers/')) {
      res.status(400).json({ message: '上传文件地址无效' });
      return;
    }

    await Promise.all([
      ensureObjectExists(videoKey),
      ensureObjectExists(coverKey)
    ]);

    const videoUrl = getPublicUrl(videoKey);
    const coverUrl = getPublicUrl(coverKey);
    const result = await pool.query(
      `INSERT INTO videos (title, description, video_url, cover_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, video_url, cover_url, created_at`,
      [title, description, videoUrl, coverUrl]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/videos/:id
// 获取单个视频详情，播放页会用到。
videoRouter.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, video_url, cover_url, created_at
       FROM videos
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: '视频不存在' });
      return;
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/videos/:id
// 删除视频接口。
// 删除顺序：先查数据库拿到视频和封面 URL，再删除存储桶文件，最后删除数据库记录。
// 这样可以减少“数据库记录已删除，但存储桶文件删除失败”的孤儿文件问题。
videoRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const findResult = await pool.query(
      `SELECT id, video_url, cover_url
       FROM videos
       WHERE id = $1`,
      [req.params.id]
    );

    if (findResult.rowCount === 0) {
      res.status(404).json({ message: '视频不存在' });
      return;
    }

    const video = findResult.rows[0];
    await Promise.all([
      deleteFromBucket(getKeyFromPublicUrl(video.video_url)),
      deleteFromBucket(getKeyFromPublicUrl(video.cover_url))
    ]);

    await pool.query('DELETE FROM videos WHERE id = $1', [video.id]);

    res.json({ message: '删除成功' });
  } catch (error) {
    next(error);
  }
});
