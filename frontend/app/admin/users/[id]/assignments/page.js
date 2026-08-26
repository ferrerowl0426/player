'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import VideoFilters from '../../../../../components/VideoFilters.js';
import VideoList from '../../../../../components/VideoList.js';
import {
  cancelUserAssignment,
  createUserAssignment,
  deleteOperation,
  fetchAdminMe,
  fetchUserAssignments
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
  const [admin, setAdmin] = useState(null);
  const [user, setUser] = useState(null);
  const [operations, setOperations] = useState([]);
  const [activeVideos, setActiveVideos] = useState([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('正在检查老师登录状态...');
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
    setOperations(result.data.operations || []);
    setActiveVideos(result.data.activeVideos || []);
    setMessage(result.data.message || '');
    setStatus('');
  }

  useEffect(() => {
    async function initPage() {
      try {
        const me = await fetchAdminMe();
        setAdmin(me.data);
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
        setStatus(`同一个学员最多只能同时推送 ${MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个视频`);
        return current;
      }

      setStatus('');
      return [...current, video.id];
    });
  }

  async function handleSaveAssignment(event) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (selectedVideoIds.length === 0 && !trimmedMessage) {
      setStatus('请选择要推送的视频或填写留言');
      return;
    }

    if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
      setStatus(`留言最多 ${MESSAGE_MAX_LENGTH} 个字`);
      return;
    }

    try {
      setStatus('正在保存推送...');
      await createUserAssignment({
        userId,
        videoIds: selectedVideoIds,
        message: trimmedMessage
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

  async function handleDeleteOperation(operationId) {
    const reason = window.prompt('请输入删除原因，例如：手误');

    if (reason === null || reason.trim() === '') {
      return;
    }

    try {
      setStatus('正在删除操作记录...');
      await deleteOperation({ operationId, reason: reason.trim() });
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
          <p>老师选择推荐视频并填写留言后，一次保存会生成一条操作记录。</p>
        </div>
        <a className="hero-button" href="/admin/users">{admin?.role === 'super_admin' ? '返回学员管理' : '返回班级学员'}</a>
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
        <h2>保存推送</h2>
        <form className="upload-form" onSubmit={handleSaveAssignment}>
          <label>
            <span>已选视频数量</span>
            <input value={`${selectedVideoIds.length} 个`} readOnly />
            <small>同一个学员最多只能同时存在 {MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个正在推送的视频。</small>
          </label>

          <label>
            <span>留言</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows="4" maxLength={MESSAGE_MAX_LENGTH} placeholder="写给这个学员的留言" />
            <small>留言最多 {MESSAGE_MAX_LENGTH} 个字。</small>
          </label>

          <button type="submit">保存推送</button>
          <p className="status-text">{status}</p>
        </form>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>历史操作</h2>
          <button type="button" onClick={loadAssignments}>刷新</button>
        </div>

        <div className="operations-list">
          {operations.map((operation) => {
            const hasVideos = operation.videos && operation.videos.length > 0;
            const hasMessage = operation.message && operation.message.trim();
            const isDeleted = operation.is_deleted;

            let description;
            if (hasVideos && hasMessage) {
              description = `老师${operation.admin_username}给学员${user.username}把推送更新为以下 ${operation.videos.length} 个视频，并留言：`;
            } else if (!hasVideos && hasMessage) {
              description = `老师${operation.admin_username}单独修改了留言：`;
            } else {
              description = `老师${operation.admin_username}单独更新了视频推送为以下 ${operation.videos.length} 个视频：`;
            }

            return (
              <article className={`operation-card ${isDeleted ? 'operation-deleted' : ''}`} key={operation.operation_id}>
                <div className="operation-header">
                  <div className="operation-meta">
                    <span className="operation-id">#{operation.operation_id}</span>
                    <span className="operation-time">{formatDate(operation.created_at)}</span>
                  </div>
                  {!isDeleted ? (
                    <button type="button" className="operation-delete-button" onClick={() => handleDeleteOperation(operation.operation_id)}>删除记录</button>
                  ) : (
                    <span className="operation-delete-reason">已删除：{operation.delete_reason || '记录已删除'}</span>
                  )}
                </div>

                <div className="operation-body">
                  <p className="operation-description">{description}</p>

                  {hasMessage ? (
                    <blockquote className="operation-message">{operation.message}</blockquote>
                  ) : null}

                  {hasVideos ? (
                    <div className="operation-videos">
                      {operation.videos.map((video) => (
                        <a
                          key={video.assignment_id}
                          className={`operation-video-item ${video.is_deleted ? 'operation-video-deleted' : ''}`}
                          href={video.is_deleted ? undefined : `/videos/${video.id}?from=admin&returnTo=${encodeURIComponent(`/admin/users/${userId}/assignments`)}`}
                          title={video.title}
                        >
                          {video.cover_url ? (
                            <div className="operation-video-thumb">
                              <img src={video.cover_url} alt={video.title} />
                            </div>
                          ) : (
                            <div className="operation-video-thumb operation-video-placeholder">无封面</div>
                          )}
                          <span className="operation-video-title">{video.title}</span>
                          {video.is_deleted ? <span className="operation-video-reason">已删除</span> : null}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {operations.length === 0 ? <p className="empty-text">还没有历史操作。</p> : null}
      </section>
    </>
  );
}
