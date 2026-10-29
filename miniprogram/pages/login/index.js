const { login, getStoredToken, getStoredStudent, isSessionExpired } = require('../../services/auth');

Page({
  data: {
    account: '',
    password: '',
    loading: false,
    error: ''
  },

  _redirecting: false,

  onShow() {
    if (this._redirecting || isSessionExpired()) return;
    if (getStoredToken() && getStoredStudent()) {
      this._redirecting = true;
      wx.switchTab({
        url: '/pages/home/index',
        fail: () => {
          this._redirecting = false;
        }
      });
    }
  },

  onAccountInput(event) {
    this.setData({ account: event.detail.value, error: '' });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },


  async onLogin() {
    const account = String(this.data.account || '').trim();
    const password = String(this.data.password || '');

    if (!account || !password) {
      this.setData({ error: '请填写学生账号和密码' });
      return;
    }

    this.setData({ loading: true, error: '' });

    try {
      const result = await login({ account, password });
      getApp().setSession(result);
      wx.switchTab({ url: '/pages/home/index' });
    } catch (error) {
      const message = String(error.userMessage || error.message || '');
      const role = String(error.role || error.userType || error.accountType || '').toLowerCase();
      const isNonStudent = Boolean(
        error.isStudent === false
        || ['teacher', 'director', 'admin', 'manager', 'staff', '老师', '教导主任', '管理员'].some((item) => role.includes(item))
        || /没有这个学生|不是学生|非学生|学生账号不存在/.test(message)
      );
      this.setData({
        error: isNonStudent
          ? '此账号不是学生账号，请使用学生账号登录'
          : (message || '账号或密码错误，请联系老师确认账号')
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
