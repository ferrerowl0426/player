const { formatTime, getPlayerLayout, getMenuLayout, getSeekBubbleStyle, seekTime } = require('./layout');

const SPEEDS = [0.5, 0.8, 1, 1.25, 1.5, 2];
const FULLSCREEN_TIMEOUT = 3000;

function getSeekPoint(event = {}) {
  const touch = event.touches?.[0] || event.changedTouches?.[0];
  if (touch) return touch;
  const detail = event.detail || {};
  if (detail.clientX !== undefined || detail.pageX !== undefined) {
    return { clientX: detail.clientX ?? detail.pageX };
  }
  if (detail.x !== undefined) return { x: detail.x };
  return null;
}

Component({
  properties: {
    // 一次切源的 URL、起点和播放意图必须一起更新，id 每次加载递增。
    media: { type: Object, value: null },
    active: { type: Boolean, value: false },
    poster: { type: String, value: '' },
    speed: { type: Number, value: 1 },
    speedOptions: { type: Array, value: SPEEDS.map((value) => ({ value, label: `${value}x` })) },
    quality: { type: String, value: '' },
    qualityOptions: { type: Array, value: [] },
    hasPrevious: { type: Boolean, value: false },
    hasNext: { type: Boolean, value: false },
    autoNext: { type: Boolean, value: true }
  },

  data: {
    videoSrc: '',
    sourceId: 0,
    sourceToken: 0,
    initialTime: 0,
    metadataReady: false,
    speedLabel: '1x',
    qualityLabel: '原画',
    videoDirection: 0,
    controlsVisible: true,
    isPlaying: false,
    isFullscreen: false,
    // 窗口铺满去黑边；全屏 contain 保完整画面。
    objectFit: 'cover',
    fullscreenTransition: '',
    switchingSource: false,
    menu: '',
    isSeeking: false,
    currentTimeText: '0:00',
    durationText: '0:00',
    progressPercent: 0,
    waiting: false,
    errorText: '',
    fullscreenDirection: 'none',
    insetStyle: '',
    popupStyle: '',
    statusStyle: '',
    bubbleStyle: ''
  },

  observers: {
    media(media) {
      if (!media) return;
      const hasIncomingToken = media.sourceToken !== undefined && media.sourceToken !== null;
      const tokenChanged = hasIncomingToken
        && String(media.sourceToken) !== String(this._sourceToken || '');
      if (media.id !== this._sourceId || media.src !== this.data.videoSrc || tokenChanged) this.loadMedia(media);
      else if (media.play && this.data.active) this.play();
    },
    active(value) {
      if (value) {
        // active 只表示页面处于前台，是否自动播放由当前 media 的 play 意图决定。
        // 这样暂停状态切换清晰度或回滚时，不会因为 active=true 被误播。
        if (this._wantPlay) this.syncPlayback();
      }
      else this.pause();
    },
    speed(value) {
      this.setData({ speedLabel: `${value}x` });
      this.applyPlaybackRate();
    },
    'quality, qualityOptions'(quality, options) {
      const selected = (options || []).find((item) => item.quality === quality);
      this.setData({ qualityLabel: selected?.label || '原画' });
      this.renderLayout();
    },
    speedOptions() {
      this.renderLayout();
    }
  },

  lifetimes: {
    ready() {
      this._detached = false;
      // video/cover-view dragging must receive non-passive touchmove events
      // on iOS. Keep the runtime override for pages that inherit a different
      // global setting or run on a newer base library.
      if (this.setPassiveEvent) this.setPassiveEvent({ touchstart: false, touchmove: false });
      this.videoContext = wx.createVideoContext('courseVideo', this);
      this.updateLayout();
      this.syncPlayback();
    },
    detached() {
      this._detached = true;
      this.clearTimers();
      this.videoContext?.pause();
      this.videoContext = null;
    }
  },

  pageLifetimes: {
    hide() { this.pause(); },
    resize() { this.cancelSeek(); this.updateLayout(); }
  },

  methods: {
    clearTimer(name) {
      if (this[name]) clearTimeout(this[name]);
      this[name] = null;
    },

    clearTimers() {
      ['hideTimer', 'seekTimer', 'waitingTimer', 'fullscreenTimer', 'layoutTimer', 'dragUiTimer'].forEach((name) => this.clearTimer(name));
    },

    emit(name, detail = {}) {
      if (!this._detached) this.triggerEvent(name, {
        ...detail,
        sourceId: this._sourceId,
        sourceToken: this._sourceToken
      });
    },

    isCurrentNode(event) {
      const dataset = event?.currentTarget?.dataset;
      return !this._detached && Boolean(this.data.videoSrc)
        && dataset?.sourceId !== undefined && dataset?.sourceToken !== undefined
        && String(dataset.sourceId) === String(this._sourceId)
        && String(dataset.sourceToken) === String(this._sourceToken);
    },

    isCurrentEvent(event) {
      return !this._pendingMedia && !this._loadingSource && this.isCurrentNode(event);
    },

    loadMedia(media) {
      // 仅等待正在进行的旋转；稳定全屏直接更新同一个 video 的源。
      if (this.data.fullscreenTransition) {
        this._pendingMedia = media;
        this._wantPlay = false;
        ['hideTimer', 'seekTimer', 'waitingTimer'].forEach((name) => this.clearTimer(name));
        this.videoContext?.pause();
        this.setData({ switchingSource: true, controlsVisible: true, menu: '' });
        return;
      }
      this.mountMedia(media);
    },

    mountMedia(media) {
      this.clearTimers();
      const reuseSource = Boolean(media.src && media.src === this.data.videoSrc && this._metadataReady && !this.data.errorText);
      const previousDuration = this._duration || 0;
      const requestedPosition = Math.max(0, Number(media.position) || 0);
      // Quality switches use a new URL but the same timeline. Keep the old
      // duration/progress visible while metadata for the replacement source
      // loads so the bar does not flash back to zero.
      const preserveTimeline = !reuseSource && requestedPosition > 0 && previousDuration > 0;
      this._sourceMounting = true;
      // 每次加载都有独立 token；换源期间旧事件不会再改变新源状态。
      this._sourceToken = Number(media.sourceToken) || ((this._sourceToken || 0) + 1);
      this._sourceId = media.id;
      const token = this._sourceToken;
      this.videoContext?.pause();
      this._metadataReady = reuseSource;
      this._confirmed = false;
      this._ended = false;
      this._wantPlay = Boolean(media.play && this.data.active);
      this._position = requestedPosition;
      this._duration = reuseSource || preserveTimeline ? previousDuration : 0;
      this._seekTarget = null;
      this._drag = null;
      this._loadingSource = Boolean(media.src) && !reuseSource;
      const patch = {
        sourceId: media.id,
        sourceToken: token,
        initialTime: this._position,
        metadataReady: reuseSource,
        switchingSource: false,
        videoSrc: media.src || '',
        videoDirection: this.data.isFullscreen || reuseSource ? this.data.videoDirection : 0,
        isPlaying: false,
        controlsVisible: true,
        isSeeking: false,
        menu: '',
        currentTimeText: formatTime(this._position),
        durationText: formatTime(this._duration),
        progressPercent: this._duration > 0
          ? Math.max(0, Math.min(100, this._position / this._duration * 100))
          : 0,
        waiting: this._loadingSource,
        errorText: ''
      };
      const done = () => {
        if (this._detached || this._sourceToken !== token) return;
        if (reuseSource) this.commitSeek(this._position);
        else if (!this._loadingSource) this._sourceMounting = false;
        this.syncPlayback();
      };
      if (media.src && media.src === this.data.videoSrc && !reuseSource) {
        this.setData({ videoSrc: '', metadataReady: false }, () => {
          if (!this._detached && this._sourceToken === token) this.setData(patch, done);
        });
      } else this.setData(patch, done);
    },

    applyPlaybackRate() {
      if (SPEEDS.includes(this.data.speed)) this.videoContext?.playbackRate(this.data.speed);
    },

    syncPlayback() {
      if (!this.videoContext || this._detached || !this.data.videoSrc || this._pendingMedia) return;
      if (this._wantPlay && this.data.active && this._metadataReady) this.videoContext.play();
      else this.videoContext.pause();
      this.applyPlaybackRate();
    },

    play() {
      if (!this.data.active || this._detached) return;
      if (this._pendingMedia) return;
      if (this.data.errorText) { this.emit('retry'); return; }
      this._wantPlay = true;
      if (this._ended) {
        this._ended = false;
        this.commitSeek(0);
      }
      this.syncPlayback();
    },

    pause() {
      this._wantPlay = false;
      this._sourceMounting = false;
      if (!this.data.active) {
        if (this._pendingMedia) this._pendingMedia = { ...this._pendingMedia, play: false };
      }
      this.clearTimer('hideTimer');
      this.clearTimer('waitingTimer');
      this._drag = null;
      this.videoContext?.pause();
      if (!this._detached) this.setData({ isPlaying: false, isSeeking: false, controlsVisible: true, menu: '', waiting: false });
    },

    snapshot() {
      return { currentTime: this._seekTarget ?? this._position ?? 0, playing: Boolean(this._wantPlay), duration: this._duration || 0 };
    },

    handleLoadedMetadata(event) {
      if (this._pendingMedia || !this.isCurrentNode(event)) return;
      this._duration = Number(event.detail.duration) || 0;
      const position = Math.min(this._position, this._duration || this._position);
      const width = Number(event.detail.width);
      const height = Number(event.detail.height);
      this._metadataReady = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
      this._loadingSource = false;
      this.setData({
        videoDirection: width > height ? 90 : 0,
        metadataReady: this._metadataReady,
        durationText: formatTime(this._duration),
        waiting: false
      });
      // canplay 不是小程序 video 的文档事件；在 loadedmetadata 后恢复进度。
      if (position > 0) this.commitSeek(position);
      else if (!this._wantPlay) this.confirmSource();
      this.setData({}, () => {
        this.syncPlayback();
      });
    },

    handlePlay(event) {
      if (!this.isCurrentEvent(event)) return;
      if (!this.data.active || !this._wantPlay) { this.videoContext?.pause(); return; }
      this._sourceMounting = false;
      this.clearTimer('waitingTimer');
      this.setData({ isPlaying: true, waiting: false, errorText: '' });
      this.applyPlaybackRate();
      this.scheduleHide();
      this.emit('play');
    },

    handlePause(event) {
      if (!this.isCurrentEvent(event)) return;
      // 换源/seek 期间的原生 pause 不覆盖用户原先的播放意图。
      if (this._metadataReady && this._seekTarget === null && !this.data.waiting && !this.data.fullscreenTransition && !this._sourceMounting) this._wantPlay = false;
      this.clearTimer('hideTimer');
      this.setData({ isPlaying: false, controlsVisible: true });
      this.emit('pause');
    },

    confirmSource() {
      if (!this._metadataReady || this._confirmed) return;
      this._confirmed = true;
      this.emit('sourceconfirmed');
    },

    renderProgress(position, dragging = false, done) {
      const progressPercent = this._duration > 0 ? Math.max(0, Math.min(100, position / this._duration * 100)) : 0;
      // Move the bubble with the knob; update its native text less often.
      const data = {
        progressPercent,
        bubbleStyle: this._layout
          ? getSeekBubbleStyle(this._layout, progressPercent, this.data.isFullscreen)
          : ''
      };
      const now = Date.now();
      if (!dragging || !this._lastDragText || now - this._lastDragText >= 120) {
        this._lastDragText = now;
        data.currentTimeText = formatTime(position);
        data.durationText = formatTime(this._duration);
      }
      this.setData(data, done);
    },

    handleTimeUpdate(event) {
      if (!this.isCurrentEvent(event) || !this._metadataReady || this._ended) return;
      const position = Math.max(0, Number(event.detail.currentTime) || 0);
      this._duration = Number(event.detail.duration) || this._duration;
      if (this._drag) return;
      if (this._seekTarget !== null && Math.abs(position - this._seekTarget) > 1.5) return;
      this.clearTimer('seekTimer');
      this.clearTimer('waitingTimer');
      this._sourceMounting = false;
      this._seekTarget = null;
      this._position = position;
      this.setData({ waiting: false, isSeeking: false });
      this.renderProgress(position);
      this.confirmSource();
      // 不再向详情页转发每 250ms 的进度，避免两层 setData。
      if (!this._lastEmit || Date.now() - this._lastEmit >= 250) {
        this._lastEmit = Date.now();
        this.emit('timeupdate', { currentTime: position, duration: this._duration });
      }
      this.scheduleHideIfNeeded();
    },

    handleSeekComplete(event) {
      if (!this.isCurrentEvent(event) || this._seekTarget === null) return;
      // position 在 Android 为 ms、iOS 为 s，使用本次 seek 的秒数目标。
      this._position = this._seekTarget;
      this._seekTarget = null;
      this._sourceMounting = false;
      this.clearTimer('seekTimer');
      this.setData({ isSeeking: false, waiting: false });
      this.renderProgress(this._position);
      this.confirmSource();
      if (this._wantPlay && this.data.active) this.videoContext?.play();
      else this.videoContext?.pause();
    },

    handleEnded(event) {
      if (!this.isCurrentEvent(event) || !this._metadataReady || this._ended || this._drag || this._seekTarget !== null) return;
      this._ended = true;
      this._wantPlay = false;
      this.clearTimer('hideTimer');
      this.clearTimer('waitingTimer');
      this._position = this._duration;
      this.renderProgress(this._position);
      this.setData({ isPlaying: false, waiting: false, controlsVisible: true, menu: '' });
      if (this.data.active) this.emit('ended');
    },

    handleWaiting(event) {
      if (!this.isCurrentEvent(event)) return;
      this.clearTimer('waitingTimer');
      this.waitingTimer = setTimeout(() => {
        this.waitingTimer = null;
        if (!this._detached && this.data.active && this._wantPlay) {
          this.setData({ waiting: true });
          this.emit('waiting');
        }
      }, 450);
    },

    handleError(event) {
      // 加载失败可能发生在 metadata 前，不能被 _loadingSource 门禁吞掉。
      if (this._pendingMedia || !this.isCurrentNode(event)) return;
      // 必须在清除 _wantPlay 前捕获进度与播放意图，供上层做同档 COS 回退。
      const fallbackPosition = this._position || 0;
      const fallbackPlay = Boolean(this._wantPlay);
      this._loadingSource = false;
      this._sourceMounting = false;
      ['hideTimer', 'seekTimer', 'waitingTimer'].forEach((name) => this.clearTimer(name));
      this._metadataReady = false;
      this._wantPlay = false;
      this._drag = null;
      this._seekTarget = null;
      this.setData({ metadataReady: false, isPlaying: false, isSeeking: false, waiting: false, controlsVisible: true, menu: '', errorText: '视频加载失败，点击重试' });
      // 透出 position/play，旧字段(event.detail)原样保留以兼容历史监听。
      this.emit('error', { ...event.detail, position: fallbackPosition, play: fallbackPlay });
    },

    retry() { if (this.data.active && this.data.errorText) this.emit('retry'); },

    scheduleHideIfNeeded() {
      if (!this.hideTimer && this.data.controlsVisible) this.scheduleHide();
    },

    scheduleHide() {
      this.clearTimer('hideTimer');
      if (!this.data.active || !this.data.isPlaying || this.data.fullscreenTransition || this._pendingMedia || this.data.menu || this.data.isSeeking) return;
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (!this._detached) this.setData({ controlsVisible: false, menu: '' });
      }, 2600);
    },

    revealControls() {
      this.setData({ controlsVisible: true, menu: '' }, () => this.scheduleHide());
    },

    toggleControls() {
      if (!this.data.isFullscreen) {
        if (this.data.isSeeking || this.data.fullscreenTransition) return;
        this.clearTimer('hideTimer');
        this.setData({ controlsVisible: !this.data.controlsVisible, menu: '' }, () => {
          if (this.data.controlsVisible) this.scheduleHide();
        });
        return;
      }
      if (this.data.isSeeking || this.data.fullscreenTransition) return;
      this.clearTimer('hideTimer');
      this.setData({ controlsVisible: !this.data.controlsVisible, menu: '' }, () => {
        if (this.data.controlsVisible) this.scheduleHide();
      });
    },

    noop() {},
    // Windowed same-layer catchtouchmove: claim the gesture so page scroll
    // cannot cancel progress dragging on iOS.
    holdLayerTouch() {},
    closeMenu() {
      if (this.data.menu) this.setData({ menu: '' }, () => this.scheduleHide());
    },
    togglePlay() { if (this._pendingMedia) return; if (this._wantPlay) this.pause(); else this.play(); },
    handlePrevious() { if (!this._pendingMedia && this.data.hasPrevious && this.data.active) this.emit('previous'); },
    handleNext() { if (!this._pendingMedia && this.data.hasNext && this.data.active) this.emit('next'); },
    toggleAutoNext() { this.emit('autonextchange', { value: !this.data.autoNext }); },

    toggleMenu(event) {
      if (!this.data.isFullscreen || this.data.fullscreenTransition || this._pendingMedia) return;
      const menu = event.currentTarget.dataset.menu;
      this.clearTimer('hideTimer');
      this.setData({ menu: this.data.menu === menu ? '' : menu, controlsVisible: true }, () => {
        this.updateLayout();
        this.scheduleHide();
      });
    },

    selectSpeed(event) {
      if (!this.data.isFullscreen || this._pendingMedia) return;
      const speed = Number(event.currentTarget.dataset.speed);
      if (!SPEEDS.includes(speed)) return;
      this.revealControls();
      this.emit('speedchange', { speed });
    },

    selectQuality(event) {
      if (!this.data.isFullscreen || this._pendingMedia) return;
      const quality = event.currentTarget.dataset.quality;
      if (!(this.data.qualityOptions || []).some((item) => item.quality === quality)) return;
      const snapshot = this.snapshot();
      this.revealControls();
      this.emit('qualitychange', { quality, ...snapshot });
    },

    requestFullscreen(enter) {
      if (!this.videoContext || this.data.fullscreenTransition) return false;
      if (enter && (!this._metadataReady || !this.data.metadataReady || this._pendingMedia)) return false;
      this.clearTimer('fullscreenTimer');
      this.setData({
        fullscreenTransition: enter ? 'entering' : 'exiting',
        controlsVisible: true,
        menu: ''
      });
      const fail = () => {
        this.clearTimer('fullscreenTimer');
        if (!this._detached) {
          if (this._pendingMedia) this.finishFullscreenChange(this.data.isFullscreen);
          else this.setData({ fullscreenTransition: '', switchingSource: false });
        }
      };
      this.fullscreenTimer = setTimeout(() => {
        this.fullscreenTimer = null;
        if (this._detached) return;
        if (enter) fail();
        else this.finishFullscreenChange(false, 'none');
      }, FULLSCREEN_TIMEOUT);
      try {
        if (enter) this.videoContext.requestFullScreen({ direction: this.data.videoDirection, fail });
        else this.videoContext.exitFullScreen();
      } catch (error) {
        if (enter) fail();
        else this.finishFullscreenChange(false, 'none');
      }
      return true;
    },

    toggleFullscreen() {
      if (this.data.fullscreenTransition || this._pendingMedia || !this.videoContext) return;
      this.revealControls();
      if (this.data.isFullscreen) this.requestFullscreen(false);
      else if (this._metadataReady && this.data.metadataReady) this.requestFullscreen(true);
    },

    finishFullscreenChange(full, rawDirection = null) {
      this.clearTimer('fullscreenTimer');
      this.cancelSeek();
      this.clearTimer('hideTimer');
      const hasDirection = rawDirection !== undefined && rawDirection !== null && rawDirection !== '';
      const horizontal = hasDirection
        ? rawDirection === 90 || rawDirection === -90
          || rawDirection === '90' || rawDirection === '-90'
          || rawDirection === 'horizontal'
        : this.data.isFullscreen ? this._horizontal : this.data.videoDirection === 90;
      this._horizontal = full && horizontal;
      // 旋转结束后在原生层当前状态下挂载最新源，不为换源额外退出/进入全屏。
      const pendingMedia = this._pendingMedia || null;
      this.setData({
        isFullscreen: full,
        objectFit: full ? 'contain' : 'cover',
        fullscreenTransition: '',
        fullscreenDirection: full ? (this._horizontal ? 'horizontal' : 'portrait') : 'none',
        controlsVisible: true,
        menu: '',
        switchingSource: Boolean(pendingMedia)
      }, () => {
        this.updateLayout();
        this.applyPlaybackRate();
        if (pendingMedia) {
          this._pendingMedia = null;
          this.mountMedia(pendingMedia);
        } else this.scheduleHide();
      });
    },

    handleFullscreenChange(event) {
      if (!this.isCurrentNode(event)) return;
      this.finishFullscreenChange(Boolean(event.detail.fullScreen), event.detail.direction);
    },

    updateLayout() {
      if (this._detached) return;
      let info = {};
      try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (error) { /* 使用默认尺寸 */ }
      this._layout = getPlayerLayout(info, this.data.isFullscreen, this._horizontal, this._windowRect, this._envInsets);
      this.renderLayout();
      // 查询只发生在布局变化时，结果回调只渲染，不能再递归触发测量。
      if (!this.createSelectorQuery) return;
      const generation = (this._layoutGeneration || 0) + 1;
      this._layoutGeneration = generation;
      const full = this.data.isFullscreen;
      const query = this.createSelectorQuery();
      let windowRect = this._windowRect;
      let envInsets = this._envInsets;
      if (!full) query.select('.player-shell').boundingClientRect((rect) => {
        if (rect?.width) windowRect = rect;
      });
      query.select('.safe-area-probe').fields({ computedStyle: ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] }, (style) => {
        if (style) envInsets = {
          left: parseFloat(style.paddingLeft) || 0,
          right: parseFloat(style.paddingRight) || 0,
          top: parseFloat(style.paddingTop) || 0,
          bottom: parseFloat(style.paddingBottom) || 0
        };
      });
      query.exec(() => {
        if (this._detached || this._layoutGeneration !== generation || this.data.isFullscreen !== full) return;
        this._windowRect = windowRect;
        this._envInsets = envInsets;
        this._layout = getPlayerLayout(info, full, this._horizontal, windowRect, envInsets);
        this.renderLayout();
      });
    },

    renderLayout() {
      if (this._detached || !this._layout) return;
      const layout = this._layout;
      const baseSide = layout.horizontal ? 18 : 12;
      const leftInset = layout.safeAreaAvailable
        ? `${layout.left}px`
        : `calc(${baseSide}px + env(safe-area-inset-left))`;
      const rightInset = layout.safeAreaAvailable
        ? `${layout.right}px`
        : `calc(${baseSide}px + env(safe-area-inset-right))`;
      const fallbackSideStyle = layout.safeAreaAvailable ? ''
        : `padding-left:calc(${baseSide}px + constant(safe-area-inset-left));padding-left:${leftInset};padding-right:calc(${baseSide}px + constant(safe-area-inset-right));padding-right:${rightInset};`;
      // Native landscape fullscreen often keeps a portrait page metrics object, so
      // JS bottom insets get inflated and float the dock. Pin with bottom:0 and
      // only trust CSS env for portrait home-indicator padding.
      const sidePads = layout.safeAreaAvailable
        ? `padding-left:${leftInset};padding-right:${rightInset};`
        : fallbackSideStyle;
      const bottomPad = layout.horizontal
        ? 'padding-bottom:0;'
        : 'padding-bottom:constant(safe-area-inset-bottom);padding-bottom:env(safe-area-inset-bottom);';
      const inset = this.data.isFullscreen
        ? `position:absolute;left:0;right:0;bottom:0;width:100%;${sidePads}${bottomPad}`
        : 'left:0;right:0;bottom:0;';
      const menu = getMenuLayout(layout, this.data.menu === 'quality' ? this.data.qualityOptions.length : this.data.speedOptions.length);
      const popupRight = layout.safeAreaAvailable
        ? `right:${rightInset};`
        : `right:calc(${baseSide}px + constant(safe-area-inset-right));right:${rightInset};`;
      const popupPosition = layout.horizontal
        ? `left:${leftInset};right:${rightInset};`
        : popupRight;
      const popupWidth = layout.horizontal ? '' : `width:${menu.width}px;`;
      this.setData({
        insetStyle: inset,
        popupStyle: `${popupPosition}bottom:${menu.bottom}px;${popupWidth}height:${menu.height}px;`,
        statusStyle: 'left:50%;top:50%;',
        bubbleStyle: getSeekBubbleStyle(layout, this.data.progressPercent, this.data.isFullscreen)
      });
    },

    startSeek(event) {
      if (this._drag || !this._metadataReady || !this._duration || this.data.errorText || this.data.fullscreenTransition || this._pendingMedia) return;
      this.clearTimer('hideTimer');
      this.clearTimer('seekTimer');
      this.clearTimer('dragUiTimer');
      // Ignore completion from the previous seek once a new drag begins.
      this._seekTarget = null;
      if (!this._layout) this.updateLayout();
      this._lastDragText = 0;
      this._drag = { rect: this._layout.track, time: this._position, rendering: false };
      const point = getSeekPoint(event);
      const time = seekTime(point, this._drag.rect, this._duration);
      if (time !== null) this._drag.time = time;
      // iOS cover-view inside video drops touchmove if setData runs in the
      // same turn as touchstart (tap still works). Defer all UI patches.
      this.dragUiTimer = setTimeout(() => {
        this.dragUiTimer = null;
        if (!this._drag || this._detached) return;
        this.setData({ isSeeking: true, controlsVisible: true, menu: '' });
        this.flushSeekPreview();
      }, 0);
    },

    moveSeek(event) {
      if (!this._drag) return;
      const point = getSeekPoint(event);
      const time = seekTime(point, this._drag.rect, this._duration);
      if (time === null) return;
      this._drag.time = time;
      this.flushSeekPreview();
    },

    flushSeekPreview() {
      const drag = this._drag;
      if (!drag || drag.rendering || this._detached) return;
      const time = drag.time;
      // 一次只允许一个预览在渲染。期间的 move 只保存最新位置，
      // 回调后再绘制，避免固定 16ms 提交在原生层排队。
      drag.rendering = true;
      this.renderProgress(time, true, () => {
        if (this._detached || this._drag !== drag) return;
        drag.rendering = false;
        if (drag.time !== time) this.flushSeekPreview();
      });
    },

    endSeek(event) {
      if (!this._drag) return;
      this.clearTimer('dragUiTimer');
      const point = getSeekPoint(event);
      const time = seekTime(point, this._drag.rect, this._duration) ?? this._drag.time;
      // If this platform sends a touchend without coordinates, leave the tap
      // handler a chance to resolve the click instead of committing the old 0s.
      if (time === null || time === undefined) {
        this._drag = null;
        this._lastTouchSeekEnd = 0;
        this.cancelSeek();
        return;
      }
      this._drag = null;
      this._lastTouchSeekEnd = Date.now();
      this.commitSeek(time);
    },

    tapSeek(event) {
      // 部分原生层只派发 tap；有 touchend 时不要重复提交一次 seek。
      const point = getSeekPoint(event);
      if (this._lastTouchSeekEnd && Date.now() - this._lastTouchSeekEnd < 400) return;
      if (!this._metadataReady || !this._duration || this.data.errorText || this.data.fullscreenTransition || this._pendingMedia) return;
      // A tap may arrive before the asynchronous geometry query finishes.
      // The deterministic fallback layout still gives us a usable track.
      if (!this._layout) this.updateLayout();
      const time = seekTime(point, this._layout?.track, this._duration);
      if (time === null) return;
      this.clearTimer('hideTimer');
      this.setData({ controlsVisible: true, menu: '' });
      this.commitSeek(time);
    },

    cancelSeek() {
      this._drag = null;
      this._seekTarget = null;
      this.clearTimer('seekTimer');
      this.clearTimer('dragUiTimer');
      this.setData({ isSeeking: false });
      this.renderProgress(this._position || 0);
      this.scheduleHide();
    },

    commitSeek(time) {
      this.clearTimer('seekTimer');
      this._ended = false;
      this._seekTarget = Math.max(0, Math.min(this._duration || time, time));
      this.setData({ isSeeking: true });
      this.renderProgress(this._seekTarget);
      this.videoContext?.seek(this._seekTarget);
      // 旧基础库缺 seekcomplete 时，timeupdate 确认或超时解除预览锁。
      this.seekTimer = setTimeout(() => {
        this.seekTimer = null;
        this._seekTarget = null;
        this._sourceMounting = false;
        if (!this._detached) { this.setData({ isSeeking: false }); this.scheduleHide(); }
      }, 2000);
    }
  }
});
