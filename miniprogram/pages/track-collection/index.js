const { requireLogin } = require('../../services/auth');
const { getTrackCollection } = require('../../services/courses');

function buildDetail(raw = {}) {
  const items = raw.items || raw.lessons || [];
  return {
    ...raw,
    typeLabel: '曲目集',
    title: raw.title || '曲目集详情',
    totalText: `收录 ${raw.contentCount || items.length || 0} 首`,
    updatedText: raw.updateDateText || '',
    desc: raw.description || raw.desc || '',
    sectionTitle: '收录单课',
    sectionDesc: '合集内展示单课封面',
    emptyText: '如果合集内单课被删除或暂不可见，学生端只显示暂无可学习内容。',
    lessons: items.map((item, index) => ({
      ...item,
      no: String(index + 1).padStart(2, '0'),
      title: item.title || '未命名单课',
      meta: item.meta || item.updateDateText || '点击进入详情'
    }))
  };
}

Page({
  data: {
    id: '',
    loading: false,
    detail: buildDetail({})
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const detail = await getTrackCollection(this.data.id);
      this.setData({ detail: buildDetail(detail) });
    } catch (error) {
      wx.showToast({ title: error.userMessage || '合集加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/courses/index' }) });
  },

  openLesson(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/track-detail/index?id=${id}` });
  }
});
