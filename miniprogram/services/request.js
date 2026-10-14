const { API_BASE_URL } = require('../utils/constants');

function getBaseUrl() {
  const app = getApp({ allowDefault: true });
  return app?.globalData?.apiBaseUrl || API_BASE_URL;
}

function normalizeError(statusCode, body) {
  const message = body?.error?.message || body?.message || body?.error || '请求失败，请稍后重试';
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = message;
  return error;
}

function clearLocalSession() {
  [
    'studentToken',
    'student',
    'studentTokenExpiresAt',
    'homeworkTodayCache',
    'homeworkHistoryCache',
    'coursesCache',
    'libraryCache',
    'studentMeCache'
  ].forEach((key) => wx.removeStorageSync(key));
}

function getValidToken() {
  const expiresAt = Number(wx.getStorageSync('studentTokenExpiresAt') || 0);
  if (expiresAt && Date.now() >= expiresAt) {
    clearLocalSession();
    return '';
  }
  return wx.getStorageSync('studentToken') || '';
}

function request({ url, method = 'GET', data, header = {} }) {
  const token = getValidToken();
  const finalHeader = {
    'content-type': 'application/json',
    ...header
  };

  if (token) {
    finalHeader.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${url}`,
      method,
      data,
      header: finalHeader,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data ?? res.data);
          return;
        }

        if (res.statusCode === 401) {
          clearLocalSession();
        }

        console.warn('[mini-request]', method, `${getBaseUrl()}${url}`, res.statusCode, res.data);
        reject(normalizeError(res.statusCode, res.data));
      },
      fail(err) {
        console.warn('[mini-request]', method, `${getBaseUrl()}${url}`, 'NETWORK_ERROR', err);
        const error = new Error('网络连接失败，请稍后重试');
        error.userMessage = '网络连接失败，请稍后重试';
        reject(error);
      }
    });
  });
}

module.exports = {
  request
};
