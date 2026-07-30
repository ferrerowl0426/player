'use client';

import VideoFilters from '../components/VideoFilters.js';
import VideoList from '../components/VideoList.js';
import { useVideoList } from '../lib/useVideoList.js';

export default function HomePage() {
  const {
    videos,
    filters,
    setFilters,
    listStatus,
    loadVideos,
    handleSearch,
    handleReset
  } = useVideoList();

  return (
    <>
      <section className="hero">
        <div>
          <h1>视频首页</h1>
          <p>普通用户不需要登录，可以浏览、搜索和播放视频。</p>
        </div>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>视频列表</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新</button>
        </div>

        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList videos={videos} status={listStatus} />
      </section>
    </>
  );
}
