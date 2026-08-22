'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import VideoFilters from '../components/VideoFilters.js';
import VideoList from '../components/VideoList.js';
import { fetchTodayAssignments, fetchUserMe, logoutUser } from '../lib/api.js';
import { EMPTY_VIDEO_FILTERS, useVideoList } from '../lib/useVideoList.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('zh-CN');
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [todayAssignments, setTodayAssignments] = useState([]);
  const [assignmentDate, setAssignmentDate] = useState(null);
  const [assignmentStatus, setAssignmentStatus] = useState('正在加载今日作业...');
  const {
    videos,
    filters,
    setFilters,
    listStatus,
    loadVideos,
    handleSearch,
    handleReset
  } = useVideoList({ autoLoad: false });

  async function loadTodayAssignments() {
    setAssignmentStatus('正在加载今日作业...');

    try {
      const result = await fetchTodayAssignments();
      setTodayAssignments(result.data.assignments);
      setAssignmentDate(result.data.assignmentDate);
      setAssignmentStatus('');
    } catch (error) {
      setTodayAssignments([]);
      setAssignmentStatus(error.message);
    }
  }

  useEffect(() => {
    async function initUserPage() {
      try {
        const result = await fetchUserMe();
        setUser(result.data);
        await Promise.all([
          loadVideos(EMPTY_VIDEO_FILTERS),
          loadTodayAssignments()
        ]);
      } catch (error) {
        router.replace('/login');
      }
    }

    initUserPage();
  }, [router]);

  async function handleLogout() {
    await logoutUser();
    router.replace('/login');
  }

  if (!user) {
    return <p className="empty-text">正在检查用户登录状态...</p>;
  }

  const assignmentsWithVideo = todayAssignments.filter((assignment) => assignment.video_id);
  const assignmentsWithMessage = todayAssignments.filter((assignment) => assignment.message);

  return (
    <>
      <section className="hero">
        <div>
          <h1>视频首页</h1>
          <p>普通用户可以浏览完整视频列表，管理员推送的内容会额外显示在今日作业区域。</p>
        </div>
        <button className="hero-button" type="button" onClick={handleLogout}>退出登录</button>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>今日的作业</h2>
          <button type="button" onClick={loadTodayAssignments}>刷新</button>
        </div>

        {assignmentDate ? <p className="section-note">最近更新：{formatDate(assignmentDate)}</p> : null}
        {assignmentStatus ? <p className="empty-text">{assignmentStatus}</p> : null}

        <div className="assignment-block">
          <h3>推荐视频</h3>
          {assignmentsWithVideo.length === 0 ? (
            <p className="empty-text">管理员还没有推荐视频</p>
          ) : (
            <div className="assignment-video-grid">
              {assignmentsWithVideo.map((assignment) => (
                <Link className="assignment-video-card" href={`/videos/${assignment.video_id}`} key={assignment.id}>
                  <div className="cover-wrap">
                    <Image src={assignment.video_cover_url} alt={assignment.video_title} fill unoptimized style={{ objectFit: 'cover' }} />
                  </div>
                  <strong>{assignment.video_title}</strong>
                  <span>{assignment.video_description || '暂无介绍'}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="assignment-block">
          <h3>留言板</h3>
          {assignmentsWithMessage.length === 0 ? (
            <p className="empty-text">管理员没有给你留言</p>
          ) : (
            <div className="message-list">
              {assignmentsWithMessage.map((assignment) => (
                <article className="message-item" key={assignment.id}>
                  <p>{assignment.message}</p>
                  <time>{new Date(assignment.created_at).toLocaleString('zh-CN')}</time>
                </article>
              ))}
            </div>
          )}
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
