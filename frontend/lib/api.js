const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

async function parseJsonResponse(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || fallbackMessage);
  }

  return result;
}

// 获取视频列表。
export async function fetchVideos() {
  const response = await fetch(`${API_BASE_URL}/videos`, {
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频列表失败');
}

// 获取单个视频详情。
export async function fetchVideoById(id) {
  const response = await fetch(`${API_BASE_URL}/videos/${id}`, {
    cache: 'no-store'
  });

  return parseJsonResponse(response, '获取视频详情失败');
}

// 上传视频。
// 前端把表单文件提交给后端，由后端上传到对象存储并保存数据库记录。
export async function uploadVideo(formData) {
  const response = await fetch(`${API_BASE_URL}/videos`, {
    method: 'POST',
    body: formData
  });

  return parseJsonResponse(response, '上传视频失败');
}

// 删除视频。
export async function deleteVideo(id) {
  const response = await fetch(`${API_BASE_URL}/videos/${id}`, {
    method: 'DELETE'
  });

  return parseJsonResponse(response, '删除视频失败');
}
