'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// TODO(M3 cleanup): 旧后台首页仍使用 hero/video-section/VideoList；角色后台页按 student-manage/class-manage 设计稿返工后删除这套旧视频管理入口。
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

  async function handleDelete(video) {
    const confirmed = window.confirm(`确定删除《${video.title}》吗？\n\n删除后：\n- 视频文件、封面和附件会从存储桶删除\n- 其他课程中引用它的前置知识关系会自动移除\n- 学生主页历史操作记录会保留课程标题，但不再跳转\n\n此操作不可恢复。`);

    if (!confirmed) {
      return;
    }

    try {
      await deleteVideo(video.id);
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
              ? '教导主任可以管理班级、视频，并编辑每个学员主页置顶的课程视频和作业备注。'
              : '老师可以管理本班学员、上传视频，并编辑学员主页置顶的课程视频和作业备注。'}
          </p>
        </div>
        <button className="hero-button" type="button" onClick={handleLogout}>退出登录</button>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>快捷入口</h2>
        </div>
        <div className="admin-link-grid">
          <a href="/admin/upload?zone=track&type=lesson">新建单曲目</a>
          <a href="/admin/upload?zone=track&type=collection">新建曲谱集</a>
          {isSuperAdmin && <a href="/admin/tracks">曲目管理</a>}
          {isSuperAdmin && <a href="/admin/knowledge">知识点管理</a>}
          {isSuperAdmin && <a href="/admin/classes">班级管理</a>}
          <a href="/admin/users">{isSuperAdmin ? '学员管理' : '班级学员'}</a>
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

      <section className="video-section">
        <div className="section-title">
          <h2>视频管理</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新</button>
        </div>
        {isSuperAdmin ? <p className="section-note">教导主任可以在课程卡片中编辑或删除课程，并管理曲目和 P 分段。</p> : <p className="section-note">老师可以管理本班学员和作业，内容创建与编辑由教导主任负责。</p>}

        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList
          videos={videos}
          status={listStatus}
          canEdit={isSuperAdmin}
          canDelete={isSuperAdmin}
          onDelete={isSuperAdmin ? handleDelete : undefined}
          detailQuery="?from=admin"
        />
      </section>
    </>
  );
}


