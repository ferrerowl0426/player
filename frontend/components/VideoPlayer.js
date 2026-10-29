'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../lib/api.js';

// ===== PURE-FOR-TEST-START =====
export function getReadySources(src, renditions = [], playSrc) {
  const ready = renditions
    .filter((item) => item?.status === 'ready' && item.video_url)
    .map((item) => ({ quality: item.quality, label: item.quality === 'source' ? '原画' : item.quality?.toUpperCase?.() || item.quality, src: item.play_url || item.video_url, originSrc: item.video_url }));

  if (!ready.some((item) => item.quality === 'source') && src) {
    ready.push({ quality: 'source', label: '原画', src: playSrc || src, originSrc: src });
  }

  return ready;
}

export function getDefaultQuality(sources) {
  return sources.find((item) => item.quality === '1080p')?.quality || sources.find((item) => item.quality === 'source')?.quality || sources[0]?.quality || '';
}

export function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Decide how to react to a <video> error event for the CDN -> COS fallback.
// Pure so it can be unit-tested without a DOM.
//   'ignore'  : not our error (stale/foreign source) -> do nothing.
//   'fallback': CDN failed and COS is available -> switch this quality to COS once.
//   'final'   : already on COS (or single source) and failed -> surface error.
// `allowCosFallback` is false for authorized (private) sources where no
// unsigned COS direct link exists. We also never fall back to an unsigned COS
// origin when the CDN url is itself already signed (a signed CDN url must not
// be swapped for an unsigned COS direct link).
export function decideFallbackError({ selectedSource, sourceKey, fallbackSet, videoError, currentSrc, assignedSrc, allowCosFallback = true }) {
  if (!videoError || !selectedSource) return { type: 'ignore' };
  // Stale-error race guard: only treat the error as ours when the element's
  // actual currentSrc equals the URL we last assigned. A late/duplicate error
  // from a previously-attempted source (e.g. the CDN url after we already
  // switched this quality to COS) carries a different currentSrc and must be
  // ignored, otherwise it would be misreported as a COS failure.
  if (assignedSrc && currentSrc && currentSrc !== assignedSrc) return { type: 'ignore' };
  const onCos = fallbackSet.has(sourceKey);
  const cdn = selectedSource.src;
  const cos = selectedSource.originSrc;
  if (allowCosFallback && !onCos && cdn !== cos && cos && !isSignedUrl(cdn)) return { type: 'fallback' };
  return { type: 'final' };
}

// Whether a URL is an already-signed CDN url (carries a `sign` query).
// Such urls must never be swapped for an unsigned COS origin.
export function isSignedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, 'http://placeholder.invalid');
    return parsed.searchParams.has('sign');
  } catch {
    return /[?&]sign=/.test(url);
  }
}

// Build the playback authorization endpoint (no permanent playback src).
// source 'video' -> 原画; 'rendition' -> a specific ready quality.
export function buildPlayUrl(apiBaseUrl, videoId, { source = 'video', quality } = {}) {
  const params = new URLSearchParams();
  params.set('source', source);
  if (source === 'rendition' && quality) params.set('quality', quality);
  const base = String(apiBaseUrl || '').replace(/\/+$/, '');
  return `${base}/playback/videos/${videoId}/play-url?${params.toString()}`;
}

// Authorized source list for a private video: 原画 + ready renditions.
// No permanent src/originSrc/fallbackSrc — URLs are fetched per quality.
export function getAuthorizedSources(renditions = []) {
  const ready = (renditions || [])
    .filter((item) => item?.status === 'ready' && item.quality)
    .map((item) => ({
      quality: item.quality,
      label: item.quality === 'source' ? '原画' : item.quality?.toUpperCase?.() || item.quality,
      authorized: true
    }));
  if (!ready.some((item) => item.quality === 'source')) {
    ready.unshift({ quality: 'source', label: '原画', authorized: true });
  }
  return ready;
}

// Decide how to react to an error on an authorized (private) source.
//   'ignore': stale/foreign error -> drop it.
//   'reauth': transient / signed-expired -> re-authorize once, keep progress.
//   'error' : already re-authorized once -> surface, never refresh forever.
export function decideAuthError({ videoError, currentSrc, assignedSrc, reauthAllowed }) {
  if (!videoError) return { type: 'ignore' };
  if (assignedSrc && currentSrc && currentSrc !== assignedSrc) return { type: 'ignore' };
  if (reauthAllowed) return { type: 'reauth' };
  return { type: 'error' };
}

// Pick the URL to actually load for the selected source, honoring the
// per-quality "already fell back to COS" record.
export function pickActiveSource(selectedSource, sourceKey, fallbackSet, fallbackSrc) {
  if (!selectedSource) return fallbackSrc || '';
  const base = fallbackSet.has(sourceKey) ? selectedSource.originSrc : selectedSource.src;
  return base || fallbackSrc || '';
}
// ===== PURE-FOR-TEST-END =====

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayer({ src, playSrc, poster, renditions = [], onPrev, onNext, videoId, requiresAuthorization = false }) {
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const restoreRef = useRef({ time: 0, playing: false });
  const sources = useMemo(() => {
    if (requiresAuthorization) return getAuthorizedSources(renditions);
    return getReadySources(src, renditions, playSrc);
  }, [requiresAuthorization, src, renditions, playSrc]);
  const fallbackRef = useRef(new Set());
  const assignedSrcRef = useRef(null);
  const wantPlayRef = useRef(true);
  const [, setFallbackVersion] = useState(0);
  const [playbackError, setPlaybackError] = useState('');
  const [quality, setQuality] = useState(() => getDefaultQuality(sources));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  // 私密授权播放：按需获取的临时地址，不保留永久 src/originSrc/fallbackSrc。
  const [authorizedSrc, setAuthorizedSrc] = useState('');
  const authRequestRef = useRef(0);
  const authAbortRef = useRef(null);
  const reauthCountsRef = useRef(new Map());

  useEffect(() => {
    setQuality(getDefaultQuality(sources));
  }, [sources]);

  const selectedSource = sources.find((item) => item.quality === quality) || sources[0];
  const sourceKey = selectedSource ? JSON.stringify([selectedSource.quality, selectedSource.src, selectedSource.originSrc]) : '';
  const activeSource = pickActiveSource(selectedSource, sourceKey, fallbackRef.current, src);
  const videoSrc = requiresAuthorization ? authorizedSrc : activeSource;

  useEffect(() => {
    // Track the URL actually handed to the <video> element so the error handler
    // can drop stale errors fired for a previous source (src-switch race).
    assignedSrcRef.current = videoSrc || null;
  }, [videoSrc]);

  // 私密视频：按 quality 向授权接口获取临时播放地址。
  // 使用 AbortController + 请求序号进行身份匹配，阻止旧响应覆盖新清晰度。
  async function loadAuthorizedSource(nextQuality, { reauthorize = false } = {}) {
    if (!requiresAuthorization || !videoId) return;
    authAbortRef.current?.abort();
    const controller = new AbortController();
    authAbortRef.current = controller;
    const requestId = (authRequestRef.current += 1);
    try {
      setPlaybackError('');
      const url = buildPlayUrl(getApiBaseUrl(), videoId, {
        source: nextQuality === 'source' ? 'video' : 'rendition',
        quality: nextQuality === 'source' ? undefined : nextQuality
      });
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.message || '获取播放地址失败');
      const playUrl = result?.data?.url;
      if (!playUrl) throw new Error('响应缺少播放地址');
      // 身份匹配：仅当本次请求仍是最近一次时才应用，丢弃过期/陈旧响应。
      if (requestId !== authRequestRef.current) return;
      setAuthorizedSrc(playUrl);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (requestId !== authRequestRef.current) return;
      // 私密视频失败不得直链回退。
      setPlaybackError(error?.message || '视频加载失败，请稍后重试。');
    }
  }

  // 切换清晰度/换片时加载对应授权地址；每个清晰度仅允许一次重新授权。
  useEffect(() => {
    if (!requiresAuthorization || !videoId) return;
    setAuthorizedSrc('');
    reauthCountsRef.current = new Map();
    loadAuthorizedSource(quality);
    return () => {
      authRequestRef.current += 1;
      authAbortRef.current?.abort();
    };
  }, [requiresAuthorization, videoId, quality]);

  useEffect(() => {
    restoreRef.current = { time: 0, playing: true };
    wantPlayRef.current = true;
    setPlaybackError('');
  }, [src, videoId]);

  function handlePlaybackError(event) {
    const video = event.currentTarget;
    if (requiresAuthorization) {
      // 私密授权源：签名过期等媒体错误允许仅一次重新授权并保持进度，
      // 已重新授权一次后仍失败则报错，避免无限刷新。
      const decision = decideAuthError({
        videoError: video.error,
        currentSrc: video.currentSrc,
        assignedSrc: assignedSrcRef.current,
        reauthAllowed: (reauthCountsRef.current.get(sourceKey) || 0) < 1
      });
      if (decision.type === 'ignore') return;
      if (decision.type === 'reauth') {
        reauthCountsRef.current.set(sourceKey, (reauthCountsRef.current.get(sourceKey) || 0) + 1);
        restoreRef.current = {
          time: video.currentTime || currentTime || restoreRef.current.time || 0,
          playing: wantPlayRef.current
        };
        setPlaybackError('');
        loadAuthorizedSource(quality, { reauthorize: true });
        return;
      }
      setPlaybackError('视频加载失败，授权地址已失效且无法重新获取，请稍后重试或确认访问权限。');
      return;
    }
    const decision = decideFallbackError({
      selectedSource,
      sourceKey,
      fallbackSet: fallbackRef.current,
      videoError: video.error,
      currentSrc: video.currentSrc,
      assignedSrc: assignedSrcRef.current,
    });
    if (decision.type === 'ignore') return;
    if (decision.type === 'fallback') {
      restoreRef.current = { time: video.currentTime || currentTime || restoreRef.current.time || 0, playing: wantPlayRef.current };
      fallbackRef.current.add(sourceKey);
      setPlaybackError('');
      setFallbackVersion((value) => value + 1);
      return;
    }
    setPlaybackError('视频加载失败，CDN 与源站均不可用或当前视频无法播放，请稍后重试。');
  }
  const activeLabel = sources.find((item) => item.quality === quality)?.label || '原画';
  const progress = duration ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  useEffect(() => {
    const videoElement = videoRef.current;

    function handlePlay() {
      document.querySelectorAll('video').forEach((otherVideo) => {
        if (otherVideo !== videoElement) {
          otherVideo.pause();
        }
      });
      setPlaying(true);
    }

    function handlePause() {
      setPlaying(false);
    }

    function handleTimeUpdate() {
      setCurrentTime(videoElement.currentTime || 0);
    }

    function handleLoadedMetadata() {
      setDuration(videoElement.duration || 0);
      setCurrentTime(videoElement.currentTime || 0);
    }

    if (videoElement) {
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      videoElement.addEventListener('timeupdate', handleTimeUpdate);
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    }

    return () => {
      if (!videoElement) return;
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.pause();
    };
  }, []);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    function restore() {
      videoElement.playbackRate = speed;
      if (restoreRef.current.time) {
        videoElement.currentTime = restoreRef.current.time;
      }
      if (restoreRef.current.playing) {
        videoElement.play().catch(() => {});
      }
      setPlaybackError('');
      videoElement.removeEventListener('loadedmetadata', restore);
    }

    videoElement.addEventListener('loadedmetadata', restore);
    return () => videoElement.removeEventListener('loadedmetadata', restore);
  }, [videoSrc]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  function togglePlay() {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    if (videoElement.paused) {
      wantPlayRef.current = true;
      videoElement.play().catch(() => {});
    } else {
      wantPlayRef.current = false;
      videoElement.pause();
    }
  }

  function changeQuality(nextQuality) {
    const videoElement = videoRef.current;
    if (videoElement) {
      restoreRef.current = {
        time: videoElement.currentTime,
        playing: !videoElement.paused
      };
    }
    wantPlayRef.current = restoreRef.current.playing;
    setPlaybackError('');
    setQuality(nextQuality);
    setQualityOpen(false);
  }

  function seekFromClientX(clientX) {
    const videoElement = videoRef.current;
    const bar = progressRef.current;
    if (!videoElement || !duration || !bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    videoElement.currentTime = ratio * duration;
    setCurrentTime(videoElement.currentTime || 0);
  }

  function seek(event) {
    seekFromClientX(event.clientX);
  }

  function handleProgressMove(event) {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverPercent(ratio * 100);
    setHoverTime(ratio * duration);
  }

  function startSeek(event) {
    event.preventDefault();
    seekFromClientX(event.clientX);

    function handleMove(moveEvent) {
      seekFromClientX(moveEvent.clientX);
    }

    function handleUp() {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    }

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }

  function toggleFullscreen() {
    const wrap = videoRef.current?.closest('.video');
    if (!wrap) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      wrap.requestFullscreen?.();
    }
  }

  return (
    <div className="player-wrap">
      <video
        ref={videoRef}
        className="player"
        src={videoSrc || undefined}
        poster={poster}
        autoPlay
        playsInline
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        x-webkit-airplay="deny"
        onContextMenu={(e) => e.preventDefault()}
        onError={handlePlaybackError}
      />
      {playbackError ? <p role="alert" className="form-error">{playbackError}</p> : null}
      <div className={`vctrl${playing ? ' playing' : ''}`}>
        <button className="ibtn part-btn" type="button" aria-label="上一P" title="上一P" onClick={onPrev} disabled={!onPrev}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6.5 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M17 7.2 9.2 12 17 16.8V7.2Z" fill="currentColor" />
          </svg>
        </button>
        <button className="ibtn" type="button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 6h2.4v12H8V6Zm5.6 0H16v12h-2.4V6Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6.2 16.5 12 9 17.8V6.2Z" /></svg>
          )}
        </button>
        <button className="ibtn part-btn" type="button" aria-label="下一P" title="下一P" onClick={onNext} disabled={!onNext}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 7.2 14.8 12 7 16.8V7.2Z" fill="currentColor" />
            <path d="M17.5 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          ref={progressRef}
          className="pbar"
          type="button"
          aria-label="播放进度"
          onClick={seek}
          onPointerDown={startSeek}
          onPointerMove={handleProgressMove}
          style={{ '--p': `${progress}%`, '--hx': `${hoverPercent || progress}%` }}
        >
          <i /><span className="knob" /><span className="tt">{formatTime(hoverTime || currentTime)}</span>
        </button>
        <span className="ctime">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <div className={`pop-wrap${qualityOpen ? ' menu-on' : ''}`}>
          <button className="tbtn" type="button" aria-haspopup="menu" onClick={() => { setQualityOpen((value) => !value); setSpeedOpen(false); }}>{activeLabel}</button>
          <div className="pmenu" role="menu">
            {sources.map((item) => (
              <button type="button" className={item.quality === quality ? 'on' : ''} onClick={() => changeQuality(item.quality)} key={item.quality}>
                <span className="dot" />{item.label}
              </button>
            ))}
          </div>
        </div>
        <div className={`pop-wrap${speedOpen ? ' menu-on' : ''}`}>
          <button className="tbtn" type="button" aria-haspopup="menu" onClick={() => { setSpeedOpen((value) => !value); setQualityOpen(false); }}>{speed.toFixed(1)}x</button>
          <div className="pmenu" role="menu">
            {SPEEDS.map((item) => (
              <button type="button" className={item === speed ? 'on' : ''} onClick={() => { setSpeed(item); setSpeedOpen(false); }} key={item}>
                <span className="dot" />{item.toFixed(1)}x
              </button>
            ))}
          </div>
        </div>
        <button className="ibtn" type="button" aria-label="全屏" onClick={toggleFullscreen}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>
  );
}
