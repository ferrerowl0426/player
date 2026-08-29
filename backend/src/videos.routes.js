import path from 'node:path';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from './db.js';
import { requireAdmin, requireSuperAdmin, requireUserOrAdmin } from './auth.js';
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
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];
const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_ATTACHMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.mp4'];

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

function validateVideoText({ title, description }) {
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

  return '';
}

function validateOptionalVideoFile(videoFile) {
  if (!videoFile) {
    return '';
  }

  if (Number(videoFile.size) > MAX_VIDEO_SIZE) {
    return `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}`;
  }

  if (!videoFile.type?.startsWith('video/')) {
    return '请上传视频文件';
  }

  return ALLOWED_VIDEO_EXTENSIONS.includes(getExtension(videoFile.name)) ? '' : '视频格式只支持 mp4、webm、mov';
}

function validateOptionalCoverFile(coverFile) {
  if (!coverFile) {
    return '';
  }

  if (Number(coverFile.size) > MAX_COVER_SIZE) {
    return `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}`;
  }

  if (!coverFile.type?.startsWith('image/')) {
    return '封面必须是图片文件';
  }

  return ALLOWED_IMAGE_EXTENSIONS.includes(getExtension(coverFile.name)) ? '' : '封面格式只支持 jpg、jpeg、png、webp';
}

function validateUploadInput({ title, description, videoFile, coverFile }) {
  const textValidationMessage = validateVideoText({ title, description });

  if (textValidationMessage) {
    return textValidationMessage;
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

function normalizeAttachments(value) {
  return Array.isArray(value) ? value : [];
}

function validateAttachmentInput(attachments) {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    return `资料文件最多上传 ${MAX_ATTACHMENT_COUNT} 个`;
  }

  for (const attachment of attachments) {
    const fileName = normalizeText(attachment?.name);
    const extension = getExtension(fileName);

    if (!fileName) {
      return '资料文件名不能为空';
    }

    if (fileName.length > 180) {
      return '资料文件名最多 180 个字';
    }

    if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension)) {
      return '资料文件只支持 pdf、doc、docx、ppt、pptx、xls、xlsx、zip、mp4';
    }

    if (Number(attachment?.size) > MAX_ATTACHMENT_SIZE) {
      return `单个资料文件不能超过 ${formatFileSize(MAX_ATTACHMENT_SIZE)}`;
    }
  }

  return '';
}

function normalizeCompletedAttachments(value) {
  return normalizeAttachments(value).map((attachment) => ({
    key: String(attachment?.key || '').trim(),
    fileName: normalizeText(attachment?.fileName),
    fileType: normalizeText(attachment?.fileType)
  }));
}

function normalizeAttachmentPlan(value) {
  const plan = value && typeof value === 'object' ? value : {};

  return {
    keepIds: normalizeIds(plan.keepIds),
    deleteIds: normalizeIds(plan.deleteIds),
    replace: normalizeAttachments(plan.replace).map((attachment) => ({
      oldAttachmentId: Number(attachment?.oldAttachmentId),
      key: String(attachment?.key || '').trim(),
      fileName: normalizeText(attachment?.fileName),
      fileType: normalizeText(attachment?.fileType)
    })).filter((attachment) => Number.isInteger(attachment.oldAttachmentId) && attachment.oldAttachmentId > 0),
    add: normalizeCompletedAttachments(plan.add)
  };
}

function buildAttachmentFileMeta(file) {
  return {
    name: normalizeText(file?.name),
    type: normalizeText(file?.type),
    size: Number(file?.size) || 0
  };
}

async function ensurePrerequisitesValid({ videoId, prerequisiteVideoIds }) {
  if (prerequisiteVideoIds.includes(videoId)) {
    return '前置知识点不能选择当前课程自己';
  }

  if (prerequisiteVideoIds.length === 0) {
    return '';
  }

  const prerequisiteResult = await pool.query(
    `SELECT id FROM videos WHERE id = ANY($1::int[])`,
    [prerequisiteVideoIds]
  );

  if (prerequisiteResult.rowCount !== prerequisiteVideoIds.length) {
    return '部分前置知识点视频不存在';
  }

  const cycleResult = await pool.query(
    `WITH RECURSIVE downstream AS (
       SELECT video_id, prerequisite_video_id
       FROM video_prerequisites
       WHERE prerequisite_video_id = $1
       UNION
       SELECT vp.video_id, vp.prerequisite_video_id
       FROM video_prerequisites vp
       JOIN downstream d ON vp.prerequisite_video_id = d.video_id
     )
     SELECT 1
     FROM downstream
     WHERE video_id = ANY($2::int[])
     LIMIT 1`,
    [videoId, prerequisiteVideoIds]
  );

  return cycleResult.rowCount > 0 ? '前置知识点不能形成循环引用' : '';
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

function normalizeIds(value) {
  const rawValues = Array.isArray(value) ? value : [];

  return [...new Set(rawValues
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0))];
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
videoRouter.get('/', requireUserOrAdmin, async (req, res, next) => {
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
    const attachments = normalizeAttachments(req.body.attachments);
    const validationMessage = validateUploadInput({
      title: normalizeText(req.body.title),
      description: normalizeText(req.body.description),
      videoFile,
      coverFile: req.body.cover
    }) || validateAttachmentInput(attachments);

    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }

    const videoKey = `videos/${uuid()}${getExtension(videoFile.name)}`;
    const coverKey = `covers/${uuid()}${getExtension(req.body.cover.name)}`;
    const attachmentItems = attachments.map((attachment) => {
      const fileName = normalizeText(attachment.name);
      const key = `attachments/${uuid()}${getExtension(fileName)}`;

      return {
        key,
        fileName,
        fileType: normalizeText(attachment.type),
        size: Number(attachment.size) || 0
      };
    });
    const [uploadId, coverUploadUrl, attachmentUploadUrls] = await Promise.all([
      createMultipartUpload({
        key: videoKey,
        contentType: videoFile.type
      }),
      createUploadUrl({
        key: coverKey,
        contentType: req.body.cover.type
      }),
      Promise.all(attachmentItems.map((attachment) => createUploadUrl({
        key: attachment.key,
        contentType: attachment.fileType || 'application/octet-stream'
      })))
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
        },
        attachments: attachmentItems.map((attachment, index) => ({
          key: attachment.key,
          uploadUrl: attachmentUploadUrls[index],
          publicUrl: getPublicUrl(attachment.key),
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          size: attachment.size
        }))
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
    const attachments = normalizeCompletedAttachments(req.body.attachments);
    const prerequisiteVideoIds = normalizeIds(req.body.prerequisiteVideoIds);

    const validationMessage = validateVideoText({ title, description });

    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }

    if (!isExpectedUploadKey(videoKey, 'videos/') || !isExpectedUploadKey(coverKey, 'covers/')) {
      res.status(400).json({ message: '上传文件地址无效' });
      return;
    }

    const completedAttachmentValidation = validateAttachmentInput(attachments.map((attachment) => ({
      name: attachment.fileName,
      type: attachment.fileType,
      size: 0
    })));

    if (completedAttachmentValidation) {
      res.status(400).json({ message: completedAttachmentValidation });
      return;
    }

    for (const attachment of attachments) {
      if (!isExpectedUploadKey(attachment.key, 'attachments/')) {
        res.status(400).json({ message: '资料文件地址无效' });
        return;
      }
    }

    if (prerequisiteVideoIds.length > 0) {
      const prerequisiteResult = await pool.query(
        `SELECT id FROM videos WHERE id = ANY($1::int[])`,
        [prerequisiteVideoIds]
      );

      if (prerequisiteResult.rowCount !== prerequisiteVideoIds.length) {
        res.status(404).json({ message: '部分前置知识点视频不存在' });
        return;
      }
    }

    const [videoHead, coverHead, attachmentHeads] = await Promise.all([
      ensureObjectExists(videoKey),
      ensureObjectExists(coverKey),
      Promise.all(attachments.map((attachment) => ensureObjectExists(attachment.key)))
    ]);

    if (Number(videoHead.ContentLength || 0) > MAX_VIDEO_SIZE) {
      await deleteFromBucket(videoKey).catch(() => {});
      res.status(400).json({ message: `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}` });
      return;
    }

    if (Number(coverHead.ContentLength || 0) > MAX_COVER_SIZE) {
      await deleteFromBucket(coverKey).catch(() => {});
      res.status(400).json({ message: `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}` });
      return;
    }

    for (const [index, head] of attachmentHeads.entries()) {
      if (Number(head.ContentLength || 0) > MAX_ATTACHMENT_SIZE) {
        await deleteFromBucket(attachments[index].key).catch(() => {});
        res.status(400).json({ message: `单个资料文件不能超过 ${formatFileSize(MAX_ATTACHMENT_SIZE)}` });
        return;
      }
    }

    const videoUrl = getPublicUrl(videoKey);
    const coverUrl = getPublicUrl(coverKey);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO videos (title, description, video_url, cover_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, description, video_url, cover_url, created_at`,
        [title, description, videoUrl, coverUrl]
      );

      const video = result.rows[0];

      if (prerequisiteVideoIds.length > 0) {
        await client.query(
          `INSERT INTO video_prerequisites (video_id, prerequisite_video_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT DO NOTHING`,
          [video.id, prerequisiteVideoIds]
        );
      }

      for (const [index, attachment] of attachments.entries()) {
        await client.query(
          `INSERT INTO video_attachments (video_id, file_name, file_url, file_key, file_type, file_size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            video.id,
            attachment.fileName,
            getPublicUrl(attachment.key),
            attachment.key,
            attachment.fileType,
            Number(attachmentHeads[index].ContentLength || 0)
          ]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ data: video });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/videos/edit-upload/create
// 教导主任编辑课程时，为可选替换的视频、封面、附件生成对象存储上传地址。
videoRouter.post('/edit-upload/create', requireSuperAdmin, async (req, res, next) => {
  try {
    const videoFile = req.body.video || null;
    const coverFile = req.body.cover || null;
    const attachments = normalizeAttachments(req.body.attachments);
    const validationMessage = validateVideoText({
      title: normalizeText(req.body.title),
      description: normalizeText(req.body.description)
    }) || validateOptionalVideoFile(videoFile) || validateOptionalCoverFile(coverFile) || validateAttachmentInput(attachments);

    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }

    const videoKey = videoFile ? `videos/${uuid()}${getExtension(videoFile.name)}` : '';
    const coverKey = coverFile ? `covers/${uuid()}${getExtension(coverFile.name)}` : '';
    const attachmentItems = attachments.map((attachment) => {
      const fileName = normalizeText(attachment.name);
      const key = `attachments/${uuid()}${getExtension(fileName)}`;

      return {
        key,
        fileName,
        fileType: normalizeText(attachment.type),
        size: Number(attachment.size) || 0
      };
    });

    const [uploadId, coverUploadUrl, attachmentUploadUrls] = await Promise.all([
      videoFile ? createMultipartUpload({ key: videoKey, contentType: videoFile.type }) : Promise.resolve(''),
      coverFile ? createUploadUrl({ key: coverKey, contentType: coverFile.type }) : Promise.resolve(''),
      Promise.all(attachmentItems.map((attachment) => createUploadUrl({
        key: attachment.key,
        contentType: attachment.fileType || 'application/octet-stream'
      })))
    ]);

    res.json({
      data: {
        video: videoFile ? { key: videoKey, uploadId, publicUrl: getPublicUrl(videoKey) } : null,
        cover: coverFile ? { key: coverKey, uploadUrl: coverUploadUrl, publicUrl: getPublicUrl(coverKey) } : null,
        attachments: attachmentItems.map((attachment, index) => ({
          key: attachment.key,
          uploadUrl: attachmentUploadUrls[index],
          publicUrl: getPublicUrl(attachment.key),
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          size: attachment.size
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/videos/:id
// 获取单个视频详情，播放页会用到。
videoRouter.get('/:id', requireUserOrAdmin, async (req, res, next) => {
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

    const attachmentsResult = await pool.query(
      `SELECT id, file_name, file_url, file_key, file_type, file_size, created_at
       FROM video_attachments
       WHERE video_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );

    const prerequisitesResult = await pool.query(
      `SELECT v.id, v.title
       FROM video_prerequisites vp
       JOIN videos v ON v.id = vp.prerequisite_video_id
       WHERE vp.video_id = $1
       ORDER BY vp.created_at ASC`,
      [req.params.id]
    );

    const descendantsResult = await pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT video_id
         FROM video_prerequisites
         WHERE prerequisite_video_id = $1
         UNION
         SELECT vp.video_id
         FROM video_prerequisites vp
         JOIN descendants d ON vp.prerequisite_video_id = d.video_id
       )
       SELECT video_id AS id
       FROM descendants`,
      [req.params.id]
    );

    res.json({
      data: {
        ...result.rows[0],
        attachments: attachmentsResult.rows,
        prerequisites: prerequisitesResult.rows,
        descendantVideoIds: descendantsResult.rows.map((row) => row.id)
      }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/videos/:id
// 教导主任编辑旧课程记录。文字和前置知识直接改旧记录；替换文件时使用新对象 key，成功后清理旧对象。
videoRouter.patch('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const videoId = Number(req.params.id);
    const title = normalizeText(req.body.title);
    const description = normalizeText(req.body.description);
    const videoKey = String(req.body.videoKey || '').trim();
    const coverKey = String(req.body.coverKey || '').trim();
    const attachmentPlan = normalizeAttachmentPlan(req.body.attachments);
    const shouldUpdatePrerequisites = Object.prototype.hasOwnProperty.call(req.body, 'prerequisiteVideoIds');
    const prerequisiteVideoIds = shouldUpdatePrerequisites ? normalizeIds(req.body.prerequisiteVideoIds) : [];
    const validationMessage = validateVideoText({ title, description });

    if (!Number.isInteger(videoId) || videoId <= 0) {
      res.status(400).json({ message: '课程 id 无效' });
      return;
    }

    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }

    if (videoKey && !isExpectedUploadKey(videoKey, 'videos/')) {
      res.status(400).json({ message: '视频文件地址无效' });
      return;
    }

    if (coverKey && !isExpectedUploadKey(coverKey, 'covers/')) {
      res.status(400).json({ message: '封面文件地址无效' });
      return;
    }

    const plannedNewAttachments = [...attachmentPlan.replace, ...attachmentPlan.add];
    const attachmentValidation = validateAttachmentInput(plannedNewAttachments.map((attachment) => buildAttachmentFileMeta({
      name: attachment.fileName,
      type: attachment.fileType,
      size: 0
    })));

    if (attachmentValidation) {
      res.status(400).json({ message: attachmentValidation });
      return;
    }

    for (const attachment of plannedNewAttachments) {
      if (!isExpectedUploadKey(attachment.key, 'attachments/')) {
        res.status(400).json({ message: '资料文件地址无效' });
        return;
      }
    }

    if (shouldUpdatePrerequisites) {
      const prerequisiteValidation = await ensurePrerequisitesValid({ videoId, prerequisiteVideoIds });

      if (prerequisiteValidation) {
        res.status(prerequisiteValidation.includes('不存在') ? 404 : 400).json({ message: prerequisiteValidation });
        return;
      }
    }

    const videoResult = await pool.query(
      `SELECT id, video_url, cover_url FROM videos WHERE id = $1`,
      [videoId]
    );

    if (videoResult.rowCount === 0) {
      res.status(404).json({ message: '课程不存在' });
      return;
    }

    const oldVideo = videoResult.rows[0];
    const currentAttachmentsResult = await pool.query(
      `SELECT id, file_key FROM video_attachments WHERE video_id = $1`,
      [videoId]
    );
    const currentAttachmentIds = new Set(currentAttachmentsResult.rows.map((item) => item.id));
    const changedOldAttachmentIds = [
      ...attachmentPlan.deleteIds,
      ...attachmentPlan.replace.map((item) => item.oldAttachmentId)
    ];
    const submittedOldAttachmentIds = [
      ...attachmentPlan.keepIds,
      ...changedOldAttachmentIds
    ];

    if (new Set(submittedOldAttachmentIds).size !== submittedOldAttachmentIds.length) {
      res.status(400).json({ message: '资料编辑清单重复' });
      return;
    }

    if (submittedOldAttachmentIds.some((id) => !currentAttachmentIds.has(id))) {
      res.status(400).json({ message: '资料编辑清单包含不属于当前课程的资料' });
      return;
    }

    const untouchedAttachmentCount = currentAttachmentsResult.rows.filter((attachment) => !changedOldAttachmentIds.includes(attachment.id)).length;
    const finalAttachmentCount = untouchedAttachmentCount + attachmentPlan.replace.length + attachmentPlan.add.length;

    if (finalAttachmentCount > MAX_ATTACHMENT_COUNT) {
      res.status(400).json({ message: `资料文件最多上传 ${MAX_ATTACHMENT_COUNT} 个` });
      return;
    }

    const [videoHead, coverHead, newAttachmentHeads] = await Promise.all([
      videoKey ? ensureObjectExists(videoKey) : Promise.resolve(null),
      coverKey ? ensureObjectExists(coverKey) : Promise.resolve(null),
      Promise.all(plannedNewAttachments.map((attachment) => ensureObjectExists(attachment.key)))
    ]);

    if (videoHead && Number(videoHead.ContentLength || 0) > MAX_VIDEO_SIZE) {
      await deleteFromBucket(videoKey).catch(() => {});
      res.status(400).json({ message: `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}` });
      return;
    }

    if (coverHead && Number(coverHead.ContentLength || 0) > MAX_COVER_SIZE) {
      await deleteFromBucket(coverKey).catch(() => {});
      res.status(400).json({ message: `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}` });
      return;
    }

    for (const [index, head] of newAttachmentHeads.entries()) {
      if (Number(head.ContentLength || 0) > MAX_ATTACHMENT_SIZE) {
        await deleteFromBucket(plannedNewAttachments[index].key).catch(() => {});
        res.status(400).json({ message: `单个资料文件不能超过 ${formatFileSize(MAX_ATTACHMENT_SIZE)}` });
        return;
      }
    }

    const oldKeysToDelete = [
      videoKey ? getKeyFromPublicUrl(oldVideo.video_url) : '',
      coverKey ? getKeyFromPublicUrl(oldVideo.cover_url) : '',
      ...currentAttachmentsResult.rows
        .filter((attachment) => changedOldAttachmentIds.includes(attachment.id))
        .map((attachment) => attachment.file_key)
    ].filter(Boolean);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE videos
         SET title = $1,
             description = $2,
             video_url = COALESCE($3, video_url),
             cover_url = COALESCE($4, cover_url)
         WHERE id = $5
         RETURNING id, title, description, video_url, cover_url, created_at`,
        [title, description, videoKey ? getPublicUrl(videoKey) : null, coverKey ? getPublicUrl(coverKey) : null, videoId]
      );

      if (shouldUpdatePrerequisites) {
        await client.query('DELETE FROM video_prerequisites WHERE video_id = $1', [videoId]);

        if (prerequisiteVideoIds.length > 0) {
          await client.query(
            `INSERT INTO video_prerequisites (video_id, prerequisite_video_id)
             SELECT $1, unnest($2::int[])
             ON CONFLICT DO NOTHING`,
            [videoId, prerequisiteVideoIds]
          );
        }
      }

      if (changedOldAttachmentIds.length > 0) {
        await client.query(
          `DELETE FROM video_attachments WHERE video_id = $1 AND id = ANY($2::int[])`,
          [videoId, changedOldAttachmentIds]
        );
      }

      for (const [index, attachment] of plannedNewAttachments.entries()) {
        await client.query(
          `INSERT INTO video_attachments (video_id, file_name, file_url, file_key, file_type, file_size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [videoId, attachment.fileName, getPublicUrl(attachment.key), attachment.key, attachment.fileType, Number(newAttachmentHeads[index].ContentLength || 0)]
        );
      }

      await client.query('COMMIT');
      await Promise.all(oldKeysToDelete.map((key) => deleteFromBucket(key).catch(() => {})));
      res.json({ data: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /api/videos/:id
// 删除视频接口。
// 删除顺序：先删除数据库记录，让前置知识关系和学生主页历史记录按外键规则稳定落库；
// 数据库提交成功后再删除存储桶对象，失败时只留下可清理的孤儿文件，不影响业务数据。
videoRouter.delete('/:id', requireSuperAdmin, async (req, res, next) => {
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

    const attachmentsResult = await pool.query(
      `SELECT file_key
       FROM video_attachments
       WHERE video_id = $1`,
      [req.params.id]
    );

    const video = findResult.rows[0];
    const objectKeys = [
      getKeyFromPublicUrl(video.video_url),
      getKeyFromPublicUrl(video.cover_url),
      ...attachmentsResult.rows.map((attachment) => attachment.file_key)
    ].filter(Boolean);

    await pool.query('DELETE FROM videos WHERE id = $1', [video.id]);
    await Promise.all(objectKeys.map((key) => deleteFromBucket(key).catch(() => {})));

    res.json({ message: '删除成功' });
  } catch (error) {
    next(error);
  }
});
