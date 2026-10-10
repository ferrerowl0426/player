const { request } = require('./request');

const TOKEN_KEY = 'studentToken';
const STUDENT_KEY = 'student';
const TOKEN_EXPIRES_AT_KEY = 'studentTokenExpiresAt';
const SESSION_CACHE_KEYS = [
  TOKEN_KEY,
  STUDENT_KEY,
  TOKEN_EXPIRES_AT_KEY,
  'homeworkTodayCache',
  'homeworkHistoryCache',
  'coursesCache',
  'libraryCache',
  'studentMeCache'
];
const SESSION_TTL_MS = 15 * 24 * 60 * 60 * 1000;

function getSessionExpiresAt() {
  return Number(wx.getStorageSync(TOKEN_EXPIRES_AT_KEY) || 0);
}

function isSessionExpired() {
  const expiresAt = getSessionExpiresAt();
  return Boolean(expiresAt && Date.now() >= expiresAt);
}

function clearSession() {
  SESSION_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
}

function getStoredToken() {
  if (isSessionExpired()) {
    clearSession();
    return '';
  }
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function getStoredStudent() {
  if (isSessionExpired()) {
    clearSession();
    return null;
  }
  return wx.getStorageSync(STUDENT_KEY) || null;
}

function setStoredStudent(student) {
  if (student) {
    wx.setStorageSync(STUDENT_KEY, student);
  }
}

function setStoredSession({ token, student, expiresAt }) {
  clearSession();
  if (token) wx.setStorageSync(TOKEN_KEY, token);
  if (student) wx.setStorageSync(STUDENT_KEY, student);
  wx.setStorageSync(TOKEN_EXPIRES_AT_KEY, Number(expiresAt || Date.now() + SESSION_TTL_MS));
}

function requireLogin() {
  const student = getStoredStudent();
  const token = getStoredToken();

  if (!student || !token) {
    clearSession();
    wx.reLaunch({ url: '/pages/login/index' });
    return null;
  }

  return student;
}

async function login({ account, password }) {
  const data = await request({
    url: '/login',
    method: 'POST',
    data: { account, password }
  });

  const token = data.token || '';
  const student = data.student || data.user || data;
  const expiresAt = Number(data.expiresAt || data.expires_at || 0) || Date.now() + SESSION_TTL_MS;
  setStoredSession({ token, student, expiresAt });

  return { token, student, expiresAt };
}

async function logout() {
  return request({ url: '/logout', method: 'POST' });
}

async function getMe() {
  return request({ url: '/me' });
}

module.exports = {
  getStoredToken,
  getStoredStudent,
  getSessionExpiresAt,
  isSessionExpired,
  setStoredStudent,
  setStoredSession,
  clearSession,
  requireLogin,
  login,
  logout,
  getMe
};
