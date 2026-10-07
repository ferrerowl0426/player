const { login } = require('../../services/auth');
const { ENABLE_DEV_PREVIEW } = require('../../utils/constants');

Page({
  data: {
    account: '',
    password: '',
    loading: false,
    error: '',
    enableDevPreview: ENABLE_DEV_PREVIEW
  },

  onAccountInput(event) {
    this.setData({ account: event.detail.value, error: '' });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: '' });
  },

  enterPreview() {
    const student = {
      id: 'dev-preview-student',
      account: '13776186160',
      nickname: '林小雨',
      username: '林小雨',
      className: '内部测试班',
      status: 'active',
      role: 'user'
    };

    getApp().setSession({ token: 'dev-preview-token', student });
    wx.switchTab({ url: '/pages/home/index' });
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
      this.setData({ error: error.userMessage || '账号或密码错误，请联系老师确认账号' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
