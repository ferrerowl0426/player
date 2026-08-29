'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchVideos } from '../lib/api.js';
import {
  DESCRIPTION_MAX_LENGTH,
  formatFileSize,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE,
  MAX_COVER_SIZE,
  MAX_VIDEO_SIZE,
  TITLE_MAX_LENGTH,
  uploadVideoFromForm,
  validateUploadForm
} from './uploadVideo.js';

function getPreviewUrl(file) {
  return file ? URL.createObjectURL(file) : '';
}

export default function AdminUploadForm({ onUploaded, compact = false }) {
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ video: 0, cover: 0, attachments: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [coverPreview, setCoverPreview] = useState('');
  const videoInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const attachmentsInputRef = useRef(null);
  const [prerequisiteKeyword, setPrerequisiteKeyword] = useState('');
  const [prerequisiteVideos, setPrerequisiteVideos] = useState([]);
  const [selectedPrerequisites, setSelectedPrerequisites] = useState([]);
  const [prerequisiteStatus, setPrerequisiteStatus] = useState('');

  useEffect(() => {
    loadPrerequisiteVideos('');
  }, []);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return;
    }

    const url = getPreviewUrl(coverFile);
    setCoverPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const titlePreview = title || '视频标题预览';
  const descriptionPreview = description || '这里会显示视频简介预览内容。';
  const metaPreview = useMemo(() => {
    const videoName = videoFile?.name || '未选择视频文件';
    const coverName = coverFile?.name || '未选择封面图片';
    return { videoName, coverName };
  }, [videoFile, coverFile]);

  async function loadPrerequisiteVideos(keyword) {
    try {
      setPrerequisiteStatus('正在加载课程视频...');
      const result = await fetchVideos({ keyword });
      setPrerequisiteVideos(result.data || []);
      setPrerequisiteStatus('');
    } catch (error) {
      setPrerequisiteStatus(error.message);
    }
  }

  function handleTogglePrerequisite(video) {
    setSelectedPrerequisites((current) => {
      if (current.some((item) => item.id === video.id)) {
        return current.filter((item) => item.id !== video.id);
      }

      return [...current, video];
    });
  }

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
    setUploadProgress({ video: 0, cover: 0, attachments: 0 });

    try {
      await uploadVideoFromForm({
        formData,
        onStatus: setUploadStatus,
        onProgress: setUploadProgress
      });

      form.reset();
      setTitle('');
      setDescription('');
      setVideoFile(null);
      setCoverFile(null);
      setAttachmentFiles([]);
      setSelectedPrerequisites([]);
      setUploadStatus('上传成功！');
      await onUploaded();
    } catch (error) {
      setUploadStatus(error.message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFieldChange(event) {
    const { name, files, value } = event.target;

    if (name === 'title') {
      setTitle(value);
    }

    if (name === 'description') {
      setDescription(value);
    }

    if (name === 'video') {
      setVideoFile(files?.[0] || null);
    }

    if (name === 'cover') {
      setCoverFile(files?.[0] || null);
    }

    if (name === 'attachments') {
      setAttachmentFiles(Array.from(files || []));
    }
  }

  function clearVideoFile() {
    setVideoFile(null);

    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  }

  function clearCoverFile() {
    setCoverFile(null);

    if (coverInputRef.current) {
      coverInputRef.current.value = '';
    }
  }

  function syncAttachmentInput(files) {
    if (!attachmentsInputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    attachmentsInputRef.current.files = dataTransfer.files;
  }

  function removeAttachmentFile(index) {
    setAttachmentFiles((current) => {
      const nextFiles = current.filter((_, currentIndex) => currentIndex !== index);
      syncAttachmentInput(nextFiles);
      return nextFiles;
    });
  }

  return (
    <section className={compact ? 'upload-panel upload-panel-compact edit-video-panel' : 'upload-panel edit-video-panel'}>
      <div className="upload-panel-head">
        <h2>上传视频</h2>
        <p>右侧预览会同步显示封面、标题和简介的最终展示效果。</p>
      </div>

      <form className="upload-form edit-video-form" onSubmit={handleUpload}>
        <div className="edit-video-grid">
          <div className="edit-card edit-main-card">
            <label>
              <span>标题</span>
              <input name="title" type="text" placeholder="请输入视频标题" maxLength={TITLE_MAX_LENGTH} required onChange={handleFieldChange} />
              <small>标题最多 {TITLE_MAX_LENGTH} 个字，不能填写 null、undefined、NaN。</small>
            </label>

            <label>
              <span>视频介绍</span>
              <textarea name="description" rows="5" placeholder="介绍一下这个视频" maxLength={DESCRIPTION_MAX_LENGTH} onChange={handleFieldChange} />
              <small>介绍最多 {DESCRIPTION_MAX_LENGTH} 个字。</small>
            </label>

            <label>
              <span>视频文件</span>
              <input ref={videoInputRef} name="video" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" required onChange={handleFieldChange} />
              {videoFile ? <span className="selected-file-row">{videoFile.name}<button className="file-remove-button" type="button" onClick={clearVideoFile}>移除视频</button></span> : null}
              <small>视频支持 mp4、webm、mov，最大 {formatFileSize(MAX_VIDEO_SIZE)}。</small>
            </label>

            <label>
              <span>封面图片</span>
              <input ref={coverInputRef} name="cover" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required onChange={handleFieldChange} />
              {coverFile ? <span className="selected-file-row">{coverFile.name}<button className="file-remove-button" type="button" onClick={clearCoverFile}>移除封面</button></span> : null}
              <small>封面必须上传，支持 jpg、jpeg、png、webp，最大 {formatFileSize(MAX_COVER_SIZE)}。</small>
            </label>
          </div>

          <aside className="edit-card upload-preview-panel edit-preview-panel">
            <h3>显示预览</h3>
            <div className="upload-preview-card edit-preview-card">
              <div className="cover-wrap upload-preview-cover">
                {coverPreview ? <img alt="封面预览" src={coverPreview} /> : <div className="operation-video-placeholder">封面预览</div>}
              </div>
              <div className="upload-preview-content">
                <strong>{titlePreview}</strong>
                <p>{descriptionPreview}</p>
                <div className="upload-preview-meta">
                  <span>{metaPreview.videoName}</span>
                  <span>{metaPreview.coverName}</span>
                  <span>附件 {attachmentFiles.length} 个</span>
                  <span>前置知识 {selectedPrerequisites.length} 个</span>
                </div>
                {selectedPrerequisites.length > 0 ? (
                  <div className="prerequisite-preview-list">
                    {selectedPrerequisites.map((video) => (
                      <span key={video.id}>{video.title}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <div className="edit-card edit-wide-section attachment-editor-card">
            <div className="edit-section-head">
              <div>
                <strong>资料附件</strong>
                <small>资料可选，可以上传多个附件。</small>
              </div>
              <span>{attachmentFiles.length}/{MAX_ATTACHMENT_COUNT}</span>
            </div>
            <label className="add-attachment-field">
              <span>上传资料</span>
              <input ref={attachmentsInputRef} name="attachments" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.mp4" multiple onChange={handleFieldChange} />
              {attachmentFiles.length > 0 ? (
                <div className="attachment-chips">
                  {attachmentFiles.map((file, index) => (
                    <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                      <span>{file.name}</span>
                      <button type="button" onClick={() => removeAttachmentFile(index)}>移除</button>
                    </span>
                  ))}
                </div>
              ) : null}
              <small>最多 {MAX_ATTACHMENT_COUNT} 个，单个最大 {formatFileSize(MAX_ATTACHMENT_SIZE)}，会直传对象存储。</small>
            </label>
          </div>

          <div className="edit-card edit-wide-section prerequisite-picker prerequisite-editor-card">
            <div className="edit-section-head">
              <div>
                <strong>前置知识点</strong>
                <small>可选，可以选择多个已有课程视频作为前置知识。</small>
              </div>
              <span>已选 {selectedPrerequisites.length}</span>
            </div>
            <div className="filter-form prerequisite-search edit-prerequisite-search">
              <label>
                <span>搜索课程</span>
                <input value={prerequisiteKeyword} onChange={(event) => setPrerequisiteKeyword(event.target.value)} placeholder="输入课程标题或简介" />
              </label>
              <div className="filter-actions">
                <button type="button" onClick={() => loadPrerequisiteVideos(prerequisiteKeyword)}>搜索</button>
                <button type="button" className="secondary-button" onClick={() => {
                  setPrerequisiteKeyword('');
                  loadPrerequisiteVideos('');
                }}>重置</button>
              </div>
            </div>
            <div className="prerequisite-list edit-prerequisite-list">
              {prerequisiteVideos.map((video) => {
                const isSelected = selectedPrerequisites.some((item) => item.id === video.id);

                return (
                  <button
                    type="button"
                    className={`prerequisite-item ${isSelected ? 'prerequisite-item-selected' : ''}`}
                    key={video.id}
                    onClick={() => handleTogglePrerequisite(video)}
                  >
                    <span>{video.title}</span>
                    <small>{isSelected ? '已选' : '未选'}</small>
                  </button>
                );
              })}
            </div>
            {prerequisiteStatus ? <p className="status-text">{prerequisiteStatus}</p> : null}
            {selectedPrerequisites.map((video) => (
              <input key={video.id} type="hidden" name="prerequisiteVideoIds" value={video.id} />
            ))}
          </div>
        </div>

        <div className="edit-submit-row">
          <button type="submit" disabled={isUploading}>{isUploading ? '上传中...' : '开始上传'}</button>
          <p className="status-text">{uploadStatus}</p>
        </div>
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
            <label>
              <span>资料上传 {uploadProgress.attachments}%</span>
              <progress max="100" value={uploadProgress.attachments} />
            </label>
          </div>
        ) : null}
      </form>
    </section>
  );
}
