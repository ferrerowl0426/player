const { requireLogin } = require('../services/auth');
const { openLibraryFile } = require('../services/files');

function qualityLabel(quality = '') {
  const value = String(quality || 'source').toLowerCase();
  if (value === 'source' || value === 'original') return '原画';
  if (value === 'auto') return '自动';
  return value.toUpperCase();
}

function formatVideoTime(value = 0) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// 微信 video playbackRate 在真机上较稳定的档位。
const SPEEDS = [0.5, 0.8, 1, 1.25, 1.5, 2];
const SPEED_OPTIONS = SPEEDS.map((value) => ({
  value,
  label: `${Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`
}));

function normalizeRenditions(part = {}) {
  const list = Array.isArray(part.renditions) ? part.renditions : [];
  const readyList = list
    .map((item) => ({
      quality: String(item.quality || 'source').toLowerCase(),
      label: item.label || qualityLabel(item.quality),
      videoUrl: item.videoUrl || item.video_url || '',
      status: String(item.status || '').toLowerCase()
    }))
    .filter((item) => item.videoUrl && (!item.status || item.status === 'ready'));

  // buildDetail 会再次处理已经归一化的 detail（例如切换清晰度时）。
  // 这时 videoUrl 已经是当前档位，不能把它误当成另一份“原画”源。
  const isNormalizedPart = Object.prototype.hasOwnProperty.call(part, 'selectedQuality');
  if ((part.videoUrl || part.video_url)
    && !isNormalizedPart
    && !readyList.some((item) => item.quality === 'source')) {
    readyList.unshift({
      quality: 'source',
      label: '原画',
      videoUrl: part.videoUrl || part.video_url,
      status: 'ready'
    });
  }

  return readyList;
}

function pickDefaultQuality(renditions = []) {
  return renditions.find((item) => item.quality === '720p')?.quality
    || renditions.find((item) => item.quality === 'source')?.quality
    || renditions[0]?.quality
    || '';
}

function formatPart(part = {}, activePartId = '', activeQuality = '', index = 0, total = 0) {
  const id = String(part.id || '');
  const no = part.partNo || part.part_no || part.no || '';
  const active = id === String(activePartId || '');
  const renditions = normalizeRenditions(part);
  const selectedQuality = activeQuality && renditions.some((item) => item.quality === activeQuality)
    ? activeQuality
    : pickDefaultQuality(renditions);
  const selectedRendition = renditions.find((item) => item.quality === selectedQuality) || renditions[0] || null;

  return {
    ...part,
    id,
    no: no ? String(no).padStart(2, '0') : '01',
    duration: part.durationText || part.duration || '',
    active,
    statusText: active ? '播放中' : '播放',
    selectedQuality,
    videoUrl: selectedRendition?.videoUrl || part.videoUrl || part.video_url || '',
    renditions: renditions.map((item) => ({ ...item, active: item.quality === selectedQuality })),
    hasQualityOptions: renditions.length > 1,
    hasPrevious: index > 0,
    hasNext: index < total - 1
  };
}

function normalizeFileType(file = {}) {
  const raw = String(file.fileType || file.type || file.mimeType || file.mime_type || '').toLowerCase();
  const title = String(file.title || file.name || file.fileName || file.file_name || '').toLowerCase();
  if (raw.includes('pdf') || title.endsWith('.pdf')) return 'PDF';
  if (raw.includes('word') || raw.includes('document') || title.endsWith('.doc') || title.endsWith('.docx')) return 'DOC';
  if (raw.includes('presentation') || raw.includes('powerpoint') || title.endsWith('.ppt') || title.endsWith('.pptx')) return 'PPT';
  if (raw.includes('spreadsheet') || raw.includes('excel') || title.endsWith('.xls') || title.endsWith('.xlsx')) return 'XLS';
  if (raw.includes('mpeg') || raw.includes('mp3') || title.endsWith('.mp3')) return 'MP3';
  if (raw.includes('png') || title.endsWith('.png')) return 'PNG';
  if (raw.includes('jpeg') || raw.includes('jpg') || title.endsWith('.jpg') || title.endsWith('.jpeg')) return 'JPG';
  if (raw.includes('zip') || title.endsWith('.zip')) return 'ZIP';
  if (title.endsWith('.gpt')) return 'GPT';
  if (raw.includes('octet-stream')) return 'FILE';
  return raw ? raw.split('/').pop().toUpperCase() : 'FILE';
}

function getFileAction(type = '') {
  if (type === 'MP3') return 'play';
  if (['PDF', 'DOC', 'PPT', 'XLS', 'PNG', 'JPG'].includes(type)) return 'preview';
  return 'webOnly';
}

function buildFileItem(file = {}, index = 0, fileSource = 'library') {
  const type = normalizeFileType(file);
  const action = getFileAction(type);
  return {
    ...file,
    id: file.id,
    no: String(index + 1).padStart(2, '0'),
    title: file.title || file.name || '未命名资料',
    fileType: type || 'FILE',
    meta: file.sizeText || file.meta || '资料',
    fileSource,
    action,
    canPlay: action === 'play',
    canPreview: action === 'preview',
    canOperate: action === 'play' || action === 'preview'
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

function buildDetail(raw = {}, activePartId = '', activeQuality = '', defaultTitle = '课程详情') {
  const partsSource = Array.isArray(raw.parts) ? raw.parts : [];
  const defaultPartId = activePartId || partsSource[0]?.id || '';
  const parts = partsSource.map((part, index) => (
    formatPart(part, defaultPartId, activeQuality, index, partsSource.length)
  ));
  const currentPart = parts.find((part) => part.active) || parts[0] || {};

  return {
    ...raw,
    title: raw.title || defaultTitle,
    coverUrl: raw.coverUrl || raw.cover_url || raw.cover || '',
    summary: raw.description || raw.summary || '',
    parts,
    currentPart,
    currentPartLabel: currentPart.id ? `当前 P${currentPart.no || currentPart.partNo || ''}` : '暂无 P 列表',
    prerequisites: (raw.prerequisites || []).map(buildPrerequisite),
    attachments: (raw.attachments || []).map((item, index) => buildFileItem(item, index, 'attachment')),
    libraryItems: (raw.libraryResources || raw.libraryItems || []).map((item, index) => buildFileItem(item, index, 'library'))
  };
}

function createVideoDetailPage({ loadDetailRequest, defaultTitle = '课程详情', loadErrorMessage = '详情加载失败' }) {
  if (typeof loadDetailRequest !== 'function') throw new TypeError('loadDetailRequest 必须是函数');
  const formatDetail = (raw = {}, activePartId = '', activeQuality = '') => (
    buildDetail(raw, activePartId, activeQuality, defaultTitle)
  );

  return {
    data: {
      id: '',
      part: '',
      quality: '',
      qualityLabel: '原画',
      speed: 1,
      speedOptions: SPEED_OPTIONS,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      currentTimeText: '0:00',
      durationText: '0:00',
      loading: false,
      videoWaiting: false,
      videoErrorText: '',
      pendingQualityRollback: null,
      videoMedia: null,
      videoActive: false,
      detail: formatDetail({})
    },

    onLoad(options) {
      this._isUnloaded = false;
      this._isPageVisible = false;
      this.setData({ id: options.id || '', part: options.part || '' });
    },

    onShow() {
      if (!requireLogin()) return;
      this._isPageVisible = true;
      if (this._detailLoaded && this.data.detail.currentPart.videoUrl) {
        const shouldResume = Boolean(this._resumeOnShow);
        this._resumeOnShow = false;
        this.setData({ videoActive: true }, () => {
          if (shouldResume) this.getVideoPlayer()?.play();
        });
      }
      if (!this._detailLoaded && !this._detailLoading) this.loadDetail();
    },

    onHide() {
      this._resumeOnShow = Boolean(this.data.isPlaying);
      this._isPageVisible = false;
      this.pauseCurrentVideo();
    },

    onUnload() {
      this._isPageVisible = false;
      this._isUnloaded = true;
      this.pauseCurrentVideo();
    },

    buildVideoMedia(detail, position = 0, shouldPlay = true) {
      const part = detail?.currentPart || {};
      const quality = part.selectedQuality || this.data.quality || 'source';
      this._videoSourceToken = (this._videoSourceToken || 0) + 1;
      return {
        id: `${part.id || 'part'}:${quality}:${part.videoUrl || ''}`,
        sourceToken: this._videoSourceToken,
        src: part.videoUrl || '',
        position: Math.max(0, Number(position) || 0),
        play: Boolean(shouldPlay)
      };
    },

    async loadDetail() {
      if (!this.data.id || this._detailLoading) return;
      this._detailLoading = true;
      this.setData({ loading: true });
      try {
        const detail = await loadDetailRequest(this.data.id);
        if (this._isUnloaded) return;
        const viewDetail = formatDetail(detail, this.data.part, this.data.quality);
        this._detailLoaded = true;
        this.setData({
          detail: viewDetail,
          quality: viewDetail.currentPart.selectedQuality || '',
          qualityLabel: qualityLabel(viewDetail.currentPart.selectedQuality || 'source'),
          videoWaiting: false,
          videoErrorText: '',
          videoMedia: this.buildVideoMedia(viewDetail, 0, this._isPageVisible),
          videoActive: Boolean(this._isPageVisible && viewDetail.currentPart.videoUrl)
        }, () => {
          if (this._isPageVisible) this.playCurrentVideo();
        });
      } catch (error) {
        if (!this._isUnloaded) wx.showToast({ title: error.userMessage || loadErrorMessage, icon: 'none' });
      } finally {
        this._detailLoading = false;
        if (!this._isUnloaded) this.setData({ loading: false });
      }
    },

    goBack() {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/courses/index' }) });
    },

    getVideoPlayer() {
      return this.selectComponent('#courseVideoPlayer');
    },

    isCurrentVideoEvent(event) {
      const sourceId = event?.detail?.sourceId;
      const sourceToken = event?.detail?.sourceToken;
      return Boolean(sourceId && sourceToken)
        && String(sourceId) === String(this.data.videoMedia?.id || '')
        && String(sourceToken) === String(this._videoSourceToken || '');
    },

    playCurrentVideo() {
      if (!this._isPageVisible || !this.data.detail.currentPart.videoUrl) return;
      this.setData({ videoActive: true });
      wx.nextTick(() => {
        if (!this._isPageVisible || this._isUnloaded) return;
        this.getVideoPlayer()?.play();
      });
    },

    pauseCurrentVideo() {
      if (!this._isUnloaded) this.setData({ videoActive: false });
      this.getVideoPlayer()?.pause();
      if (!this._isUnloaded) this.setData({ isPlaying: false });
    },

    selectPartById(part, shouldScroll = true) {
      if (!part) return;
      const detail = formatDetail(this.data.detail, part, '');
      const quality = detail.currentPart.selectedQuality || '';
      const shouldPlay = Boolean(this._isPageVisible && detail.currentPart.videoUrl);
      this.setData({
        part,
        quality,
        qualityLabel: qualityLabel(quality || 'source'),
        currentTime: 0,
        duration: 0,
        currentTimeText: '0:00',
        videoWaiting: false,
        videoErrorText: '',
        pendingQualityRollback: null,
        videoMedia: this.buildVideoMedia(detail, 0, shouldPlay),
        videoActive: shouldPlay,
        detail
      }, () => this.playCurrentVideo());
      if (shouldScroll) wx.pageScrollTo({ scrollTop: 0, duration: 180 });
    },

    selectPart(event) {
      this.selectPartById(event.currentTarget.dataset.part);
    },

    switchPartByStep(step) {
      const parts = this.data.detail.parts || [];
      const currentIndex = parts.findIndex((item) => item.id === this.data.detail.currentPart.id);
      const next = parts[currentIndex + Number(step || 0)];
      if (!next) {
        wx.showToast({
          title: Number(step) < 0 ? '已经是第一P' : '已经是最后一P',
          icon: 'none'
        });
        return;
      }
      this.selectPartById(next.id, false);
    },

    handlePrevious(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.switchPartByStep(-1);
    },

    handleNext(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.switchPartByStep(1);
    },

    selectQualityByValue(nextQuality, position = this.data.currentTime, shouldPlay = this.data.isPlaying) {
      const quality = String(nextQuality || '');
      if (!quality || quality === this.data.quality) return;
      const currentTime = Math.max(0, Number(position) || 0);
      const detail = formatDetail(this.data.detail, this.data.part, quality);
      if (!detail.currentPart.videoUrl) {
        wx.showToast({ title: '当前清晰度暂无视频', icon: 'none' });
        return;
      }
      this.setData({
        quality,
        qualityLabel: qualityLabel(quality),
        videoWaiting: true,
        videoErrorText: '',
        pendingQualityRollback: {
          quality: this.data.quality,
          currentTime,
          detail: this.data.detail,
          shouldPlay: Boolean(shouldPlay)
        },
        videoMedia: this.buildVideoMedia(detail, currentTime, shouldPlay),
        videoActive: true,
        detail
      });
    },

    handleQualityChange(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.selectQualityByValue(event.detail?.quality, event.detail?.currentTime, event.detail?.playing);
    },

    handleSpeedChange(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      const speed = Number(event.detail?.speed);
      if (!SPEEDS.includes(speed)) return;
      this.setData({ speed }, () => this.getVideoPlayer()?.applyPlaybackRate(speed));
    },

    handleVideoPlay(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.setData({ isPlaying: true, videoWaiting: false, videoErrorText: '', pendingQualityRollback: null });
    },

    handleVideoPause(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.setData({ isPlaying: false });
    },

    handleVideoSourceConfirmed(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      // metadata 已证明新地址可读，先解除加载态；保留回滚快照，
      // 直到首次播放/进度事件后再提交，覆盖暂停切换后随后发生的错误。
      this.setData({ videoWaiting: false });
    },

    handleVideoTimeUpdate(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      const currentTime = Number(event.detail?.currentTime || 0);
      const duration = Number(event.detail?.duration || this.data.duration || 0);
      this.setData({
        currentTime,
        duration,
        currentTimeText: formatVideoTime(currentTime),
        videoWaiting: false,
        pendingQualityRollback: null
      });
    },

    handleVideoWaiting(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      this.setData({ videoWaiting: true });
    },

    handleVideoError(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      const rollback = this.data.pendingQualityRollback;
      if (rollback?.quality && rollback.quality !== this.data.quality) {
        wx.showToast({ title: '清晰度切换失败，已恢复原画面', icon: 'none' });
        this.setData({
          quality: rollback.quality,
          qualityLabel: qualityLabel(rollback.quality),
          detail: rollback.detail,
          currentTime: rollback.currentTime || 0,
          videoWaiting: false,
          videoErrorText: '',
          pendingQualityRollback: null,
          videoMedia: this.buildVideoMedia(
            rollback.detail,
            rollback.currentTime,
            rollback.shouldPlay && this._isPageVisible
          ),
          videoActive: Boolean(this._isPageVisible)
        });
        return;
      }
      this.setData({ isPlaying: false, videoWaiting: false, videoErrorText: '视频加载失败，请稍后重试' });
    },

    handleVideoEnded(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      const next = this.data.detail.parts?.find((item, index) => (
        index > this.data.detail.parts.findIndex((part) => part.id === this.data.detail.currentPart.id)
      ));
      if (next) {
        this.selectPartById(next.id, false);
        return;
      }
      this.setData({
        isPlaying: false,
        currentTime: this.data.duration,
        currentTimeText: formatVideoTime(this.data.duration)
      });
    },

    handleVideoRetry(event) {
      if (!this.isCurrentVideoEvent(event)) return;
      if (!this.data.detail.currentPart.videoUrl) return;
      this.setData({
        videoMedia: {
          ...this.buildVideoMedia(this.data.detail, this.data.currentTime, true),
          id: `${this.data.detail.currentPart.id}:${Date.now()}`
        },
        videoActive: true,
        videoErrorText: ''
      });
    },

    openPrerequisite(event) {
      const url = event.currentTarget.dataset.url;
      if (url) wx.navigateTo({ url });
    },

    noop() {},

    async handleFileAction(event) {
      const file = event.currentTarget.dataset.file;
      if (!file?.canOperate) {
        wx.showToast({ title: '请前往web端用电脑下载', icon: 'none' });
        return;
      }
      try {
        await openLibraryFile({
          ...file,
          sourceTitle: this.data.detail.title,
          coverUrl: this.data.detail.coverUrl || this.data.detail.currentPart.coverUrl || ''
        });
      } catch (error) {
        wx.showToast({ title: error.userMessage || '文件打开失败', icon: 'none' });
      }
    }
  };
}

module.exports = { createVideoDetailPage };
