'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
// TODO(M3 cleanup): 旧通用视频详情页仍使用 player-page/back-link/prerequisite-section；新版曲目/知识点详情稳定后删除这套旧入口。
import VideoPlayer from '../../../components/VideoPlayer.js';
import { fetchAdminMe, fetchUserMe, fetchVideoById } from '../../../lib/api.js';
import { isGuestMode } from '../../../lib/guest.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))}KB`;
  }

  return `${Math.round(value / 1024 / 1024)}MB`;
}

export default function VideoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isFromAdmin = searchParams.get('from') === 'admin';
  const returnTo = searchParams.get('returnTo');
  const backHref = returnTo || (isFromAdmin ? '/admin' : '/');
  const [video, setVideo] = useState(null);
  const [status, setStatus] = useState('正在检查登录状态...');

  useEffect(() => {
    async function loadVideoDetail() {
      try {
        // 游客模式不需要登录即可播放公开视频。
        if (!isGuestMode()) {
          if (isFromAdmin) {
            await fetchAdminMe();
          } else {
            await fetchUserMe();
          }
        }

        setStatus('正在加载视频...');

        const result = await fetchVideoById(params.id);
        setVideo(result.data);
        setStatus('');
      } catch (error) {
        if (error.message.includes('登录')) {
          router.replace(isFromAdmin ? '/admin/login' : '/login');
          return;
        }

        setStatus(error.message);
      }
    }

    loadVideoDetail();
  }, [isFromAdmin, params.id, router]);

  if (status) {
    return (
      <section className="player-page">
        <a className="back-link" href={backHref}>← 返回首页</a>
        <p className={status.includes('失败') ? 'error-text' : 'empty-text'}>{status}</p>
      </section>
    );
  }

  return (
    <section className="player-page">
      <a className="back-link" href={backHref}>← 返回首页</a>
      <VideoPlayer src={video.video_url} poster={video.cover_url} />
      <h1>{video.title}</h1>
      <p className="detail-time">发布时间：{formatDate(video.created_at)}</p>

      <div className="prerequisite-section">
        <h2>前置知识点</h2>
        {video.prerequisites?.length > 0 ? (
          <div className="prerequisite-link-list">
            {video.prerequisites.map((prerequisite) => (
              <a
                className="prerequisite-link"
                href={`/videos/${prerequisite.id}${isFromAdmin ? `?from=admin&returnTo=${encodeURIComponent(backHref)}` : ''}`}
                key={prerequisite.id}
              >
                {prerequisite.title}
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-text">这个课程没有前置知识点。</p>
        )}
      </div>

      <div className="attachment-section">
        <h2>资料下载</h2>
        {video.attachments?.length > 0 ? (
          <div className="attachment-list">
            {video.attachments.map((attachment) => (
              <a className="attachment-item" href={attachment.file_url} target="_blank" rel="noreferrer" key={attachment.id}>
                <strong>{attachment.file_name}</strong>
                <span>{formatFileSize(attachment.file_size)}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-text">这个视频还没有资料附件。</p>
        )}
      </div>

      <p className="detail-desc">{video.description || '暂无介绍'}</p>
    </section>
  );
}
