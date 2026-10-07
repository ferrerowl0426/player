const { requireLogin } = require('../../services/auth');
const { getLibraryDetail } = require('../../services/library');
const { openLibraryFile } = require('../../services/files');

function buildPreviewDetail(options = {}) {
  const title = options.title ? decodeURIComponent(options.title) : '卡农 P2 段落衔接练习谱';
  return {
    id: options.id || 'pdf-preview',
    title,
    fileType: 'PDF',
    meta: 'PDF 预览 · 短时有效',
    pageText: '1/6',
    previewMode: true
  };
}

Page({
  data: {
    id: '',
    preview: '',
    detail: {}
  },

  onLoad(options) {
    const preview = options.preview || '';
    this.setData({
      id: options.id || '',
      preview,
      detail: preview === 'pdf' ? buildPreviewDetail(options) : {}
    });
  },

  onShow() {
    if (!requireLogin()) return;
    if (this.data.preview === 'pdf') return;
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) return;
    try {
      const detail = await getLibraryDetail(this.data.id);
      this.setData({ detail });
    } catch (error) {
      wx.showToast({ title: error.userMessage || '资料加载失败', icon: 'none' });
    }
  },

  async openFile() {
    if (this.data.preview === 'pdf') return;
    try {
      await openLibraryFile(this.data.detail);
    } catch (error) {
      wx.showToast({ title: error.userMessage || '暂不支持在线预览', icon: 'none' });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
