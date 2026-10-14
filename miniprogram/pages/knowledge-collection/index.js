const { requireLogin } = require('../../services/auth');
const { getKnowledgeCollection } = require('../../services/courses');

function buildDetail(raw = {}) {
  const items = raw.items || raw.lessons || [];
  return {
    ...raw,
    typeLabel: '知识点集',
    title: raw.title || '知识点集详情',
    totalText: `收录 ${raw.contentCount || items.length || 0} 个知识点`,
    updatedText: raw.updateDateText || '',
    desc: raw.description || raw.desc || '',
    sectionTitle: '收录知识点',
    sectionDesc: '合集内展示知识点封面',
    emptyText: '如果知识点被删除或暂不可见，学生端只显示暂无可学习内容。',
    coverUrl: raw.coverUrl || raw.cover_url || raw.cover || '',
    lessons: items.map((item, index) => ({
      ...item,
      no: String(index + 1).padStart(2, '0'),
      title: item.title || '未命名知识点',
      coverUrl: item.coverUrl || item.cover_url || item.cover || '',
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
      const detail = await getKnowledgeCollection(this.data.id);
      this.setData({ detail: buildDetail(detail) });
    } catch (error) {
      wx.showToast({ title: error.userMessage || '知识点集加载失败', icon: 'none' });
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
    wx.navigateTo({ url: `/pages/knowledge-detail/index?id=${id}` });
  }
});
