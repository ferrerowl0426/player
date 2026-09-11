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
  fetchUserAssignments,
  fetchTrackLibrary,
  fetchKnowledgeLibrary
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
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [contentOptions, setContentOptions] = useState({ tracks: [], collections: [], points: [], knowledgeCollections: [] });
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
          loadVideos(EMPTY_VIDEO_FILTERS),
          fetchTrackLibrary().then((result) => fetchKnowledgeLibrary().then((knowledge) => setContentOptions({ tracks: result.data.track_points || [], collections: result.data.track_collections || [], points: knowledge.data.points || [], knowledgeCollections: knowledge.data.knowledge_collections || [] })))
        ]);
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router, userId]);

  function handleToggleVideo(video) {
    const object = { objectType: 'video', objectId: video.id };
    setSelectedObjects((current) => current.some((item) => item.objectType === object.objectType && item.objectId === object.objectId) ? current.filter((item) => item.objectId !== object.objectId || item.objectType !== object.objectType) : [...current, object]);
  }

  function handleToggleObject(objectType, objectId) {
    setSelectedObjects((current) => current.some((item) => item.objectType === objectType && item.objectId === objectId) ? current.filter((item) => item.objectId !== objectId || item.objectType !== objectType) : [...current, { objectType, objectId }]);
  }

  async function handleSaveAssignment(event) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (selectedObjects.length === 0 && !trimmedMessage) {
      setStatus('请选择要推送的内容或填写作业备注');
      return;
    }

    if (trimmedMessage.length > MESSAGE_MAX_LENGTH) {
      setStatus(`作业备注最多 ${MESSAGE_MAX_LENGTH} 个字`);
      return;
    }

    try {
      setStatus('正在保存学生主页设置...');
      await createUserAssignment({ userId, objects: selectedObjects, message: trimmedMessage });
      setSelectedObjects([]);
      await loadAssignments();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleCancelAssignment(assignmentId) {
    try {
      setStatus('正在取消置顶...');
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

  const activeVideoIds = activeVideos.map((item) => item.id);
  const contentGroups = [
    ['曲目', 'track_point', contentOptions.tracks], ['曲谱集', 'track_collection', contentOptions.collections],
    ['知识点', 'knowledge_point', contentOptions.points], ['知识点集', 'knowledge_collection', contentOptions.knowledgeCollections]
  ];

  return (
    <>
      <section className="hero">
        <div>
          <h1>{user.username} 的主页课程设置</h1>
          <p>老师可以编辑学生主页置顶的课程视频，并填写作业备注。一次保存会生成一条操作记录。</p>
        </div>
        <a className="hero-button" href="/admin/users">{admin?.role === 'super_admin' ? '返回学员管理' : '返回班级学员'}</a>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>学生主页置顶的课程视频</h2>
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

        {activeVideos.length === 0 ? <p className="empty-text">还没有学生主页置顶课程视频。</p> : null}
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>选择课程视频</h2>
          <button type="button" onClick={() => loadVideos(filters)}>刷新课程</button>
        </div>
        <VideoFilters filters={filters} onChange={setFilters} onSubmit={handleSearch} onReset={handleReset} />
        <VideoList
          videos={videos}
          status={listStatus}
          canSelect
          selectedIds={selectedObjects.filter((item) => item.objectType === 'video').map((item) => item.objectId)}
          disabledIds={activeVideoIds}
          disabledSelectText="已置顶"
          selectText="选择置顶"
          selectedText="已选择"
          onSelect={handleToggleVideo}
          detailQuery={`?from=admin&returnTo=${encodeURIComponent(`/admin/users/${userId}/assignments`)}`}
        />
        {contentGroups.map(([label, type, items]) => (
          <div key={type} className="assignment-block"><h3>选择{label}</h3><div className="message-list">{items.map((item) => <button type="button" className="select-button" key={item.id} onClick={() => handleToggleObject(type, item.id)}>{selectedObjects.some((selected) => selected.objectType === type && selected.objectId === item.id) ? '已选择' : `选择${label}`}：{item.name}</button>)}</div></div>
        ))}
        <h2>保存主页课程设置</h2>
        <form className="upload-form" onSubmit={handleSaveAssignment}>
          <label>
            <span>已选推送对象数量</span>
            <input value={`${selectedObjects.length} 个`} readOnly />
            <small>同一个学员最多只能同时存在 {MAX_ACTIVE_VIDEO_ASSIGNMENTS} 个推送对象。</small>
          </label>

          <label>
            <span>作业备注</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows="4" maxLength={MESSAGE_MAX_LENGTH} placeholder="写给这个学员的作业备注" />
            <small>作业备注最多 {MESSAGE_MAX_LENGTH} 个字。</small>
          </label>

          <button type="submit">保存设置</button>
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
              description = `老师${operation.admin_username}给学员${user.username}编辑了 ${operation.videos.length} 个主页置顶课程视频，并填写作业备注：`;
            } else if (!hasVideos && hasMessage) {
              description = `老师${operation.admin_username}单独修改了作业备注：`;
            } else {
              description = `老师${operation.admin_username}单独编辑了 ${operation.videos.length} 个主页置顶课程视频：`;
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
                        <div
                          key={video.assignment_id}
                          className={`operation-video-item operation-video-title-only ${video.is_deleted || video.is_video_deleted ? 'operation-video-deleted' : ''}`}
                          title={video.title}
                        >
                          <span className="operation-video-title">{video.title}</span>
                        </div>
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
