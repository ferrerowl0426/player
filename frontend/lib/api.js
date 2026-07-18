function getApiBaseUrl() {
  if (typeof window === 'undefined') {
    return process.env.SERVER_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3002/api';
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3002/api';
}

async function parseJsonResponse(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || fallbackMessage);
  }

  return result;
}

function buildVideoQuery(filters = {}) {
  const params = new URLSearchParams();
  const keyword = String(filters.keyword || '').trim();
  const startDate = String(filters.startDate || '').trim();
  const endDate = String(filters.endDate || '').trim();

  if (keyword) {
    params.set('keyword', keyword);
  }

  if (startDate) {
    params.set('startDate', startDate);
  }

  if (endDate) {
    params.set('endDate', endDate);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

// 获取视频列表，支持关键词和日期区间筛选。
export async function fetchVideos(filters = {}) {
  const response = await fetch(`${getApiBaseUrl()}/videos${buildVideoQuery(filters)}`, {
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频列表失败');
}

// 获取单个视频详情。
export async function fetchVideoById(id) {
  const response = await fetch(`${getApiBaseUrl()}/videos/${id}`, {
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频详情失败');
}

// 管理员登录。后端会设置 HttpOnly Cookie，前端不直接保存 token。
export async function loginAdmin({ username, password }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return parseJsonResponse(response, '管理员登录失败');
}

// 检查管理员是否已登录。
export async function fetchAdminMe() {
  const response = await fetch(`${getApiBaseUrl()}/admin/me`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '请先登录管理员账号');
}

// 管理员退出登录。
export async function logoutAdmin() {
  const response = await fetch(`${getApiBaseUrl()}/admin/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  return parseJsonResponse(response, '退出登录失败');
}

// 向后端申请 Multipart 上传任务和封面的临时上传地址。
export async function createMultipartVideoUpload({ title, description, video, cover }) {
  const response = await fetch(`${getApiBaseUrl()}/videos/multipart/create`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title,
      description,
      video: {
        name: video.name,
        size: video.size,
        type: video.type
      },
      cover: {
        name: cover.name,
        size: cover.size,
        type: cover.type
      }
    })
  });

  return parseJsonResponse(response, '创建分片上传任务失败');
}

// 获取单个分片的临时上传地址。
export async function createMultipartPartUploadUrl({ uploadId, key, partNumber }) {
  const response = await fetch(`${getApiBaseUrl()}/videos/multipart/part-url`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      key,
      partNumber
    })
  });

  return parseJsonResponse(response, '获取分片上传地址失败');
}

// 浏览器用分片临时地址直接 PUT 分片到对象存储，并返回对象存储生成的 ETag。
export async function uploadMultipartPartToBucket({ uploadUrl, blob, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('PUT', uploadUrl);

    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(xhr.getResponseHeader('ETag') || '');
        return;
      }

      reject(new Error('直传分片到存储桶失败'));
    };

    xhr.onerror = () => {
      reject(new Error('直传分片到存储桶失败'));
    };

    xhr.send(blob);
  });
}

// 分片全部上传完成后，通知后端合并成最终视频对象。
export async function completeMultipartVideoUpload({ uploadId, key, parts }) {
  const response = await fetch(`${getApiBaseUrl()}/videos/multipart/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      key,
      parts
    })
  });

  return parseJsonResponse(response, '完成分片上传失败');
}

// 取消 Multipart 上传任务。
export async function abortMultipartVideoUpload({ uploadId, key }) {
  const response = await fetch(`${getApiBaseUrl()}/videos/multipart/abort`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      key
    })
  });

  return parseJsonResponse(response, '取消分片上传失败');
}

// 浏览器用后端给的临时地址，直接 PUT 文件到对象存储。
// 这里使用 XMLHttpRequest，因为 fetch 目前不能直接读取上传进度。
export async function uploadFileToBucket({ uploadUrl, file, onProgress }) {
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }

      reject(new Error('直传文件到存储桶失败'));
    };

    xhr.onerror = () => {
      reject(new Error('直传文件到存储桶失败'));
    };

    xhr.send(file);
  });
}

// 直传完成后，通知后端写入数据库。
export async function completeVideoUpload({ title, description, videoKey, coverKey }) {
  const response = await fetch(`${getApiBaseUrl()}/videos/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title,
      description,
      videoKey,
      coverKey
    })
  });

  return parseJsonResponse(response, '保存视频信息失败');
}

// 删除视频。
export async function deleteVideo(id) {
  const response = await fetch(`${getApiBaseUrl()}/videos/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  return parseJsonResponse(response, '删除视频失败');
}
