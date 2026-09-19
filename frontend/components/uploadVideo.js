export const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

const VIDEO_PART_SIZE = 8 * 1024 * 1024;
const VIDEO_UPLOAD_CONCURRENCY = 3;

export function formatFileSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
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

export async function uploadVideoByMultipart({ file, key, uploadId, onProgress, uploadPart, uploadPartFile }) {
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
    const partUrlResult = await uploadPart({
      key,
      uploadId,
      partNumber: part.partNumber
    });
    const uploadUrl = partUrlResult?.data?.uploadUrl || partUrlResult?.uploadUrl || partUrlResult;
    const etag = await uploadPartFile({
      uploadUrl,
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

