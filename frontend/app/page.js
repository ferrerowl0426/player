'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { deleteVideo, fetchVideos, uploadVideo } from '../lib/api.js';

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 1000;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const INVALID_TEXT_VALUES = ['null', 'undefined', 'nan'];

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

function formatFileSize(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function isInvalidTextValue(value) {
  return INVALID_TEXT_VALUES.includes(value.trim().toLowerCase());
}

function validateUploadForm(formData) {
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const video = formData.get('video');
  const cover = formData.get('cover');

  if (!title) {
    return '请填写视频标题';
  }

  if (isInvalidTextValue(title)) {
    return '视频标题不能是 null、undefined、NaN 这类无意义内容';
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return `视频标题最多 ${TITLE_MAX_LENGTH} 个字`;
  }

  if (description && isInvalidTextValue(description)) {
    return '视频介绍不能是 null、undefined、NaN 这类无意义内容';
  }

  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return `视频介绍最多 ${DESCRIPTION_MAX_LENGTH} 个字`;
  }

  if (!video || video.size === 0) {
    return '请上传视频文件';
  }

  if (video.size > MAX_VIDEO_SIZE) {
    return `视频文件不能超过 ${formatFileSize(MAX_VIDEO_SIZE)}`;
  }

  if (!cover || cover.size === 0) {
    return '请上传封面图片';
  }

  if (cover.size > MAX_COVER_SIZE) {
    return `封面图片不能超过 ${formatFileSize(MAX_COVER_SIZE)}`;
  }

  return '';
}

export default function HomePage() {
  const [videos, setVideos] = useState([]);
  const [listStatus, setListStatus] = useState('正在加载视频...');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  async function loadVideos() {
    setListStatus('正在加载视频...');

    try {
      const result = await fetchVideos();
      setVideos(result.data);
      setListStatus(result.data.length === 0 ? '还没有视频，先上传一个吧。' : '');
    } catch (error) {
      setVideos([]);
      setListStatus(error.message);
    }
  }

  useEffect(() => {
    loadVideos();
  }, []);

  async function handleUpload(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const validationMessage = validateUploadForm(formData);

    if (validationMessage) {
      setUploadStatus(validationMessage);
      return;
    }

    setIsUploading(true);
    setUploadStatus('正在上传，请不要关闭页面...');

    try {
      await uploadVideo(formData);
      form.reset();
      setUploadStatus('上传成功！');
      await loadVideos();
    } catch (error) {
      setUploadStatus(error.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(videoId) {
    const confirmed = window.confirm('确定要删除这个视频吗？删除后数据库记录、视频文件和封面都会被删除。');

    if (!confirmed) {
      return;
    }

    try {
      await deleteVideo(videoId);
      await loadVideos();
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>视频首页</h1>
          <p>上传视频后，会像哔哩哔哩首页一样以卡片形式平铺展示。</p>
        </div>
      </section>

      <section className="upload-panel">
        <h2>上传视频</h2>
        <form className="upload-form" onSubmit={handleUpload}>
          <label>
            <span>标题</span>
            <input name="title" type="text" placeholder="请输入视频标题" maxLength={TITLE_MAX_LENGTH} required />
            <small>标题最多 {TITLE_MAX_LENGTH} 个字，不能填写 null、undefined、NaN。</small>
          </label>

          <label>
            <span>视频介绍</span>
            <textarea name="description" rows="4" placeholder="介绍一下这个视频" maxLength={DESCRIPTION_MAX_LENGTH} />
            <small>介绍最多 {DESCRIPTION_MAX_LENGTH} 个字。</small>
          </label>

          <label>
            <span>视频文件</span>
            <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" required />
            <small>视频支持 mp4、webm、mov，最大 {formatFileSize(MAX_VIDEO_SIZE)}。</small>
          </label>

          <label>
            <span>封面图片</span>
            <input name="cover" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required />
            <small>封面必须上传，支持 jpg、jpeg、png、webp，最大 {formatFileSize(MAX_COVER_SIZE)}。</small>
          </label>

          <button type="submit" disabled={isUploading}>{isUploading ? '上传中...' : '开始上传'}</button>
          <p className="status-text">{uploadStatus}</p>
        </form>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>最新视频</h2>
          <button type="button" onClick={loadVideos}>刷新</button>
        </div>

        {listStatus ? (
          <p className={listStatus.includes('失败') ? 'error-text' : 'empty-text'}>{listStatus}</p>
        ) : (
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
                <button className="delete-button" type="button" onClick={() => handleDelete(video.id)}>删除视频</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
