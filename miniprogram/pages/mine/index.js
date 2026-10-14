const { requireLogin, logout } = require('../../services/auth');

Page({
  data: {
    student: {},
    avatarText: '学'
  },

  onShow() {
    const student = requireLogin();
    if (!student) return;
    const name = student.nickname || student.username || student.account || '学';
    this.setData({ student, avatarText: String(name).slice(0, 1) });
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
