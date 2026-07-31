'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import VideoFilters from '../../../../../components/VideoFilters.js';
import VideoList from '../../../../../components/VideoList.js';
import {
  cancelUserAssignment,
  createUserAssignment,
  fetchAdminMe,
  fetchUserAssignments,
  softDeleteAssignment,
  updateUserAssignmentMessage
} from '../../../../../lib/api.js';
import { EMPTY_VIDEO_FILTERS, useVideoList } from '../../../../../lib/useVideoList.js';

const MESSAGE_MAX_LENGTH = 1000;
const MAX_ACTIVE_VIDEO_ASSIGNMENTS = 5;

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

export default function UserAssignmentsPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id;
  const [user, setUser] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [activeVideos, setActiveVideos] = useState([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('正在检查管理员登录状态...');
  const {
    videos,
    filters,
    setFilters,
    listStatus,
    loadVideos,
    handleSearch,
    handleReset
  } = useVideoList({ autoLoad: false });

  async function loadAssignments() {
    const result = await fetchUserAssignments(userId);
    setUser(result.data.user);
    setAssignments(result.data.assignments);
    setActiveVideos(result.data.activeVideos || []);
    setMessage(result.data.message || '');
    setStatus('');
  }

  useEffect(() => {
    async function initPage() {
      try {
        await fetchAdminMe();
        await Promise.all([
          loadAssignments(),
          loadVideos(EMPTY_VIDEO_FILTERS)
        ]);
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router, userId]);

  function handleToggleVideo(video) {
    const activeVideoIds = activeVideos.map((item) => item.id);

    if (activeVideoIds.includes(video.id)) {
      setStatus('这个视频已经在推送中');
      return;
    }

    setSelectedVideoIds((current) => {
      if (current.includes(video.id)) {
        return current.filter((id) => id !== video.id);
      }

      if (activeVideos.length + current.length >= MAX_ACTIVE_VIDEO_ASSIGNMENTS) {
        setStatus(`同一个用户最多只能同时推送 ${MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个视频`);
        return current;
      }

      setStatus('');
      return [...current, video.id];
    });
  }

  async function handleCreateAssignment(event) {
    event.preventDefault();

    if (selectedVideoIds.length === 0) {
      setStatus('请选择要推送的视频');
      return;
    }

    try {
      setStatus('正在推送视频...');
      await createUserAssignment({
        userId,
        videoIds: selectedVideoIds
      });
      setSelectedVideoIds([]);
      await loadAssignments();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleCancelAssignment(assignmentId) {
    try {
      setStatus('正在取消推送...');
      await cancelUserAssignment(assignmentId);
      await loadAssignments();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleUpdateMessage(event) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
      setStatus(`留言最多 ${MESSAGE_MAX_LENGTH} 个字`);
      return;
    }

    try {
      setStatus('正在更新留言...');
      await updateUserAssignmentMessage({ userId, message: trimmedMessage });
      await loadAssignments();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleSoftDeleteAssignment(assignment) {
    const reason = window.prompt('请输入删除原因，例如：手误');

    if (reason === null) {
      return;
    }

    try {
      await softDeleteAssignment({ id: assignment.id, reason });
      await loadAssignments();
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!user) {
    return <p className="empty-text">{status}</p>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>{user.username} 的推送记录</h1>
          <p>管理员可以搜索视频并给这个用户推送今日作业，历史记录删除后只会变灰并保留原因。</p>
        </div>
        <a className="hero-button" href="/admin/users">返回用户管理</a>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>正在推送的视频</h2>
          <span>{activeVideos.length}/{MAX_ACTIVE_VIDEO_ASSIGNMENTS}</span>
        </div>

        <div className="admin-table">
          {activeVideos.map((video) => (
            <article className="admin-row" key={video.assignment_id}>
              <div>
                <strong>{video.title}</strong>
                <span>{video.description || '暂无介绍'}</span>
                <span>推送时间：{formatDate(video.created_at)}</span>
              </div>
              <div className="row-actions">
                <a href={`/videos/${video.id}?from=admin&returnTo=${encodeURIComponent(`/admin/users/${userId}/assignments`)}`}>查看视频</a>
                <button type="button" onClick={() => handleCancelAssignment(video.assignment_id)}>取消推送</button>
              </div>
            </article>
          ))}
        </div>

        {activeVideos.length === 0 ? <p className="empty-text">还没有正在推送的视频。</p> : null}
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>选择推荐视频</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新视频</button>
        </div>
        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList videos={videos} status={listStatus} canSelect selectedIds={selectedVideoIds} onSelect={handleToggleVideo} detailQuery={`?from=admin&returnTo=${encodeURIComponent(`/admin/users/${userId}/assignments`)}`} />
      </section>

      <section className="upload-panel">
        <h2>新增视频推送</h2>
        <form className="upload-form" onSubmit={handleCreateAssignment}>
          <label>
            <span>已选视频数量</span>
            <input value={`${selectedVideoIds.length} 个`} readOnly />
            <small>同一个用户最多只能同时存在 {MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个正在推送的视频。</small>
          </label>

          <button type="submit">推送选中视频</button>
          <p className="status-text">{status}</p>
        </form>
      </section>

      <section className="upload-panel">
        <h2>留言板</h2>
        <form className="upload-form" onSubmit={handleUpdateMessage}>
          <label>
            <span>留言</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows="4" maxLength={MESSAGE_MAX_LENGTH} placeholder="写给这个用户的留言" />
            <small>留言最多 {MESSAGE_MAX_LENGTH} 个字，保存后会独立更新用户首页留言板。</small>
          </label>

          <button type="submit">保存留言</button>
        </form>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>历史推送</h2>
          <button type="button" onClick={loadAssignments}>刷新</button>
        </div>

        <div className="admin-table">
          {assignments.map((assignment) => (
            <article className={`admin-row ${assignment.is_deleted ? 'assignment-deleted' : ''}`} key={assignment.id}>
              <div>
                <strong>{assignment.video_title || '未推荐视频'}</strong>
                <span>留言：{assignment.message || '未留言'}</span>
                <span>创建：{formatDate(assignment.created_at)} · 管理员：{assignment.admin_username || '未知'}</span>
                {assignment.is_deleted ? <span>已删除：{assignment.delete_reason}</span> : null}
              </div>
              <div className="row-actions">
                {assignment.video_id ? <a href={`/videos/${assignment.video_id}?from=admin&returnTo=${encodeURIComponent(`/admin/users/${userId}/assignments`)}`}>查看视频</a> : null}
                {assignment.is_deleted ? null : (
                  <button type="button" onClick={() => handleSoftDeleteAssignment(assignment)}>删除记录</button>
                )}
              </div>
            </article>
          ))}
        </div>

        {assignments.length === 0 ? <p className="empty-text">还没有推送记录。</p> : null}
      </section>
    </>
  );
}
