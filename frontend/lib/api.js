const BROWSER_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
const SERVER_API_BASE_URL = process.env.SERVER_API_BASE_URL || BROWSER_API_BASE_URL;

function getApiBaseUrl() {
  return typeof window === 'undefined' ? SERVER_API_BASE_URL : BROWSER_API_BASE_URL;
}

async function parseJsonResponse(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || fallbackMessage);
  }

  return result;
}

// 获取视频列表。
export async function fetchVideos() {
  const response = await fetch(`${getApiBaseUrl()}/videos`, {
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

// 上传视频。
// 这里不手动设置 Content-Type，浏览器会自动帮我们生成 multipart/form-data 的边界。
export async function uploadVideo(formData) {
  const response = await fetch(`${getApiBaseUrl()}/videos`, {
    method: 'POST',
    body: formData
  });

  return parseJsonResponse(response, '上传视频失败');
}

// 删除视频。
export async function deleteVideo(id) {
  const response = await fetch(`${getApiBaseUrl()}/videos/${id}`, {
    method: 'DELETE'
  });

  return parseJsonResponse(response, '删除视频失败');
}
