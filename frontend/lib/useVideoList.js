import { useEffect, useState } from 'react';
import { fetchVideos } from './api.js';

export const EMPTY_VIDEO_FILTERS = { keyword: '', startDate: '', endDate: '' };

export function useVideoList({ autoLoad = true } = {}) {
  const [videos, setVideos] = useState([]);
  const [filters, setFilters] = useState(EMPTY_VIDEO_FILTERS);
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
    if (autoLoad) {
      loadVideos(EMPTY_VIDEO_FILTERS);
    }
  }, [autoLoad]);

  function handleSearch(event) {
    event.preventDefault();
    loadVideos(filters);
  }

  function handleReset() {
    setFilters(EMPTY_VIDEO_FILTERS);
    loadVideos(EMPTY_VIDEO_FILTERS);
  }

  return {
    videos,
    filters,
    setFilters,
    listStatus,
    loadVideos,
    handleSearch,
    handleReset
  };
}
