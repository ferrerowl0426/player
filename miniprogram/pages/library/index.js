const { requireLogin } = require('../../services/auth');
const { getLibrary } = require('../../services/library');
const { openLibraryFile } = require('../../services/files');
const { normalizeLibraryItems } = require('../../utils/format');

Page({
  data: {
    keyword: '',
    loading: false,
    items: []
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadLibrary();
  },

  onPullDownRefresh() {
    this.loadLibrary().finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    this.loadLibrary();
  },

  async loadLibrary() {
    this.setData({ loading: true });
    try {
      const data = await getLibrary({ keyword: this.data.keyword });
      this.setData({ items: this.filterPdfItems(normalizeLibraryItems(data)) });
    } catch (error) {
      this.setData({ items: [] });
      const message = error.statusCode === 404
        ? '服务器暂未部署图书馆接口'
        : error.userMessage || '资料加载失败';
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  filterPdfItems(items) {
    const q = String(this.data.keyword || '').trim().toLowerCase();
    return items
      .filter((item) => item.fileType === 'PDF')
      .filter((item) => !q || String(item.title || '').toLowerCase().includes(q));
  },

  findItem(id) {
    return this.data.items.find((item) => String(item.id) === String(id));
  },

  async previewPdf(event) {
    const item = this.findItem(event.currentTarget.dataset.id);
    if (!item) return;

    wx.showLoading({ title: '打开中' });
    try {
      await openLibraryFile({ ...item, fileSource: 'library' });
    } catch (error) {
      wx.showToast({ title: error.userMessage || 'PDF 预览失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 240 });
  }
});
