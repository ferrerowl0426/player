const { requireLogin } = require('../../services/auth');
const { getTodayHomework } = require('../../services/homework');
const { normalizeHomeworkGroup } = require('../../utils/format');
const { navigateByAssignment } = require('../../utils/navigate');

Page({
  data: {
    loading: false,
    student: {},
    homework: normalizeHomeworkGroup(null)
  },

  onShow() {
    const student = requireLogin();
    if (!student) return;
    this.setData({ student });
    this.loadHomework();
  },

  onPullDownRefresh() {
    this.loadHomework().finally(() => wx.stopPullDownRefresh());
  },

  async loadHomework() {
    this.setData({ loading: true });
    try {
      const data = await getTodayHomework();
      this.setData({ homework: normalizeHomeworkGroup(data) });
    } catch (error) {
      this.setData({ homework: normalizeHomeworkGroup(null) });
      wx.showToast({ title: error.userMessage || '作业加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openAssignment(event) {
    navigateByAssignment(event.currentTarget.dataset.item);
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/index' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/courses/index' });
  }
});
