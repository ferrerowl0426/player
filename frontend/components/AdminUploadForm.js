'use client';

import { useState } from 'react';
import {
  DESCRIPTION_MAX_LENGTH,
  formatFileSize,
  MAX_COVER_SIZE,
  MAX_VIDEO_SIZE,
  TITLE_MAX_LENGTH,
  uploadVideoFromForm,
  validateUploadForm
} from './uploadVideo.js';

export default function AdminUploadForm({ onUploaded }) {
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ video: 0, cover: 0 });
  const [isUploading, setIsUploading] = useState(false);

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
    setUploadProgress({ video: 0, cover: 0 });

    try {
      await uploadVideoFromForm({
        formData,
        onStatus: setUploadStatus,
        onProgress: setUploadProgress
      });

      form.reset();
      setUploadStatus('上传成功！');
      await onUploaded();
    } catch (error) {
      setUploadStatus(error.message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
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
        {isUploading ? (
          <div className="upload-progress-list">
            <label>
              <span>视频上传 {uploadProgress.video}%</span>
              <progress max="100" value={uploadProgress.video} />
            </label>
            <label>
              <span>封面上传 {uploadProgress.cover}%</span>
              <progress max="100" value={uploadProgress.cover} />
            </label>
          </div>
        ) : null}
        <p className="status-text">{uploadStatus}</p>
      </form>
    </section>
  );
}
