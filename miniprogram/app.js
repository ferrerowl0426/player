const { getStoredToken, getStoredStudent, setStoredSession, clearSession } = require('./services/auth');

App({
  globalData: {
    student: null,
    token: '',
    apiBaseUrl: 'https://api.nxhguitar.com/api/miniprogram'
  },

  onLaunch() {
    this.globalData.token = getStoredToken();
    this.globalData.student = getStoredStudent();
  },

  setSession({ token, student, expiresAt }) {
    this.globalData.token = token || '';
    this.globalData.student = student || null;
    if (token && student) {
      setStoredSession({ token, student, expiresAt });
    }
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.student = null;
    clearSession();
  }
});
