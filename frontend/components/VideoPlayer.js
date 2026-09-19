'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function getReadySources(src, renditions = []) {
  const ready = renditions
    .filter((item) => item?.status === 'ready' && item.video_url)
    .map((item) => ({ quality: item.quality, label: item.quality === 'source' ? '原画' : item.quality?.toUpperCase?.() || item.quality, src: item.video_url }));

  if (!ready.some((item) => item.quality === 'source') && src) {
    ready.push({ quality: 'source', label: '原画', src });
  }

  return ready;
}

function getDefaultQuality(sources) {
  return sources.find((item) => item.quality === '1080p')?.quality || sources.find((item) => item.quality === 'source')?.quality || sources[0]?.quality || '';
}

function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayer({ src, poster, renditions = [], onNext }) {
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const restoreRef = useRef({ time: 0, playing: false });
  const sources = useMemo(() => getReadySources(src, renditions), [src, renditions]);
  const [quality, setQuality] = useState(() => getDefaultQuality(sources));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);

  useEffect(() => {
    setQuality(getDefaultQuality(sources));
  }, [sources]);

  const activeSource = sources.find((item) => item.quality === quality)?.src || src;
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
      if (restoreRef.current.time) {
        videoElement.currentTime = restoreRef.current.time;
      }
      if (restoreRef.current.playing) {
        videoElement.play().catch(() => {});
      }
      videoElement.removeEventListener('loadedmetadata', restore);
    }

    videoElement.addEventListener('loadedmetadata', restore);
    return () => videoElement.removeEventListener('loadedmetadata', restore);
  }, [activeSource]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed]);

  function togglePlay() {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    if (videoElement.paused) {
      videoElement.play().catch(() => {});
    } else {
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
        src={activeSource}
        poster={poster}
        autoPlay
        playsInline
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        x-webkit-airplay="deny"
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className={`vctrl${playing ? ' playing' : ''}`}>
        <button className="ibtn" type="button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 6h2.4v12H8V6Zm5.6 0H16v12h-2.4V6Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6.2 16.5 12 9 17.8V6.2Z" /></svg>
          )}
        </button>
        <button className="ibtn" type="button" aria-label="下一段" onClick={onNext} disabled={!onNext}>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 6H17v12h-1.5V6ZM6 6.8 15 12l-9 5.2V6.8Z" /></svg>
        </button>
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
        <button className="ibtn" type="button" aria-label="全屏" onClick={toggleFullscreen}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
        <span className="ctime">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
    </div>
  );
}
