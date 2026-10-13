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

function validateAudioUrl(url) {
  if (!url) return '音频地址获取失败';
  if (!/^https:\/\//i.test(url)) return '音频地址必须使用 HTTPS';
  if (/\s/.test(url)) return '音频地址包含空格，可能无法播放';
  return '';
}

Page({
  data: {
    fileId: '',
    fileSource: 'library',
    title: '',
    source: '',
    coverUrl: '',
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
    speedText: '1.0x',
    audioReady: false,
    audioWaiting: false,
    audioErrorText: ''
  },

  onLoad(options) {
    this.audio = null;
    this.setData({
      fileId: options.fileId || '',
      fileSource: options.fileSource || options.sourceType || 'library',
      title: options.title ? decodeURIComponent(options.title) : '',
      source: options.source ? decodeURIComponent(options.source) : '',
      coverUrl: options.coverUrl ? decodeURIComponent(options.coverUrl) : '',
      audioFormat: getFormat(options)
    });
  },

  onShow() {
    if (!requireLogin()) return;
    if (!this.audio && this.data.fileId) {
      this.prepareAudio();
    }
  },

  onHide() {
    this.audioProgressRect = null;
    this.destroyAudio();
  },

  onUnload() {
    this.audioProgressRect = null;
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
      const urlError = validateAudioUrl(url);
      if (urlError) throw new Error(urlError);
      this.initAudio(url);
    } catch (error) {
      wx.showToast({ title: error.userMessage || error.message || '音频加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  initAudio(url) {
    this.destroyAudio();
    this.setData({ audioReady: false, audioWaiting: true, audioErrorText: '' });
    const audio = wx.createInnerAudioContext();
    this.audio = audio;
    audio.src = url;
    audio.loop = this.data.loop;
    this.applyAudioSpeed();

    audio.onCanplay(() => {
      const duration = Number(audio.duration || this.data.duration || 0);
      if (duration > 0) this.updateDuration(duration);
      this.applyAudioSpeed();
      this.setData({ audioReady: true, audioWaiting: false, audioErrorText: '' });
    });

    audio.onTimeUpdate(() => {
      if (this.data.seeking) return;
      const duration = Number(audio.duration || this.data.duration || 0);
      const currentTime = Number(audio.currentTime || 0);
      if (duration > 0) this.updateDuration(duration);
      this.updateCurrentTime(currentTime, duration || this.data.duration);
    });

    audio.onPlay(() => {
      this.applyAudioSpeed();
      this.setData({ playing: true, audioWaiting: false, audioErrorText: '' });
    });
    audio.onPause(() => this.setData({ playing: false, audioWaiting: false }));
    audio.onStop(() => this.setData({ playing: false, audioWaiting: false }));
    audio.onWaiting(() => this.setData({ audioWaiting: true }));
    audio.onEnded(() => {
      if (this.data.loop) return;
      this.setData({ playing: false, audioWaiting: false, currentTime: 0, progress: 0, currentTimeText: '00:00' });
    });
    audio.onError((error) => {
      const errorText = this.getAudioErrorMessage(error);
      this.setData({ playing: false, audioWaiting: false, audioErrorText: errorText });
      wx.showToast({ title: errorText, icon: 'none' });
    });
  },

  destroyAudio() {
    if (!this.audio) return;
    try {
      this.audio.stop();
      this.audio.destroy();
    } catch (error) {
      // ignore destroy errors from native audio context
    }
    this.audio = null;
    this.setData({ playing: false, audioReady: false, audioWaiting: false });
  },

  getAudioErrorMessage(error = {}) {
    const errCode = error.errCode || error.errorCode || '';
    if (errCode === 10001 || errCode === '10001') return '音频地址无效';
    if (errCode === 10002 || errCode === '10002') return '网络异常，音频加载失败';
    if (errCode === 10003 || errCode === '10003') return '音频格式暂不支持';
    if (errCode === 10004 || errCode === '10004') return '音频播放被中断';
    return '音频播放失败，请稍后重试';
  },

  ensureInnerAudioOption() {
    return new Promise((resolve) => {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        success: resolve,
        fail: () => resolve()
      });
    });
  },

  async playAudio() {
    if (!this.audio) return;
    await this.ensureInnerAudioOption();
    this.applyAudioSpeed();
    this.audio.play();
  },

  applyAudioSpeed(speed = SPEED_OPTIONS[this.data.speedIndex] || 1) {
    if (!this.audio) return false;
    try {
      if (typeof this.audio.playbackRate === 'function') {
        this.audio.playbackRate(speed);
      } else {
        this.audio.playbackRate = speed;
      }
      return true;
    } catch (error) {
      return false;
    }
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
      this.prepareAudio().then(() => this.playAudio());
      return;
    }
    if (this.data.playing) {
      this.audio.pause();
    } else {
      this.playAudio();
    }
  },

  toggleSpeed() {
    const speedIndex = (this.data.speedIndex + 1) % SPEED_OPTIONS.length;
    const speed = SPEED_OPTIONS[speedIndex];
    this.setData({ speedIndex, speedText: speedText(speed) }, () => {
      const applied = this.applyAudioSpeed(speed);
      if (this.audio) {
        setTimeout(() => this.applyAudioSpeed(speed), 120);
      }
      if (!applied && this.audio) {
        wx.showToast({ title: '当前环境暂不支持倍速', icon: 'none' });
      }
    });
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

  readAudioProgressRect(callback) {
    wx.createSelectorQuery().in(this).select('.audio-progress-track').boundingClientRect((rect) => {
      if (!rect?.width) return;
      this.audioProgressRect = rect;
      callback?.();
    }).exec();
  },

  previewAudioSeek(touch) {
    const rect = this.audioProgressRect;
    if (!touch || !rect?.width) return false;
    const clientX = Number(touch.clientX ?? touch.pageX ?? touch.x);
    if (!Number.isFinite(clientX)) return false;
    const progress = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    this.updateProgress(progress, true);
    return true;
  },

  startAudioSeek(event) {
    this.audioProgressRect = null;
    const gestureId = Number(this.audioSeekGestureId || 0) + 1;
    this.audioSeekGestureId = gestureId;
    this.latestAudioSeekTouch = event.touches?.[0];
    this.pendingAudioSeekEndTouch = null;
    this.readAudioProgressRect(() => {
      if (this.audioSeekGestureId !== gestureId) return;
      if (this.pendingAudioSeekEndTouch) {
        this.previewAudioSeek(this.pendingAudioSeekEndTouch);
        this.pendingAudioSeekEndTouch = null;
        this.commitAudioSeek();
        return;
      }
      this.previewAudioSeek(this.latestAudioSeekTouch);
    });
  },

  moveAudioSeek(event) {
    this.latestAudioSeekTouch = event.touches?.[0];
    this.previewAudioSeek(this.latestAudioSeekTouch);
  },

  endAudioSeek(event) {
    const touch = event.changedTouches?.[0] || this.latestAudioSeekTouch;
    if (touch && this.audioProgressRect) {
      this.previewAudioSeek(touch);
      this.commitAudioSeek();
      return;
    }
    if (touch) this.pendingAudioSeekEndTouch = touch;
  },

  commitAudioSeek() {
    this.setData({ seeking: false });
    if (this.audio && this.data.duration) this.audio.seek(this.data.currentTime);
    this.audioProgressRect = null;
    this.latestAudioSeekTouch = null;
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
