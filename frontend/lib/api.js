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

function uploadBlobWithProgress({ uploadUrl, body, contentType, onProgress, errorMessage, resolveValue }) {
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
        resolve(resolveValue ? resolveValue(xhr) : undefined);
        return;
      }

      reject(new Error(errorMessage));
    };

    xhr.onerror = () => {
      reject(new Error(errorMessage));
    };

    xhr.send(body);
  });
}

// 获取视频列表，支持关键词和日期区间筛选。
export async function fetchVideos(filters = {}) {
  const response = await fetch(`${getApiBaseUrl()}/videos${buildVideoQuery(filters)}`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频列表失败');
}

// 获取单个视频详情。
export async function fetchVideoById(id) {
  const response = await fetch(`${getApiBaseUrl()}/videos/${id}`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频详情失败');
}

// 学员登录。后端会设置独立的 HttpOnly Cookie。
export async function loginUser({ username, password }) {
  const response = await fetch(`${getApiBaseUrl()}/user/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return parseJsonResponse(response, '学员登录失败');
}

// 检查学员是否已登录。
export async function fetchUserMe() {
  const response = await fetch(`${getApiBaseUrl()}/user/me`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '请先登录学员账号');
}

// 学员退出登录。
export async function logoutUser() {
  const response = await fetch(`${getApiBaseUrl()}/user/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  return parseJsonResponse(response, '退出登录失败');
}

// 获取学员自己的今日作业。
export async function fetchTodayAssignments() {
  const response = await fetch(`${getApiBaseUrl()}/user/assignments/today`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取今日作业失败');
}

// 老师登录。后端会设置 HttpOnly Cookie，前端不直接保存 token。
export async function loginAdmin({ username, password }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return parseJsonResponse(response, '老师登录失败');
}

// 检查老师是否已登录。
export async function fetchAdminMe() {
  const response = await fetch(`${getApiBaseUrl()}/admin/me`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '请先登录老师账号');
}

// 老师退出登录。
export async function logoutAdmin() {
  const response = await fetch(`${getApiBaseUrl()}/admin/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  return parseJsonResponse(response, '退出登录失败');
}

// 老师查看学员列表。
export async function fetchManagedUsers() {
  const response = await fetch(`${getApiBaseUrl()}/admin/users`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取学员列表失败');
}

// 老师创建学员。
export async function createManagedUser({ username, password, classId }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password, classId })
  });

  return parseJsonResponse(response, '创建学员失败');
}

// 老师重置学员密码。
export async function resetManagedUserPassword({ id, password }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}/reset-password`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });

  return parseJsonResponse(response, '重置学员密码失败');
}

// 老师启用或禁用学员。
export async function updateManagedUserStatus({ id, isActive }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ isActive })
  });

  return parseJsonResponse(response, '更新学员状态失败');
}

// 老师查看老师账号列表。
export async function fetchManagedAdmins() {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取老师列表失败');
}

// 老师创建其他老师。
export async function createManagedAdmin({ username, password }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return parseJsonResponse(response, '创建老师失败');
}

// 老师重置其他老师密码。
export async function resetManagedAdminPassword({ id, password }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins/${id}/reset-password`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });

  return parseJsonResponse(response, '重置老师密码失败');
}

// 删除老师时后端会保证至少还剩一个老师。
export async function deleteManagedAdmin(id) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  return parseJsonResponse(response, '删除老师失败');
}

// 老师查看指定学员的历史推送。
export async function fetchUserAssignments(userId) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/assignments`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取推送记录失败');
}

// 老师给指定学员保存一次推送操作，可以同时包含视频和留言。
export async function createUserAssignment({ userId, videoIds, message = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/assignments`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ videoIds, message })
  });

  return parseJsonResponse(response, '创建推送失败');
}

// 留言板独立更新，不和视频推送绑定。
export async function updateUserAssignmentMessage({ userId, message }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/message`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });

  return parseJsonResponse(response, '更新留言失败');
}

// 取消正在推送的视频，历史记录仍会保留。
export async function cancelUserAssignment(id) {
  const response = await fetch(`${getApiBaseUrl()}/admin/assignments/${id}/cancel`, {
    method: 'PATCH',
    credentials: 'include'
  });

  return parseJsonResponse(response, '取消推送失败');
}

// 删除推送记录时只做软删除，后端会要求填写原因。
export async function softDeleteAssignment({ id, reason }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/assignments/${id}/delete`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason })
  });

  return parseJsonResponse(response, '删除推送记录失败');
}

// 删除整个操作聚合：把该 operation_id 下所有未删除的记录软删除。
export async function deleteOperation({ operationId, reason }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/operations/${operationId}/delete`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason })
  });

  return parseJsonResponse(response, '删除操作失败');
}

// 向后端申请 Multipart 上传任务、封面和资料附件的临时上传地址。
export async function createMultipartVideoUpload({ title, description, video, cover, attachments = [] }) {
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
      },
      attachments: attachments.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type
      }))
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
  return uploadBlobWithProgress({
    uploadUrl,
    body: blob,
    contentType,
    onProgress,
    errorMessage: '直传分片到存储桶失败',
    resolveValue: (xhr) => xhr.getResponseHeader('ETag') || ''
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
  await uploadBlobWithProgress({
    uploadUrl,
    body: file,
    contentType: file.type,
    onProgress,
    errorMessage: '直传文件到存储桶失败'
  });
}

// 直传完成后，通知后端写入数据库。
export async function completeVideoUpload({ title, description, videoKey, coverKey, attachments = [] }) {
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
      coverKey,
      attachments
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

// 获取班级列表，包含班级下的学员。
export async function fetchClasses() {
  const response = await fetch(`${getApiBaseUrl()}/admin/classes`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取班级列表失败');
}

// 教导主任创建班级。
export async function createClass({ name, teacherId }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/classes`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, teacherId })
  });

  return parseJsonResponse(response, '创建班级失败');
}

// 教导主任修改班级信息。
export async function updateClass({ id, name, teacherId }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/classes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, teacherId })
  });

  return parseJsonResponse(response, '修改班级失败');
}

// 教导主任删除班级。
export async function deleteClass(id) {
  const response = await fetch(`${getApiBaseUrl()}/admin/classes/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  return parseJsonResponse(response, '删除班级失败');
}

// 教导主任给学员转班。
export async function transferUserClass({ id, classId }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}/class`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ classId })
  });

  return parseJsonResponse(response, '转班失败');
}
