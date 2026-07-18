'use client';

import Image from 'next/image';
import Link from 'next/link';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

export default function VideoList({ videos, status, canDelete = false, onDelete }) {
  if (status) {
    return <p className={status.includes('失败') ? 'error-text' : 'empty-text'}>{status}</p>;
  }

  return (
    <div className="video-grid">
      {videos.map((video) => (
        <article className="video-card" key={video.id}>
          <Link className="video-link" href={`/videos/${video.id}`}>
            <div className="cover-wrap">
              <Image src={video.cover_url} alt={video.title} width={320} height={180} unoptimized />
            </div>
            <h3>{video.title}</h3>
            <p>{video.description || '暂无介绍'}</p>
            <time>{formatDate(video.created_at)}</time>
          </Link>
          {canDelete ? (
            <button className="delete-button" type="button" onClick={() => onDelete(video.id)}>删除视频</button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
