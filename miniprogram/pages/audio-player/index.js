const { requireLogin } = require('../../services/auth');
const { getSignedUrl } = require('../../services/files');

const SPEED_OPTIONS = [0.5, 0.75, 1];

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}

function getSeekStep(duration) {
  const safeDuration = Math.max(1, Number(duration) || 1);
  if (safeDuration <= 30) return 5;
  if (safeDuration <= 90) return 10;
  return Math.min(30, Math.max(15, Math.round(safeDuration * 0.08)));
}

function getFormat(options = {}) {
  const explicitFormat = options.format || options.fileType;
  if (explicitFormat) return String(explicitFormat).toUpperCase();
  const title = options.title ? decodeURIComponent(options.title) : '';
  const match = title.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toUpperCase() : 'MP3';
}

function speedText(speed) {
  if (speed === 1) return '1.0x';
  return `${String(speed).replace(/^0\./, '0.')}x`;
}

Page({
  data: {
    fileId: '',
    fileSource: 'library',
    title: '',
    source: '',
    audioFormat: 'MP3',
    loading: false,
    playing: false,
    loop: false,
    duration: 0,
    currentTime: 0,
    seekStep: 5,
    progress: 0,
    currentTimeText: '00:00',
    durationText: '00:00',
    seeking: false,
    speedIndex: 2,
    speedText: '1.0x'
  },

  onLoad(options) {
    this.audio = null;
    this.setData({
      fileId: options.fileId || '',
      fileSource: options.fileSource || options.sourceType || 'library',
      title: options.title ? decodeURIComponent(options.title) : '',
      source: options.source ? decodeURIComponent(options.source) : '',
      audioFormat: getFormat(options)
    });
  },

  onShow() {
    if (!requireLogin()) return;
    if (!this.audio && this.data.fileId) {
      this.prepareAudio();
    }
  },

  onUnload() {
    this.destroyAudio();
  },

  async prepareAudio() {
    if (!this.data.fileId) {
      wx.showToast({ title: '音频文件不存在', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const signed = await getSignedUrl(this.data.fileId, this.data.fileSource);
      const url = signed.url || signed.signedUrl;
      if (!url) throw new Error('音频地址获取失败');
      this.initAudio(url);
    } catch (error) {
      wx.showToast({ title: error.userMessage || error.message || '音频加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  initAudio(url) {
    this.destroyAudio();
    const audio = wx.createInnerAudioContext();
    this.audio = audio;
    audio.src = url;
    audio.loop = this.data.loop;
    audio.playbackRate = SPEED_OPTIONS[this.data.speedIndex] || 1;

    audio.onCanplay(() => {
      const duration = Number(audio.duration || this.data.duration || 0);
      if (duration > 0) this.updateDuration(duration);
    });

    audio.onTimeUpdate(() => {
      if (this.data.seeking) return;
      const duration = Number(audio.duration || this.data.duration || 0);
      const currentTime = Number(audio.currentTime || 0);
      if (duration > 0) this.updateDuration(duration);
      this.updateCurrentTime(currentTime, duration || this.data.duration);
    });

    audio.onPlay(() => this.setData({ playing: true }));
    audio.onPause(() => this.setData({ playing: false }));
    audio.onStop(() => this.setData({ playing: false }));
    audio.onEnded(() => {
      if (this.data.loop) return;
      this.setData({ playing: false, currentTime: 0, progress: 0, currentTimeText: '00:00' });
    });
    audio.onError(() => {
      this.setData({ playing: false });
      wx.showToast({ title: '音频播放失败', icon: 'none' });
    });
  },

  destroyAudio() {
    if (!this.audio) return;
    this.audio.stop();
    this.audio.destroy();
    this.audio = null;
  },

  updateDuration(duration) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    if (!safeDuration || safeDuration === this.data.duration) return;
    this.setData({
      duration: safeDuration,
      seekStep: getSeekStep(safeDuration),
      durationText: formatTime(safeDuration)
    });
  },

  updateCurrentTime(currentTime, duration) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const safeCurrent = Math.min(safeDuration || currentTime, Math.max(0, Number(currentTime) || 0));
    const progress = safeDuration ? Math.round((safeCurrent / safeDuration) * 100) : 0;
    this.setData({
      currentTime: safeCurrent,
      progress,
      currentTimeText: formatTime(safeCurrent)
    });
  },

  toggleLoop() {
    const loop = !this.data.loop;
    if (this.audio) this.audio.loop = loop;
    this.setData({ loop });
  },

  togglePlay() {
    if (!this.audio) {
      this.prepareAudio().then(() => {
        if (this.audio) this.audio.play();
      });
      return;
    }
    if (this.data.playing) {
      this.audio.pause();
    } else {
      this.audio.play();
    }
  },

  toggleSpeed() {
    const speedIndex = (this.data.speedIndex + 1) % SPEED_OPTIONS.length;
    const speed = SPEED_OPTIONS[speedIndex];
    if (this.audio) this.audio.playbackRate = speed;
    this.setData({ speedIndex, speedText: speedText(speed) });
  },

  updateProgress(progress, seeking = false) {
    const duration = this.data.duration || 0;
    const currentTime = duration ? Math.round((progress / 100) * duration) : 0;
    this.setData({
      progress,
      currentTime,
      currentTimeText: formatTime(currentTime),
      seeking
    });
  },

  onSeeking(event) {
    this.updateProgress(event.detail.value, true);
  },

  onSeekEnd(event) {
    const progress = event.detail.value;
    this.updateProgress(progress, false);
    if (this.audio && this.data.duration) {
      this.audio.seek(this.data.currentTime);
    }
  },

  rewind() {
    this.seekBy(-this.data.seekStep);
  },

  forward() {
    this.seekBy(this.data.seekStep);
  },

  seekBy(offset) {
    const duration = this.data.duration || 0;
    const currentTime = Math.min(duration, Math.max(0, this.data.currentTime + offset));
    this.updateCurrentTime(currentTime, duration);
    if (this.audio) this.audio.seek(currentTime);
  },

  goBack() {
    wx.navigateBack();
  }
});
