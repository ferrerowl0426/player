const { requireLogin } = require('../../services/auth');
const { getKnowledgeDetail } = require('../../services/courses');
const { openLibraryFile } = require('../../services/files');

function qualityLabel(quality = '') {
  const value = String(quality || 'source').toLowerCase();
  if (value === 'source') return '原画';
  return value.toUpperCase();
}

function formatVideoTime(value = 0) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function clampPercent(value = 0) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function normalizeRenditions(part = {}) {
  const list = Array.isArray(part.renditions) ? part.renditions : [];
  const readyList = list
    .map((item) => ({
      quality: String(item.quality || 'source').toLowerCase(),
      label: item.label || qualityLabel(item.quality),
      videoUrl: item.videoUrl || item.video_url || '',
      status: item.status || ''
    }))
    .filter((item) => item.videoUrl && (!item.status || item.status === 'ready'));

  if ((part.videoUrl || part.video_url) && !readyList.some((item) => item.quality === 'source')) {
    readyList.unshift({ quality: 'source', label: '原画', videoUrl: part.videoUrl || part.video_url, status: 'ready' });
  }

  return readyList;
}

function pickDefaultQuality(renditions = []) {
  return renditions.find((item) => item.quality === '720p')?.quality
    || renditions.find((item) => item.quality === 'source')?.quality
    || renditions[0]?.quality
    || '';
}

function formatPart(part = {}, activePartId = '', activeQuality = '') {
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
    hasQualityOptions: renditions.length > 0
  };
}

function normalizeFileType(file = {}) {
  const raw = String(file.fileType || file.type || file.mimeType || file.mime_type || '').toLowerCase();
  const title = String(file.title || file.name || file.fileName || file.file_name || '').toLowerCase();
  if (raw.includes('pdf') || title.endsWith('.pdf')) return 'PDF';
  if (raw.includes('mpeg') || raw.includes('mp3') || title.endsWith('.mp3')) return 'MP3';
  if (raw.includes('png') || title.endsWith('.png')) return 'PNG';
  if (raw.includes('jpeg') || raw.includes('jpg') || title.endsWith('.jpg') || title.endsWith('.jpeg')) return 'JPG';
  if (raw.includes('octet-stream')) return 'FILE';
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

function buildDetail(raw = {}, activePartId = '', activeQuality = '') {
  const partsSource = raw.parts || [];
  const defaultPartId = activePartId || partsSource[0]?.id || '';
  const parts = partsSource.map((part) => formatPart(part, defaultPartId, activeQuality));
  const currentPart = parts.find((part) => part.active) || parts[0] || {};

  return {
    ...raw,
    title: raw.title || '知识点详情',
    coverUrl: raw.coverUrl || raw.cover_url || raw.cover || '',
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
    quality: '',
    qualityLabel: '原画',
    speed: 1,
    speedLabel: '1.0x',
    videoDirection: 0,
    videoObjectFit: 'contain',
    isPlaying: false,
    isFullscreen: false,
    fullscreenDirection: 'none',
    isPortraitFullscreen: false,
    isPortraitVideo: false,
    controlsVisible: true,
    isSeeking: false,
    currentTime: 0,
    duration: 0,
    currentTimeText: '0:00',
    durationText: '0:00',
    seekTimeText: '0:00',
    progressPercent: 0,
    progressDotPercent: 2,
    loading: false,
    videoWaiting: false,
    videoErrorText: '',
    pendingQualityRollback: null,
    detail: buildDetail({})
  },

  onLoad(options) {
    this.setData({ id: options.id || '', part: options.part || '' });
  },

  onShow() {
    if (!requireLogin()) return;
    this.loadDetail();
  },

  onHide() {
    this.pauseCurrentVideo();
  },

  onUnload() {
    this.pauseCurrentVideo();
    if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer);
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const detail = await getKnowledgeDetail(this.data.id);
      const viewDetail = buildDetail(detail, this.data.part, this.data.quality);
      this.setData({
        detail: viewDetail,
        quality: viewDetail.currentPart.selectedQuality || '',
        qualityLabel: qualityLabel(viewDetail.currentPart.selectedQuality || 'source'),
        videoWaiting: false,
        videoErrorText: '',
        pendingQualityRollback: null
      }, () => this.playCurrentVideo());
    } catch (error) {
      wx.showToast({ title: error.userMessage || '知识点详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/courses/index' }) });
  },

  getVideoContext() {
    return wx.createVideoContext('lessonVideo', this);
  },

  showVideoControls() {
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    this.setData({ controlsVisible: true });
    if (this.data.isPlaying) {
      this.controlsTimer = setTimeout(() => {
        this.setData({ controlsVisible: false });
      }, this.data.isFullscreen ? 2600 : 2000);
    }
  },

  playCurrentVideo() {
    if (!this.data.detail.currentPart.videoUrl) return;
    wx.nextTick(() => {
      const video = this.getVideoContext();
      video.play();
      video.playbackRate(this.data.speed);
    });
  },

  pauseCurrentVideo() {
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    if (!this.data.detail.currentPart.videoUrl) return;
    this.getVideoContext().pause();
    this.setData({ isPlaying: false, controlsVisible: true });
  },

  selectPartById(part, shouldScroll = true) {
    if (!part) return;
    const detail = buildDetail(this.data.detail, part, '');
    const quality = detail.currentPart.selectedQuality || '';
    this.setData({
      part,
      quality,
      qualityLabel: qualityLabel(quality || 'source'),
      videoDirection: 0,
      videoObjectFit: 'contain',
      isPortraitFullscreen: false,
      currentTime: 0,
      duration: 0,
      currentTimeText: '0:00',
      durationText: '0:00',
      seekTimeText: '0:00',
      progressPercent: 0,
      progressDotPercent: 2,
      videoWaiting: false,
      videoErrorText: '',
      pendingQualityRollback: null,
      detail
    }, () => this.playCurrentVideo());
    if (shouldScroll && !this.data.isFullscreen) wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },

  selectPart(event) {
    this.selectPartById(event.currentTarget.dataset.part);
  },

  switchPartByStep(event) {
    const step = Number(event.currentTarget.dataset.step || 0);
    const parts = this.data.detail.parts || [];
    const currentIndex = parts.findIndex((item) => item.id === this.data.detail.currentPart.id);
    const next = parts[currentIndex + step];
    if (!next) {
      wx.showToast({ title: step < 0 ? '已经是第一P' : '已经是最后一P', icon: 'none' });
      return;
    }
    this.selectPartById(next.id, false);
  },

  selectQualityByValue(nextQuality) {
    const quality = String(nextQuality || '');
    if (!quality || quality === this.data.quality) return;
    const currentTime = this.data.currentTime;
    const rollback = {
      quality: this.data.quality,
      currentTime,
      detail: this.data.detail
    };
    const detail = buildDetail(this.data.detail, this.data.part, quality);
    if (!detail.currentPart.videoUrl) {
      wx.showToast({ title: '当前清晰度暂无视频', icon: 'none' });
      return;
    }
    this.setData({
      quality,
      qualityLabel: qualityLabel(quality),
      videoDirection: 0,
      videoObjectFit: 'contain',
      videoWaiting: true,
      videoErrorText: '',
      pendingQualityRollback: rollback,
      detail
    }, () => {
      wx.nextTick(() => {
        const video = this.getVideoContext();
        if (currentTime > 0) video.seek(currentTime);
        video.play();
        video.playbackRate(this.data.speed);
      });
    });
  },

  selectQuality(event) {
    this.selectQualityByValue(event.currentTarget.dataset.quality);
  },

  cycleQuality() {
    const renditions = this.data.detail.currentPart.renditions || [];
    if (!renditions.length) return;
    const index = renditions.findIndex((item) => item.quality === this.data.quality);
    const next = renditions[(index + 1) % renditions.length];
    this.selectQualityByValue(next.quality);
  },

  cycleSpeed() {
    const currentIndex = SPEEDS.findIndex((item) => item === this.data.speed);
    const speed = SPEEDS[(currentIndex + 1) % SPEEDS.length];
    const speedLabel = `${speed.toFixed(2).replace(/0$/, '')}x`;
    this.setData({ speed, speedLabel }, () => this.getVideoContext().playbackRate(speed));
  },

  togglePlay() {
    const video = this.getVideoContext();
    if (this.data.isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  },

  toggleFullscreen() {
    if (this.data.isFullscreen) {
      this.exitFullscreenWithFallback();
      return;
    }
    this.getVideoContext().requestFullScreen({ direction: this.data.videoDirection });
  },

  exitFullscreenWithFallback() {
    if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer);
    this.getVideoContext().exitFullScreen();
    this.fullscreenExitTimer = setTimeout(() => {
      if (!this.data.isFullscreen) return;
      this.setData({
        isFullscreen: false,
        fullscreenDirection: 'none',
        isPortraitFullscreen: false,
        controlsVisible: true
      });
    }, 500);
  },

  updateVideoProgress(currentTime, duration) {
    if (this.data.isSeeking) return;
    const safeDuration = Number(duration || this.data.duration || 0);
    const safeCurrent = Number(currentTime || 0);
    this.setData({
      currentTime: safeCurrent,
      duration: safeDuration,
      currentTimeText: formatVideoTime(safeCurrent),
      durationText: formatVideoTime(safeDuration),
      seekTimeText: formatVideoTime(safeCurrent),
      progressPercent: safeDuration > 0 ? clampPercent((safeCurrent / safeDuration) * 100) : 0,
      progressDotPercent: safeDuration > 0 ? Math.max(2, Math.min(98, clampPercent((safeCurrent / safeDuration) * 100))) : 2
    });
  },

  handleVideoPlay() {
    this.setData({ isPlaying: true, videoWaiting: false, videoErrorText: '', pendingQualityRollback: null }, () => this.showVideoControls());
  },

  handleVideoPause() {
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    this.setData({ isPlaying: false, controlsVisible: true });
  },

  handleVideoEnded() {
    if (this.controlsTimer) clearTimeout(this.controlsTimer);
    const duration = Number(this.data.duration || 0);
    this.setData({
      isPlaying: false,
      controlsVisible: true,
      currentTime: duration,
      currentTimeText: formatVideoTime(duration),
      progressPercent: 100,
      progressDotPercent: 98
    });
  },

  handleVideoTimeUpdate(event) {
    const { currentTime, duration } = event.detail || {};
    this.updateVideoProgress(currentTime, duration);
  },

  handleVideoWaiting() {
    this.setData({ videoWaiting: true, controlsVisible: true });
  },

  handleVideoError() {
    const rollback = this.data.pendingQualityRollback;
    if (rollback?.quality && rollback.quality !== this.data.quality) {
      this.rollbackQuality(rollback);
      return;
    }
    this.setData({
      isPlaying: false,
      videoWaiting: false,
      videoErrorText: '视频加载失败，请稍后重试',
      controlsVisible: true,
      pendingQualityRollback: null
    });
  },

  rollbackQuality(rollback) {
    wx.showToast({ title: '清晰度切换失败，已恢复原画面', icon: 'none' });
    this.setData({
      quality: rollback.quality,
      qualityLabel: qualityLabel(rollback.quality || 'source'),
      detail: rollback.detail,
      currentTime: rollback.currentTime || 0,
      videoWaiting: false,
      videoErrorText: '',
      pendingQualityRollback: null
    }, () => {
      wx.nextTick(() => {
        const video = this.getVideoContext();
        if (rollback.currentTime > 0) video.seek(rollback.currentTime);
        video.play();
        video.playbackRate(this.data.speed);
      });
    });
  },

  handleFullscreenChange(event) {
    if (this.fullscreenExitTimer) clearTimeout(this.fullscreenExitTimer);
    const isFullscreen = Boolean(event.detail?.fullScreen);
    const direction = isFullscreen ? (event.detail?.direction || (this.data.videoDirection === 90 ? 'horizontal' : 'vertical')) : 'none';
    this.setData({
      isFullscreen,
      fullscreenDirection: direction,
      isPortraitFullscreen: isFullscreen && (direction === 'vertical' || this.data.isPortraitVideo),
      controlsVisible: true
    }, () => this.showVideoControls());
  },

  previewSeekByTouch(touch, shouldCommit = false) {
    if (!touch || !this.data.duration) return;
    const clientX = Number(touch.clientX ?? touch.x ?? 0);
    if (!clientX) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.progress-touch').boundingClientRect((rect) => {
      if (!rect || !rect.width) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nextTime = ratio * this.data.duration;
      this.setData({
        isSeeking: true,
        controlsVisible: true,
        currentTime: nextTime,
        currentTimeText: formatVideoTime(nextTime),
        seekTimeText: formatVideoTime(nextTime),
        progressPercent: clampPercent(ratio * 100),
        progressDotPercent: Math.max(2, Math.min(98, clampPercent(ratio * 100)))
      });
      if (shouldCommit) this.commitSeek(nextTime);
    }).exec();
  },

  commitSeek(nextTime = this.data.currentTime) {
    this.getVideoContext().seek(nextTime);
    if (this.seekBubbleTimer) clearTimeout(this.seekBubbleTimer);
    this.seekBubbleTimer = setTimeout(() => {
      this.setData({ isSeeking: false }, () => this.showVideoControls());
    }, 180);
  },

  seekVideo(event) {
    this.previewSeekByTouch(event.detail || event.changedTouches?.[0], true);
  },

  startSeekVideo(event) {
    this.previewSeekByTouch(event.touches?.[0], false);
  },

  moveSeekVideo(event) {
    this.previewSeekByTouch(event.touches?.[0], false);
  },

  endSeekVideo(event) {
    const touch = event.changedTouches?.[0];
    if (touch) {
      this.previewSeekByTouch(touch, true);
      return;
    }
    this.commitSeek();
  },

  handleVideoLoadedMeta(event) {
    const width = Number(event.detail?.width || 0);
    const height = Number(event.detail?.height || 0);
    const duration = Number(event.detail?.duration || this.data.duration || 0);
    // 微信 video direction：0 正常竖屏方向；90 横屏方向。
    // 横屏视频全屏横屏，竖屏/正方形视频全屏竖屏并保留必要黑边。
    const isPortraitVideo = height > width;
    const videoDirection = width > height ? 90 : 0;
    const ratio = width > 0 && height > 0 ? width / height : 0;
    const videoObjectFit = ratio >= 1.7 && ratio <= 1.9 ? 'fill' : 'contain';
    this.setData({
      videoDirection,
      isPortraitVideo,
      videoObjectFit,
      duration,
      durationText: formatVideoTime(duration)
    }, () => this.getVideoContext().playbackRate(this.data.speed));
  },

  openPrerequisite(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  async handleFileAction(event) {
    const file = event.currentTarget.dataset.file;
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
});
