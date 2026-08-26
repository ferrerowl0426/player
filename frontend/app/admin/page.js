'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminUploadForm from '../../components/AdminUploadForm.js';
import VideoFilters from '../../components/VideoFilters.js';
import VideoList from '../../components/VideoList.js';
import { deleteVideo, fetchAdminMe, fetchClasses, logoutAdmin } from '../../lib/api.js';
import { EMPTY_VIDEO_FILTERS, useVideoList } from '../../lib/useVideoList.js';

export default function AdminPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [classes, setClasses] = useState([]);
  const {
    videos,
    filters,
    setFilters,
    listStatus,
    loadVideos,
    handleSearch,
    handleReset
  } = useVideoList({ autoLoad: false });

  useEffect(() => {
    async function initAdminPage() {
      try {
        const result = await fetchAdminMe();
        setAdmin(result.data);
        await loadVideos(EMPTY_VIDEO_FILTERS);

        if (result.data.role === 'super_admin') {
          const classesResult = await fetchClasses();
          setClasses(classesResult.data);
        }
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initAdminPage();
  }, [router]);

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
    return <p className="empty-text">正在检查老师登录状态...</p>;
  }

  const isSuperAdmin = admin.role === 'super_admin';

  return (
    <>
      <section className="hero">
        <div>
          <h1>{isSuperAdmin ? '教导主任后台' : '老师后台'}</h1>
          <p>
            {isSuperAdmin
              ? '教导主任可以管理班级、老师账号、视频，并给每个学员推送内容。'
              : '老师可以管理本班学员、上传视频，并给学员推送内容。'}
          </p>
        </div>
        <button className="hero-button" type="button" onClick={handleLogout}>退出登录</button>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>快捷入口</h2>
        </div>
        <div className="admin-link-grid">
          {isSuperAdmin && <a href="/admin/classes">班级管理</a>}
          <a href="/admin/users">{isSuperAdmin ? '学员管理' : '班级学员'}</a>
          {isSuperAdmin && <a href="/admin/admins">老师账号</a>}
        </div>
      </section>

      {isSuperAdmin && classes.length > 0 && (
        <section className="video-section">
          <div className="section-title">
            <h2>班级概览</h2>
          </div>
          <div className="class-overview-grid">
            {classes.map((cls) => (
              <a key={cls.id} className="class-overview-card" href="/admin/classes">
                <strong>{cls.name}</strong>
                <span>负责老师：{cls.teacher_name || '未分配'}</span>
                <span>学员：{cls.students?.length || 0} 人</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <AdminUploadForm onUploaded={() => loadVideos(filters)} />

      <section className="video-section">
        <div className="section-title">
          <h2>视频管理</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新</button>
        </div>

        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList
          videos={videos}
          status={listStatus}
          canDelete={isSuperAdmin}
          onDelete={isSuperAdmin ? handleDelete : undefined}
          detailQuery="?from=admin"
        />
      </section>
    </>
  );
}
