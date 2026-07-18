'use client';

import { useEffect, useState } from 'react';
import VideoFilters from '../components/VideoFilters.js';
import VideoList from '../components/VideoList.js';
import { fetchVideos } from '../lib/api.js';

const EMPTY_FILTERS = { keyword: '', startDate: '', endDate: '' };

export default function HomePage() {
  const [videos, setVideos] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [listStatus, setListStatus] = useState('正在加载视频...');

  async function loadVideos(nextFilters = filters) {
    if (nextFilters.startDate && nextFilters.endDate && nextFilters.startDate > nextFilters.endDate) {
      setVideos([]);
      setListStatus('开始日期不能晚于结束日期');
      return;
    }

    setListStatus('正在加载视频...');

    try {
      const result = await fetchVideos(nextFilters);
      setVideos(result.data);
      setListStatus(result.data.length === 0 ? '没有找到符合条件的视频。' : '');
    } catch (error) {
      setVideos([]);
      setListStatus(error.message);
    }
  }

  useEffect(() => {
    loadVideos(EMPTY_FILTERS);
  }, []);

  function handleSearch(event) {
    event.preventDefault();
    loadVideos(filters);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    loadVideos(EMPTY_FILTERS);
  }

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
