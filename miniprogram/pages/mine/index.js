const { requireLogin, logout, changePassword, clearSession } = require('../../services/auth');
const emptyPasswordForm = () => ({ showPasswordForm: false, oldPassword: '', newPassword: '', showOld: false, showNew: false, passwordBusy: false, passwordSuccess: false, passwordError: '', oldFocus: false });

Page({
  data: {
    student: {},
    avatarText: '学',
    ...emptyPasswordForm()
  },

  onShow() {
    this._pageHidden = false;
    const student = requireLogin();
    if (!student) return;
    const name = student.nickname || student.username || student.account || '学';
    this.setData({ student, avatarText: String(name).slice(0, 1) });
  },

  openPasswordForm() {
    if (this.data.student.status === 'disabled' || this.data.passwordBusy || this.data.passwordSuccess) return;
    this.setData({ ...emptyPasswordForm(), showPasswordForm: true, oldFocus: true });
  },

  closePasswordForm() {
    if (this.data.passwordBusy || this.data.passwordSuccess) return;
    this.setData(emptyPasswordForm());
  },

  stopPropagation() {},
  inputOldPassword(event) { this.setData({ oldPassword: event.detail.value, oldFocus: false }); },
  inputNewPassword(event) { this.setData({ newPassword: event.detail.value }); },
  toggleOldPassword() { this.setData({ showOld: !this.data.showOld }); },
  toggleNewPassword() { this.setData({ showNew: !this.data.showNew }); },

  async submitPassword() {
    if (this._passwordPending || this.data.passwordBusy || this.data.passwordSuccess) return;
    const { oldPassword, newPassword } = this.data;
    if (!oldPassword) return this.setData({ passwordError: '请输入原密码', oldFocus: true });
    if (newPassword.length < 5 || newPassword.length > 30) return this.setData({ passwordError: '新密码长度需为5—30个字符' });
    if (oldPassword === newPassword) return this.setData({ passwordError: '新密码不能与原密码相同' });
    this._passwordPending = true;
    this.setData({ passwordBusy: true, passwordError: '' });
    try {
      await changePassword({ oldPassword, newPassword });
      // 页面隐藏/卸载也必须清会话，避免成功后切换页面保留无效Token。
      this._passwordChanged = true;
      if (this._pageHidden) return this.finishPasswordChange();
      this.setData({ oldPassword: '', newPassword: '', showOld: false, showNew: false, passwordBusy: false, passwordSuccess: true });
      this._passwordTimer = setTimeout(() => this.finishPasswordChange(), 1000);
    } catch (error) {
      if (this._pageHidden) return;
      if (error.statusCode === 401) {
        clearSession();
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this.setData({ passwordBusy: false, passwordError: error.code === 'OLD_PASSWORD_INCORRECT' ? '原密码不正确，请重新输入' : (!error.statusCode ? '操作结果未确认，请尝试重新登录或重试' : error.userMessage || error.message || '修改失败，请稍后重试'), ...(error.code === 'OLD_PASSWORD_INCORRECT' ? { oldPassword: '', oldFocus: true } : {}) });
    } finally {
      this._passwordPending = false;
    }
  },

  finishPasswordChange() {
    if (this._passwordTimer) clearTimeout(this._passwordTimer);
    this._passwordTimer = null;
    this._passwordChanged = false;
    clearSession();
    wx.reLaunch({ url: '/pages/login/index' });
  },

  onHide() {
    this._pageHidden = true;
    if (this._passwordChanged) this.finishPasswordChange();
    if (this._passwordTimer) clearTimeout(this._passwordTimer);
    this.setData(emptyPasswordForm());
  },

  onUnload() {
    this._pageHidden = true;
    if (this._passwordChanged) this.finishPasswordChange();
    if (this._passwordTimer) clearTimeout(this._passwordTimer);
  },

  confirmLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前学生账号吗？',
      confirmText: '退出',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await logout();
        } finally {
          getApp().clearSession();
          wx.reLaunch({ url: '/pages/login/index' });
        }
      }
    });
  }
});
