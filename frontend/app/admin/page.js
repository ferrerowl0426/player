'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminUploadForm from '../../components/AdminUploadForm.js';
import VideoFilters from '../../components/VideoFilters.js';
import VideoList from '../../components/VideoList.js';
import { deleteVideo, fetchAdminMe, fetchVideos, logoutAdmin } from '../../lib/api.js';

const EMPTY_FILTERS = { keyword: '', startDate: '', endDate: '' };

export default function AdminPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
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
    async function initAdminPage() {
      try {
        const result = await fetchAdminMe();
        setAdmin(result.data);
        await loadVideos(EMPTY_FILTERS);
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initAdminPage();
  }, [router]);

  function handleSearch(event) {
    event.preventDefault();
    loadVideos(filters);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    loadVideos(EMPTY_FILTERS);
  }

  async function handleDelete(videoId) {
    const confirmed = window.confirm('确定要删除这个视频吗？删除后数据库记录、视频文件和封面都会被删除。');

    if (!confirmed) {
      return;
    }

    try {
      await deleteVideo(videoId);
      await loadVideos(filters);
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleLogout() {
    await logoutAdmin();
    router.replace('/admin/login');
  }

  if (!admin) {
    return <p className="empty-text">正在检查管理员登录状态...</p>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>管理员后台</h1>
          <p>管理员可以浏览、搜索、上传和删除视频，视频文件仍由浏览器直传腾讯云 COS。</p>
        </div>
        <button className="hero-button" type="button" onClick={handleLogout}>退出登录</button>
      </section>

      <AdminUploadForm onUploaded={() => loadVideos(filters)} />

      <section className="video-section">
        <div className="section-title">
          <h2>视频管理</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新</button>
        </div>

        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList videos={videos} status={listStatus} canDelete onDelete={handleDelete} />
      </section>
    </>
  );
}
