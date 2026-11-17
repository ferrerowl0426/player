const { requireLogin } = require('../../services/auth');
const { getTodayHomework } = require('../../services/homework');
const { normalizeHomeworkGroup, isTargetUnavailable, toUnavailableAssignment } = require('../../utils/format');
const { navigateByAssignment } = require('../../utils/navigate');

Page({
  data: {
    loading: false,
    student: {},
    homework: normalizeHomeworkGroup(null)
  },

  // 请求版本 + 页面活跃标记：切 tab / onHide / onUnload 后的过期响应一律丢弃，防止旧状态回写。
  loadVersion: 0,
  active: false,

  onLoad() {
    this.active = true;
  },

  onShow() {
    this.active = true;
    const student = requireLogin();
    if (!student) return;
    this.setData({ student });
    // 每次回到前台/下拉都重查，恢复公开由下次查询自然完成，不把失效状态永久缓存。
    this.loadHomework();
  },

  onHide() {
    this.active = false;
    this.loadVersion += 1;
  },

  onUnload() {
    this.active = false;
    this.loadVersion += 1;
  },

  onPullDownRefresh() {
    this.loadHomework().finally(() => wx.stopPullDownRefresh());
  },

  async loadHomework() {
    const version = ++this.loadVersion;
    this.setData({ loading: true });
    try {
      const data = await getTodayHomework();
      if (!this.active || version !== this.loadVersion) return;
      this.setData({ homework: normalizeHomeworkGroup(data) });
    } catch (error) {
      if (!this.active || version !== this.loadVersion) return;
      this.setData({ homework: normalizeHomeworkGroup(null) });
      wx.showToast({ title: error.userMessage || '作业加载失败', icon: 'none' });
    } finally {
      if (this.active && version === this.loadVersion) {
        this.setData({ loading: false });
      }
    }
  },

  openAssignment(event) {
    const item = event.currentTarget.dataset.item;
    // 已知失效项不发起复核、不跳转、不 Toast。
    if (!item || isTargetUnavailable(item)) return;
    const version = this.loadVersion;
    const isCurrent = () => this.active && version === this.loadVersion;
    navigateByAssignment(item, {
      // 复核 await 完成后及 Toast/导航前由工具层据此丢弃过期响应，防隐藏/刷新后旧导航跳转。
      isCurrent,
      onUnavailable: (assignment) => {
        // 竞态失效：仅在当前页面与当前请求版本内原位更新灰框，静默、不 Toast、不跳走。
        if (!isCurrent()) return;
        this.markAssignmentUnavailable(assignment);
      }
    });
  },

  markAssignmentUnavailable(assignment) {
    if (!assignment || assignment.id == null) return;
    const assignments = (this.data.homework.assignments || []).map((item) => (
      String(item.id) === String(assignment.id) ? toUnavailableAssignment(item) : item
    ));
    this.setData({ homework: { ...this.data.homework, assignments } });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/index' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/courses/index' });
  }
});
