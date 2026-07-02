import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { upload, MAX_COVER_SIZE, MAX_VIDEO_SIZE } from './upload.js';
import { deleteFromBucket, getKeyFromPublicUrl, uploadToBucket } from './storage.js';

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 1000;
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];

function removeLocalFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isInvalidTextValue(value) {
  return INVALID_TEXT_VALUES.includes(value.toLowerCase());
}

function formatFileSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
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

  if (isInvalidTextValue(description)) {
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

  if (!coverFile) {
    return '请上传封面图片';
  }

  if (coverFile.size > MAX_COVER_SIZE) {
    return `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}`;
  }

  return '';
}

function handleUploadFiles(req, res, next) {
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ])(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: `单个文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}` });
      return;
    }

    res.status(400).json({ message: error.message || '上传文件失败' });
  });
}

export const videoRouter = Router();

// GET /api/videos
// 获取首页视频列表。
// 前端、小程序以后都可以调用这个接口。
videoRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, video_url, cover_url, created_at
       FROM videos
       ORDER BY created_at DESC`
    );

    res.json({ data: result.rows });
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
videoRouter.delete('/:id', async (req, res, next) => {
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

// POST /api/videos
// 上传视频接口。
// multipart/form-data 字段：
// - title：标题
// - description：介绍
// - video：视频文件，必填
// - cover：封面图片，必填
videoRouter.post(
  '/',
  handleUploadFiles,
  async (req, res, next) => {
    const videoFile = req.files?.video?.[0];
    const uploadedCoverFile = req.files?.cover?.[0];

    try {
      const title = normalizeText(req.body.title);
      const description = normalizeText(req.body.description);
      const validationMessage = validateUploadInput({
        title,
        description,
        videoFile,
        coverFile: uploadedCoverFile
      });

      if (validationMessage) {
        res.status(400).json({ message: validationMessage });
        return;
      }

      const videoExt = path.extname(videoFile.originalname) || '.mp4';
      const videoKey = `videos/${uuid()}${videoExt}`;

      const videoUrl = await uploadToBucket({
        key: videoKey,
        body: fs.createReadStream(videoFile.path),
        contentType: videoFile.mimetype
      });

      const coverExt = path.extname(uploadedCoverFile.originalname) || '.jpg';
      const coverKey = `covers/${uuid()}${coverExt}`;
      const coverUrl = await uploadToBucket({
        key: coverKey,
        body: fs.createReadStream(uploadedCoverFile.path),
        contentType: uploadedCoverFile.mimetype
      });

      const result = await pool.query(
        `INSERT INTO videos (title, description, video_url, cover_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, description, video_url, cover_url, created_at`,
        [title, description, videoUrl, coverUrl]
      );

      res.status(201).json({ data: result.rows[0] });
    } catch (error) {
      next(error);
    } finally {
      removeLocalFile(videoFile?.path);
      removeLocalFile(uploadedCoverFile?.path);
    }
  }
);
