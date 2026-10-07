const { request } = require('./request');

function getStoredToken() {
  return wx.getStorageSync('studentToken') || '';
}

function getStoredStudent() {
  return wx.getStorageSync('student') || null;
}

function setStoredStudent(student) {
  if (student) {
    wx.setStorageSync('student', student);
  }
}

function clearSession() {
  wx.removeStorageSync('studentToken');
  wx.removeStorageSync('student');
}

function requireLogin() {
  const student = getStoredStudent();
  const token = getStoredToken();

  if (!student || !token) {
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

  return {
    token: data.token || '',
    student: data.student || data.user || data
  };
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
  setStoredStudent,
  clearSession,
  requireLogin,
  login,
  logout,
  getMe
};
