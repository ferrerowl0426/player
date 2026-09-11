'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// TODO(M3 cleanup): 旧视频首页仍使用旧 VideoFilters/VideoList/hero/video-section 样式；新 PRD 角色首页完成后删除这套旧入口。
import VideoFilters from '../components/VideoFilters.js';
import VideoList from '../components/VideoList.js';
import { fetchTodayAssignments, fetchUserMe, logoutUser } from '../lib/api.js';
import { isGuestMode } from '../lib/guest.js';
import { EMPTY_VIDEO_FILTERS, useVideoList } from '../lib/useVideoList.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('zh-CN');
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
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
      // 游客模式不需要登录即可查看公开视频列表。
      if (isGuestMode()) {
        setIsGuest(true);
        await loadVideos(EMPTY_VIDEO_FILTERS);
        return;
      }

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

  if (!isGuest && !user) {
    return <p className="empty-text">正在检查学员登录状态...</p>;
  }

  const assignmentsWithContent = todayAssignments.filter((assignment) => assignment.object_type && assignment.object_type !== 'message');
  const assignmentsWithMessage = todayAssignments.filter((assignment) => assignment.message);

  function assignmentHref(assignment) {
    return assignment.navigation_url || (assignment.video_id ? `/videos/${assignment.video_id}` : '#');
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>{isGuest ? '视频首页' : '视频首页'}</h1>
          <p>
            {isGuest
              ? '游客模式：可以搜索和播放公开视频，不会看到推送和留言。'
              : '学员可以浏览完整视频列表，老师推送的内容会额外显示在今日作业区域。'}
          </p>
        </div>
        {!isGuest && (
          <button className="hero-button" type="button" onClick={handleLogout}>退出登录</button>
        )}
      </section>

      {!isGuest && (
        <section className="video-section">
          <div className="section-title">
            <h2>今日的作业</h2>
            <button type="button" onClick={loadTodayAssignments}>刷新</button>
          </div>

          {assignmentDate ? <p className="section-note">最近更新：{formatDate(assignmentDate)}</p> : null}
          {assignmentStatus ? <p className="empty-text">{assignmentStatus}</p> : null}

          <div className="assignment-block">
            <h3>推荐内容</h3>
            {assignmentsWithContent.length === 0 ? (
              <p className="empty-text">老师还没有推荐内容</p>
            ) : (
              <div className="assignment-video-grid">
                {assignmentsWithContent.map((assignment) => (
                  <Link className="assignment-video-card" href={assignmentHref(assignment)} key={assignment.id}>
                    <div className="cover-wrap">
                      {assignment.cover_url ? <Image src={assignment.cover_url} alt={assignment.title} fill unoptimized style={{ objectFit: 'cover' }} /> : null}
                    </div>
                    <strong>{assignment.title || '推荐内容'}</strong>
                    <span>{assignment.object_type === 'track_part' || assignment.object_type === 'knowledge_part' ? '指定 P 分段' : assignment.object_type}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="assignment-block">
            <h3>作业备注</h3>
            {assignmentsWithMessage.length === 0 ? (
              <p className="empty-text">老师没有给你作业备注</p>
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
      )}

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
