const { getStoredToken, setStoredStudent, clearSession } = require('./services/auth');

App({
  globalData: {
    student: null,
    token: '',
    apiBaseUrl: 'https://api.nxhguitar.com/api/miniprogram'
  },

  onLaunch() {
    this.globalData.token = getStoredToken();
    const student = wx.getStorageSync('student');
    this.globalData.student = student || null;
  },

  setSession({ token, student }) {
    this.globalData.token = token || '';
    this.globalData.student = student || null;
    setStoredStudent(student);
    if (token) {
      wx.setStorageSync('studentToken', token);
    }
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.student = null;
    clearSession();
  }
});
