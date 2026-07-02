'use client';

import { useEffect, useRef } from 'react';

export default function VideoPlayer({ src, poster }) {
  const videoRef = useRef(null);

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

  return <video ref={videoRef} className="player" src={src} poster={poster} controls autoPlay />;
}
