'use client';

import Image from 'next/image';
import Link from 'next/link';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

export default function VideoList({
  videos,
  status,
  canDelete = false,
  onDelete,
  canEdit = false,
  editHrefBuilder,
  canSelect = false,
  selectedId = null,
  selectedIds = [],
  disabledIds = [],
  disabledSelectText = '已置顶',
  selectText = '选择',
  selectedText = '已选择',
  onSelect,
  detailQuery = ''
}) {
  if (status) {
    return <p className={status.includes('失败') ? 'error-text' : 'empty-text'}>{status}</p>;
  }

  return (
    <div className="video-grid">
      {videos.map((video) => {
        const isSelected = selectedIds.length > 0 ? selectedIds.includes(video.id) : selectedId === video.id;
        const isDisabled = disabledIds.includes(video.id);
        const cardClassName = [
          'video-card',
          isSelected ? 'video-card-selected' : '',
          isDisabled ? 'video-card-disabled' : ''
        ].filter(Boolean).join(' ');

        return (
          <article className={cardClassName} key={video.id}>
            <Link className="video-link" href={`/videos/${video.id}${detailQuery}`}>
              <div className="cover-wrap">
                <Image src={video.cover_url} alt={video.title} width={320} height={180} unoptimized />
              </div>
              <h3>{video.title}</h3>
              <p>{video.description || '暂无介绍'}</p>
              <time>{formatDate(video.created_at)}</time>
            </Link>
            {canSelect ? (
              <button className="select-button" type="button" disabled={isDisabled} onClick={() => onSelect(video)}>
                {isDisabled ? disabledSelectText : isSelected ? selectedText : selectText}
              </button>
            ) : null}
            {canEdit ? (
              <Link className="select-button" href={editHrefBuilder ? editHrefBuilder(video) : `/admin/videos/${video.id}/edit`}>编辑课程</Link>
            ) : null}
            {canDelete ? (
              <button className="delete-button" type="button" onClick={() => onDelete(video)}>删除视频</button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
