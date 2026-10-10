function getApiBaseUrl() {
  if (typeof window === 'undefined') {
    return process.env.SERVER_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
}

async function parseJsonResponse(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.message || fallbackMessage);
    error.status = response.status;
    throw error;
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

function buildKeywordQuery(keyword) {
  const params = new URLSearchParams();
  const value = String(keyword || '').trim();

  if (value) {
    params.set('keyword', value);
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

// 图书馆资料浏览，游客也可以访问。
export async function fetchLibraryResources(keyword = '') {
  const response = await fetch(`${getApiBaseUrl()}/library${buildKeywordQuery(keyword)}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  return parseJsonResponse(response, '获取图书馆失败');
}

export async function fetchLibraryResourceById(id) {
  const response = await fetch(`${getApiBaseUrl()}/library/${id}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  return parseJsonResponse(response, '获取资料详情失败');
}

export async function createLibraryUploadUrl(file, kind = 'pdf') {
  const response = await fetch(`${getApiBaseUrl()}/library/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, fileName: file.name, fileType: file.type, fileSize: file.size })
  });
  return parseJsonResponse(response, '创建资料上传地址失败');
}

export async function createTrackAttachmentUploadUrl({ trackId, file }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/attachments/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size })
  });
  return parseJsonResponse(response, '创建附件上传地址失败');
}

export async function saveTrackAttachments({ trackId, attachments }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/attachments`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments })
  });
  return parseJsonResponse(response, '保存附件失败');
}

export async function createKnowledgeAttachmentUploadUrl({ pointId, file }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/attachments/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size })
  });
  return parseJsonResponse(response, '创建附件上传地址失败');
}

export async function saveKnowledgeAttachments({ pointId, attachments }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/attachments`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments })
  });
  return parseJsonResponse(response, '保存附件失败');
}

export async function uploadLibraryFileToBucket({ uploadUrl, file, onProgress }) {
  await uploadBlobWithProgress({
    uploadUrl,
    body: file,
    contentType: file.type,
    onProgress,
    errorMessage: '上传图书馆资料到存储桶失败'
  });
}

export async function createLibraryResource({ title, description = '', cover = '', fileName, fileKey, fileType, fileSize, links = [] }) {
  const response = await fetch(`${getApiBaseUrl()}/library`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, cover, fileName, fileKey, fileType, fileSize, links })
  });
  return parseJsonResponse(response, '保存资料失败');
}

export async function updateLibraryResource({ id, title, description = '', cover = '', links = [] }) {
  const response = await fetch(`${getApiBaseUrl()}/library/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, cover, links })
  });
  return parseJsonResponse(response, '更新资料失败');
}

export async function saveLibraryResourceLinks({ id, links }) {
  const response = await fetch(`${getApiBaseUrl()}/library/${id}/links`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links })
  });
  return parseJsonResponse(response, '保存图书馆关联失败');
}

export async function saveContentLibraryLinks({ objectType, objectId, selectedResourceIds, originalResourceIds = [] }) {
  const target = { objectType, objectId };
  const selectedIds = Array.from(new Set(selectedResourceIds || []));
  const affectedIds = Array.from(new Set([...(originalResourceIds || []), ...selectedIds]));

  await Promise.all(affectedIds.map(async (resourceId) => {
    const detail = await fetchLibraryResourceById(resourceId);
    const links = (detail.data.links || []).filter((link) => (
      !((link.objectType ?? link.object_type) === objectType && Number(link.objectId ?? link.object_id) === Number(objectId))
    ));
    if (selectedIds.includes(resourceId)) links.push(target);
    await saveLibraryResourceLinks({ id: resourceId, links });
  }));

  return { data: selectedIds };
}

export async function deleteLibraryResource(id) {
  const response = await fetch(`${getApiBaseUrl()}/library/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (response.status === 204) return { data: null };
  return parseJsonResponse(response, '删除资料失败');
}

// 获取曲目库首页数据，游客也可以访问。
export async function fetchTrackLibrary(keyword = '') {
  const response = await fetch(`${getApiBaseUrl()}/tracks${buildKeywordQuery(keyword)}`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取曲目库失败');
}

// 获取单个曲目详情。
export async function fetchTrackById(id) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${id}`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取曲目详情失败');
}

// 获取曲谱集详情。
export async function fetchCollectionById(id) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/collections/${id}`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取曲谱集详情失败');
}

// 获取知识点区首页数据。
export async function fetchKnowledgeLibrary(keyword = '') {
  const response = await fetch(`${getApiBaseUrl()}/knowledge${buildKeywordQuery(keyword)}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  return parseJsonResponse(response, '获取知识点区失败');
}

export async function fetchKnowledgePointById(id) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${id}`, { credentials: 'include', cache: 'no-store' });
  return parseJsonResponse(response, '获取知识点详情失败');
}

export async function fetchKnowledgeCollectionById(id) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/collections/${id}`, { credentials: 'include', cache: 'no-store' });
  return parseJsonResponse(response, '获取知识点集详情失败');
}

export async function createKnowledgeCollection({ name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/collections`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '创建知识点集失败');
}

export async function updateKnowledgeCollection({ id, name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/collections/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '更新知识点集失败');
}

export async function deleteKnowledgeCollection(id) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/collections/${id}`, { method: 'DELETE', credentials: 'include' });
  if (response.status === 204) return { data: null };
  return parseJsonResponse(response, '删除知识点集失败');
}

export async function updateKnowledgeCollectionItems({ id, pointIds }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/collections/${id}/points`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pointIds })
  });
  return parseJsonResponse(response, '更新知识点集收录失败');
}

export async function createKnowledgePoint({ name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, cover }) });
  return parseJsonResponse(response, '创建知识点失败');
}

export async function updateKnowledgePoint({ id, name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, cover }) });
  return parseJsonResponse(response, '更新知识点失败');
}

export async function deleteKnowledgePoint(id) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${id}`, { method: 'DELETE', credentials: 'include' });
  if (response.status === 204) return { data: null };
  return parseJsonResponse(response, '删除知识点失败');
}

export async function createKnowledgePartUpload({ pointId, partNo, title, video }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/upload/create`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partNo, title, video: { name: video.name, size: video.size, type: video.type } }) });
  return parseJsonResponse(response, '创建知识点 P 上传任务失败');
}

export async function createKnowledgePartUploadUrl({ pointId, uploadId, key, partNumber }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/upload/part-url`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId, key, partNumber }) });
  return parseJsonResponse(response, '获取知识点 P 分片地址失败');
}

export async function completeKnowledgePartUpload({ pointId, uploadId, key, parts }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/upload/complete`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId, key, parts }) });
  return parseJsonResponse(response, '完成知识点 P 上传失败');
}

export async function abortKnowledgePartUpload({ pointId, uploadId, key }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/upload/abort`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId, key }) });
  return parseJsonResponse(response, '取消知识点 P 上传失败');
}

export async function saveKnowledgePart({ pointId, partNo, title, duration, videoKey }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partNo, title, duration, videoKey }) });
  return parseJsonResponse(response, '保存知识点 P 失败');
}

export async function updateKnowledgePart({ pointId, partId, partNo, title, duration }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/${partId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partNo, title, duration }) });
  return parseJsonResponse(response, '更新知识点 P 失败');
}

export async function deleteKnowledgePart({ pointId, partId }) {
  const response = await fetch(`${getApiBaseUrl()}/knowledge/${pointId}/parts/${partId}`, { method: 'DELETE', credentials: 'include' });
  if (response.status === 204) return { data: null };
  return parseJsonResponse(response, '删除知识点 P 失败');
}

// 创建曲目。
export async function createTrack({ name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '创建曲目失败');
}

// 更新曲目。
export async function updateTrack({ id, name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '更新曲目失败');
}

// 删除曲目。
export async function deleteTrack(id) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (response.status === 204) {
    return { data: null };
  }

  return parseJsonResponse(response, '删除曲目失败');
}

export async function createTrackCollection({ name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/collections`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '创建曲谱集失败');
}

export async function updateTrackCollection({ id, name, description = '', cover = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/collections/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, cover })
  });
  return parseJsonResponse(response, '更新曲谱集失败');
}

export async function deleteTrackCollection(id) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/collections/${id}`, { method: 'DELETE', credentials: 'include' });
  if (response.status === 204) return { data: null };
  return parseJsonResponse(response, '删除曲谱集失败');
}

export async function updateTrackCollectionItems({ id, trackIds }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/collections/${id}/tracks`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackIds })
  });
  return parseJsonResponse(response, '更新曲谱集收录失败');
}

export async function fetchPrerequisites({ objectType, objectId }) {
  const response = await fetch(`${getApiBaseUrl()}/prerequisites?objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}`, {
    credentials: 'include',
    cache: 'no-store'
  });
  return parseJsonResponse(response, '读取前置内容失败');
}

export async function savePrerequisites({ objectType, objectId, prerequisites }) {
  const response = await fetch(`${getApiBaseUrl()}/prerequisites`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectType, objectId, prerequisites })
  });
  return parseJsonResponse(response, '保存前置内容失败');
}

// 创建 P 分段上传任务。
export async function createTrackPartUpload({ trackId, partNo, title, video }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/upload/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partNo,
      title,
      video: { name: video.name, size: video.size, type: video.type }
    })
  });
  return parseJsonResponse(response, '创建 P 分段上传任务失败');
}

export async function createTrackPartUploadUrl({ trackId, uploadId, key, partNumber }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/upload/part-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, partNumber })
  });
  return parseJsonResponse(response, '获取 P 分片上传地址失败');
}

export async function completeTrackPartUpload({ trackId, uploadId, key, parts }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/upload/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, parts })
  });
  return parseJsonResponse(response, '完成 P 分段上传失败');
}

export async function abortTrackPartUpload({ trackId, uploadId, key }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/upload/abort`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key })
  });
  return parseJsonResponse(response, '取消 P 分段上传失败');
}

export async function saveTrackPart({ trackId, partNo, title, duration, videoKey }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partNo, title, duration, videoKey })
  });
  return parseJsonResponse(response, '保存 P 分段失败');
}

export async function updateTrackPart({ trackId, partId, partNo, title, duration }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/${partId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partNo, title, duration })
  });
  return parseJsonResponse(response, '更新 P 分段失败');
}

export async function deleteTrackPart({ trackId, partId }) {
  const response = await fetch(`${getApiBaseUrl()}/tracks/${trackId}/parts/${partId}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (response.status === 204) {
    return { data: null };
  }

  return parseJsonResponse(response, '删除 P 分段失败');
}

export async function loginByAccount({ username, password }) {
  const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  return parseJsonResponse(response, '登录失败');
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

// 获取学员自己的历史作业，按一次推送 operation 聚合。
export async function fetchAssignmentHistory() {
  const response = await fetch(`${getApiBaseUrl()}/user/assignments/history`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取历史作业失败');
}

// 老师登录。后端会设置 HttpOnly Cookie，前端不直接保存 token。
// expectedRole 用于前端告诉后端当前选择的登录身份（teacher 或 super_admin），
// 后端会校验账号实际角色必须和选择的身份一致。
export async function loginAdmin({ username, password, expectedRole }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password, expectedRole })
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

export async function fetchCurrentViewer() {
  try {
    const result = await fetchUserMe();
    return { ...result, data: { ...result.data, role: 'user' } };
  } catch {
    try {
      return await fetchAdminMe();
    } catch {
      return { data: { role: 'guest', username: '访客', nickname: '访客' } };
    }
  }
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
export async function createManagedUser({ username, password, classId, nickname = '' }) {
  const body = { username, password };
  if (classId) body.classId = classId;
  if (nickname) body.nickname = nickname;
  const response = await fetch(`${getApiBaseUrl()}/admin/users`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
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

export async function updateManagedUser({ id, nickname }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname })
  });

  return parseJsonResponse(response, '更新学员资料失败');
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

export async function updateManagedUserMark({ id, isMarked }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}/mark`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isMarked })
  });

  return parseJsonResponse(response, '更新学员标记失败');
}

export async function clearManagedUserMarks() {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/marks/clear`, {
    method: 'POST',
    credentials: 'include'
  });

  return parseJsonResponse(response, '清除学员标记失败');
}

// 教导主任删除学员。
export async function deleteManagedUser(id) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  return parseJsonResponse(response, '删除学员失败');
}

// 老师查看老师账号列表。
export async function fetchManagedAdmins() {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins`, {
    credentials: 'include',
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取老师列表失败');
}

// 教导主任创建老师或教导主任账号。
export async function createManagedAdmin({ username, password, role, nickname = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password, role, nickname })
  });

  return parseJsonResponse(response, '创建账号失败');
}

export async function updateManagedAdmin({ id, nickname }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname })
  });

  return parseJsonResponse(response, '更新账号资料失败');
}

export async function updateManagedAdminStatus({ id, status, isActive }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/admins/${id}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status, isActive })
  });

  return parseJsonResponse(response, '更新账号状态失败');
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

// 老师给指定学员保存一次推送操作，可以同时包含旧视频和新内容对象。
export async function createUserAssignment({ userId, videoIds, objects = [], objectType, objectId, partId, practiceRequirement = '', submitRequirement = '', message = '' }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/users/${userId}/assignments`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoIds, objects, objectType, objectId, partId, practiceRequirement, submitRequirement, message })
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
  const body = {};
  if (name !== undefined) body.name = name;
  if (teacherId !== undefined) body.teacherId = teacherId;

  const response = await fetch(`${getApiBaseUrl()}/admin/classes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return parseJsonResponse(response, '修改班级失败');
}

// 教导主任停用或恢复班级。
export async function updateClassStatus({ id, isActive }) {
  const response = await fetch(`${getApiBaseUrl()}/admin/classes/${id}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ isActive })
  });

  return parseJsonResponse(response, '更新班级状态失败');
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
