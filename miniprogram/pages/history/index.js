const { requireLogin } = require('../../services/auth');
const { getHomeworkHistory } = require('../../services/homework');
const { normalizeHomeworkHistory } = require('../../utils/format');

Page({
  data: {
    keyword: '',
    loading: false,
    allItems: [],
    items: []
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadHistory();
  },

  onPullDownRefresh() {
    this.loadHistory().finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword, items: this.filterItems(this.data.allItems, keyword) });
  },

  async loadHistory() {
    this.setData({ loading: true });
    try {
      const data = await getHomeworkHistory({ page: 1, pageSize: 20 });
      const allItems = normalizeHomeworkHistory(data);
      this.setData({ allItems, items: this.filterItems(allItems, this.data.keyword) });
    } catch (error) {
      this.setData({ allItems: [], items: [] });
      wx.showToast({ title: error.userMessage || '历史作业加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  filterItems(items, keyword) {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const assignmentText = (item.assignments || []).map((a) => `${a.title || ''} ${a.typeLabel || ''}`).join(' ');
      const haystack = [
        item.teacherName,
        item.title,
        item.practiceRequirement,
        item.submitRequirement,
        assignmentText
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 240 });
  }
});
