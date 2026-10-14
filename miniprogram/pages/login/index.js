const { login } = require('../../services/auth');

Page({
  data: {
    account: '13382800426',
    password: 'Nxh123456',
    loading: false,
    error: ''
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
      this.setData({ error: error.userMessage || '账号或密码错误，请联系老师确认账号' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
