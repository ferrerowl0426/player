'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function getReadySources(src, renditions = []) {
  const ready = renditions
    .filter((item) => item?.status === 'ready' && item.video_url)
    .map((item) => ({ quality: item.quality, label: item.quality === 'source' ? '原画' : item.quality, src: item.video_url }));

  if (!ready.some((item) => item.quality === 'source') && src) {
    ready.push({ quality: 'source', label: '原画', src });
  }

  return ready;
}

function getDefaultQuality(sources) {
  return sources.find((item) => item.quality === '1080p')?.quality || sources.find((item) => item.quality === 'source')?.quality || sources[0]?.quality || '';
}

export default function VideoPlayer({ src, poster, renditions = [] }) {
  const videoRef = useRef(null);
  const restoreRef = useRef({ time: 0, playing: false });
  const sources = useMemo(() => getReadySources(src, renditions), [src, renditions]);
  const [quality, setQuality] = useState(() => getDefaultQuality(sources));

  useEffect(() => {
    setQuality(getDefaultQuality(sources));
  }, [sources]);

  const activeSource = sources.find((item) => item.quality === quality)?.src || src;

  useEffect(() => {
    const videoElement = videoRef.current;

    function handlePlay() {
      document.querySelectorAll('video').forEach((otherVideo) => {
        if (otherVideo !== videoElement) {
          otherVideo.pause();
        }
      });
    }

    if (videoElement) {
      videoElement.addEventListener('play', handlePlay);
    }

    return () => {
      if (!videoElement) {
        return;
      }

      videoElement.removeEventListener('play', handlePlay);
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

  function changeQuality(nextQuality) {
    const videoElement = videoRef.current;
    if (videoElement) {
      restoreRef.current = {
        time: videoElement.currentTime,
        playing: !videoElement.paused
      };
    }
    setQuality(nextQuality);
  }

  return (
    <div className="player-wrap">
      {sources.length > 1 ? (
        <div className="quality-menu" aria-label="清晰度切换">
          {sources.map((item) => (
            <button
              type="button"
              className={item.quality === quality ? 'active' : ''}
              onClick={() => changeQuality(item.quality)}
              key={item.quality}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <video ref={videoRef} className="player" src={activeSource} poster={poster} controls autoPlay />
    </div>
  );
}
