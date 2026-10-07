const { requireLogin } = require('../../services/auth');
const { getKnowledgeDetail } = require('../../services/courses');
const { openLibraryFile } = require('../../services/files');

function formatPart(part = {}, activePartId = '') {
  const id = String(part.id || '');
  const no = part.partNo || part.part_no || part.no || '';
  const active = id === String(activePartId || '');
  return {
    ...part,
    id,
    no: no ? String(no).padStart(2, '0') : '01',
    duration: part.durationText || part.duration || '',
    active,
    statusText: active ? '播放中' : '播放'
  };
}

function normalizeFileType(file = {}) {
  const raw = String(file.fileType || file.type || file.mimeType || file.mime_type || '').toLowerCase();
  const title = String(file.title || file.name || file.fileName || file.file_name || '').toLowerCase();
  if (raw.includes('pdf') || title.endsWith('.pdf')) return 'PDF';
  if (raw.includes('mpeg') || raw.includes('mp3') || title.endsWith('.mp3')) return 'MP3';
  if (raw.includes('png') || title.endsWith('.png')) return 'PNG';
  if (raw.includes('jpeg') || raw.includes('jpg') || title.endsWith('.jpg') || title.endsWith('.jpeg')) return 'JPG';
  return raw ? raw.split('/').pop().toUpperCase() : 'FILE';
}

function buildFileItem(file = {}, index = 0, fileSource = 'library') {
  const type = normalizeFileType(file);
  return {
    ...file,
    id: file.id,
    no: String(index + 1).padStart(2, '0'),
    title: file.title || file.name || '未命名资料',
    fileType: type || 'FILE',
    meta: file.sizeText || file.meta || '资料',
    fileSource,
    canPlay: Boolean(file.canPlay || type === 'MP3'),
    action: type === 'MP3' ? 'play' : 'preview'
  };
}

function buildPrerequisite(item = {}) {
  const routeMap = {
    track_point: '/pages/track-detail/index',
    track_collection: '/pages/track-collection/index',
    knowledge_point: '/pages/knowledge-detail/index',
    knowledge_collection: '/pages/knowledge-collection/index'
  };
  const labelMap = {
    track_point: '曲目',
    track_collection: '曲目集',
    knowledge_point: '知识点',
    knowledge_collection: '知识点集'
  };
  return {
    ...item,
    typeLabel: item.typeLabel || labelMap[item.type] || '内容',
    duration: item.duration || '前置学习',
    url: item.url || `${routeMap[item.type] || ''}?id=${item.id}`
  };
}

function buildDetail(raw = {}, activePartId = '') {
  const partsSource = raw.parts || [];
  const defaultPartId = activePartId || partsSource[0]?.id || '';
  const parts = partsSource.map((part) => formatPart(part, defaultPartId));
  const currentPart = parts.find((part) => part.active) || parts[0] || {};

  return {
    ...raw,
    title: raw.title || '知识点详情',
    quality: raw.quality || '720P',
    progressText: raw.progressText || '',
    summary: raw.description || raw.summary || '',
    parts,
    currentPart,
    currentPartLabel: currentPart.id ? `当前 P${currentPart.no || currentPart.partNo || ''}` : '暂无 P 列表',
    prerequisites: (raw.prerequisites || []).map(buildPrerequisite),
    attachments: (raw.attachments || []).map((item, index) => buildFileItem(item, index, 'attachment')),
    libraryItems: (raw.libraryResources || raw.libraryItems || []).map((item, index) => buildFileItem(item, index, 'library'))
  };
}

Page({
  data: {
    id: '',
    part: '',
    loading: false,
    detail: buildDetail({})
  },

  onLoad(options) {
    this.setData({ id: options.id || '', part: options.part || '' });
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const detail = await getKnowledgeDetail(this.data.id);
      this.setData({ detail: buildDetail(detail, this.data.part) });
    } catch (error) {
      wx.showToast({ title: error.userMessage || '知识点详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/courses/index' }) });
  },

  selectPart(event) {
    const part = event.currentTarget.dataset.part;
    this.setData({ part, detail: buildDetail(this.data.detail, part) });
    wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },

  openPrerequisite(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  async handleFileAction(event) {
    const file = event.currentTarget.dataset.file;
    try {
      await openLibraryFile(file);
    } catch (error) {
      wx.showToast({ title: error.userMessage || '文件打开失败', icon: 'none' });
    }
  }
});
