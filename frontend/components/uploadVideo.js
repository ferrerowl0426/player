import {
  abortMultipartVideoUpload,
  completeMultipartVideoUpload,
  completeVideoUpload,
  createMultipartPartUploadUrl,
  createMultipartVideoUpload,
  uploadFileToBucket,
  uploadMultipartPartToBucket
} from '../lib/api.js';

export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
export const MAX_COVER_SIZE = 5 * 1024 * 1024;

const VIDEO_PART_SIZE = 8 * 1024 * 1024;
const VIDEO_UPLOAD_CONCURRENCY = 3;
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];

export function formatFileSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function isInvalidTextValue(value) {
  return INVALID_TEXT_VALUES.includes(value.trim().toLowerCase());
}

export function validateUploadForm(formData) {
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const video = formData.get('video');
  const cover = formData.get('cover');

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

  if (!video || video.size === 0) {
    return '请上传视频文件';
  }

  if (!video.type.startsWith('video/')) {
    return '请上传视频文件';
  }

  if (video.size > MAX_VIDEO_SIZE) {
    return `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}`;
  }

  if (!cover || cover.size === 0) {
    return '请上传封面图片';
  }

  if (!cover.type.startsWith('image/')) {
    return '封面必须是图片文件';
  }

  if (cover.size > MAX_COVER_SIZE) {
    return `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}`;
  }

  return '';
}

function buildVideoParts(file) {
  const partCount = Math.ceil(file.size / VIDEO_PART_SIZE);

  return Array.from({ length: partCount }, (_, index) => {
    const start = index * VIDEO_PART_SIZE;
    const end = Math.min(start + VIDEO_PART_SIZE, file.size);

    return {
      partNumber: index + 1,
      size: end - start,
      blob: file.slice(start, end)
    };
  });
}

async function uploadVideoByMultipart({ file, key, uploadId, onProgress }) {
  const fileParts = buildVideoParts(file);
  const loadedBytesByPart = new Map();
  const uploadedParts = [];
  let nextIndex = 0;

  function updateProgress(partNumber, loadedBytes) {
    loadedBytesByPart.set(partNumber, loadedBytes);
    const loadedTotal = Array.from(loadedBytesByPart.values()).reduce((sum, value) => sum + value, 0);
    onProgress(Math.round((loadedTotal / file.size) * 100));
  }

  async function uploadNextPart() {
    const part = fileParts[nextIndex];
    nextIndex += 1;

    if (!part) {
      return;
    }

    // 每个分片都先向后端申请预签名 URL，真实文件内容仍由浏览器直传腾讯云 COS。
    const partUrlResult = await createMultipartPartUploadUrl({
      key,
      uploadId,
      partNumber: part.partNumber
    });
    const etag = await uploadMultipartPartToBucket({
      uploadUrl: partUrlResult.data.uploadUrl,
      blob: part.blob,
      contentType: file.type,
      onProgress: (progress) => updateProgress(part.partNumber, Math.round((progress / 100) * part.size))
    });

    uploadedParts.push({
      etag,
      partNumber: part.partNumber
    });

    await uploadNextPart();
  }

  await Promise.all(
    Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, fileParts.length) }, () => uploadNextPart())
  );

  onProgress(100);

  return uploadedParts.sort((first, second) => first.partNumber - second.partNumber);
}

export async function uploadVideoFromForm({ formData, onStatus, onProgress }) {
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const video = formData.get('video');
  const cover = formData.get('cover');

  onStatus('正在获取上传地址...');
  const multipartUpload = await createMultipartVideoUpload({ title, description, video, cover });
  const uploadInfo = multipartUpload.data;

  try {
    onStatus('正在分片直传视频到存储桶...');
    const parts = await uploadVideoByMultipart({
      file: video,
      key: uploadInfo.video.key,
      uploadId: uploadInfo.video.uploadId,
      onProgress: (progress) => onProgress((current) => ({ ...current, video: progress }))
    });

    onStatus('正在合并视频分片...');
    await completeMultipartVideoUpload({
      key: uploadInfo.video.key,
      uploadId: uploadInfo.video.uploadId,
      parts
    });
  } catch (error) {
    await abortMultipartVideoUpload({
      key: uploadInfo.video.key,
      uploadId: uploadInfo.video.uploadId
    }).catch(() => {});
    throw error;
  }

  onStatus('正在直传封面到存储桶...');
  await uploadFileToBucket({
    uploadUrl: uploadInfo.cover.uploadUrl,
    file: cover,
    onProgress: (progress) => onProgress((current) => ({ ...current, cover: progress }))
  });

  onStatus('正在保存视频信息...');
  await completeVideoUpload({
    title,
    description,
    videoKey: uploadInfo.video.key,
    coverKey: uploadInfo.cover.key
  });
}
