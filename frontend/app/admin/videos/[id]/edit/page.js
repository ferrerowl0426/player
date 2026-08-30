'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  abortMultipartVideoUpload,
  completeMultipartVideoUpload,
  createEditVideoUpload,
  fetchAdminMe,
  fetchVideoById,
  fetchVideos,
  updateVideo,
  uploadFileToBucket
} from '../../../../../lib/api.js';
import {
  DESCRIPTION_MAX_LENGTH,
  formatFileSize,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE,
  MAX_COVER_SIZE,
  MAX_VIDEO_SIZE,
  TITLE_MAX_LENGTH,
  uploadVideoByMultipart
} from '../../../../../components/uploadVideo.js';

function getPreviewUrl(file) {
  return file ? URL.createObjectURL(file) : '';
}

function toFileList(files) {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => dataTransfer.items.add(file));
  return dataTransfer.files;
}

export default function EditVideoPage() {
  const params = useParams();
  const router = useRouter();
  const videoId = params.id;
  const videoInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const addAttachmentsInputRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState({ video: 0, cover: 0, attachments: 0 });
  const [video, setVideo] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [addFiles, setAddFiles] = useState([]);
  const [prerequisiteKeyword, setPrerequisiteKeyword] = useState('');
  const [prerequisiteVideos, setPrerequisiteVideos] = useState([]);
  const [selectedPrerequisites, setSelectedPrerequisites] = useState([]);
  const [disabledPrerequisiteIds, setDisabledPrerequisiteIds] = useState(new Set());

  useEffect(() => {
    async function initPage() {
      try {
        const adminResult = await fetchAdminMe();

        if (adminResult.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }

        const [videoResult, videosResult] = await Promise.all([
          fetchVideoById(videoId),
          fetchVideos()
        ]);
        const currentVideo = videoResult.data;
        const nextDisabledIds = new Set((currentVideo.descendantVideoIds || []).map((id) => Number(id)));

        setVideo(currentVideo);
        setTitle(currentVideo.title || '');
        setDescription(currentVideo.description || '');
        setAttachments((currentVideo.attachments || []).map((attachment) => ({ ...attachment, action: 'keep', replacementFile: null })));
        setDisabledPrerequisiteIds(nextDisabledIds);
        setSelectedPrerequisites((currentVideo.prerequisites || []).filter((item) => !nextDisabledIds.has(Number(item.id))));
        setPrerequisiteVideos((videosResult.data || []).filter((item) => String(item.id) !== String(videoId)));
        setReady(true);
      } catch (error) {
        setStatus(error.message);
      }
    }

    initPage();
  }, [router, videoId]);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return;
    }

    const url = getPreviewUrl(coverFile);
    setCoverPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const visibleAttachmentCount = useMemo(() => {
    return attachments.filter((attachment) => attachment.action !== 'delete').length + addFiles.length;
  }, [attachments, addFiles]);

  async function loadPrerequisiteVideos(keyword) {
    try {
      const result = await fetchVideos({ keyword });
      setPrerequisiteVideos((result.data || []).filter((item) => String(item.id) !== String(videoId)));
    } catch (error) {
      setStatus(error.message);
    }
  }

  function togglePrerequisite(item) {
    if (disabledPrerequisiteIds.has(Number(item.id))) {
      return;
    }

    setSelectedPrerequisites((current) => {
      if (current.some((selected) => selected.id === item.id)) {
        return current.filter((selected) => selected.id !== item.id);
      }

      return [...current, item];
    });
  }

  function updateAttachment(id, changes) {
    setAttachments((current) => current.map((attachment) => (
      attachment.id === id ? { ...attachment, ...changes } : attachment
    )));
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

  function removeAddFile(index) {
    setAddFiles((current) => {
      const nextFiles = current.filter((_, currentIndex) => currentIndex !== index);

      if (addAttachmentsInputRef.current) {
        addAttachmentsInputRef.current.files = toFileList(nextFiles);
      }

      return nextFiles;
    });
  }

  function chooseReplacementAttachment(id) {
    window.alert('请选择新资料，上传后会覆盖当前资料。');
    document.getElementById(`attachment-replacement-${id}`)?.click();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setStatus('正在准备编辑上传...');
    setProgress({ video: 0, cover: 0, attachments: 0 });

    try {
      const replacementAttachments = attachments
        .filter((attachment) => attachment.action === 'replace' && attachment.replacementFile)
        .map((attachment) => attachment.replacementFile);
      const uploadAttachments = [...replacementAttachments, ...addFiles];
      const uploadResult = await createEditVideoUpload({ title, description, video: videoFile, cover: coverFile, attachments: uploadAttachments });
      const uploadInfo = uploadResult.data;

      if (videoFile && uploadInfo.video) {
        try {
          setStatus('正在分片直传新视频...');
          const parts = await uploadVideoByMultipart({
            file: videoFile,
            key: uploadInfo.video.key,
            uploadId: uploadInfo.video.uploadId,
            onProgress: (value) => setProgress((current) => ({ ...current, video: value }))
          });
          setStatus('正在合并新视频分片...');
          await completeMultipartVideoUpload({ key: uploadInfo.video.key, uploadId: uploadInfo.video.uploadId, parts });
        } catch (error) {
          await abortMultipartVideoUpload({ key: uploadInfo.video.key, uploadId: uploadInfo.video.uploadId }).catch(() => {});
          throw error;
        }
      }

      if (coverFile && uploadInfo.cover) {
        setStatus('正在直传新封面...');
        await uploadFileToBucket({
          uploadUrl: uploadInfo.cover.uploadUrl,
          file: coverFile,
          onProgress: (value) => setProgress((current) => ({ ...current, cover: value }))
        });
      }

      const completedAttachments = [];

      for (const [index, file] of uploadAttachments.entries()) {
        const attachmentInfo = uploadInfo.attachments[index];
        setStatus(`正在直传资料 ${index + 1}/${uploadAttachments.length}...`);
        await uploadFileToBucket({
          uploadUrl: attachmentInfo.uploadUrl,
          file,
          onProgress: (value) => setProgress((current) => ({ ...current, attachments: value }))
        });
        completedAttachments.push(attachmentInfo);
      }

      const replaceItems = attachments.filter((attachment) => attachment.action === 'replace' && attachment.replacementFile);
      const attachmentsPlan = {
        keepIds: attachments.filter((attachment) => attachment.action === 'keep').map((attachment) => attachment.id),
        deleteIds: attachments.filter((attachment) => attachment.action === 'delete').map((attachment) => attachment.id),
        replace: replaceItems.map((attachment, index) => ({
          oldAttachmentId: attachment.id,
          key: completedAttachments[index].key,
          fileName: completedAttachments[index].fileName,
          fileType: completedAttachments[index].fileType
        })),
        add: completedAttachments.slice(replaceItems.length).map((attachment) => ({
          key: attachment.key,
          fileName: attachment.fileName,
          fileType: attachment.fileType
        }))
      };

      setStatus('正在保存课程编辑...');
      await updateVideo({
        id: videoId,
        title,
        description,
        videoKey: uploadInfo.video?.key || '',
        coverKey: uploadInfo.cover?.key || '',
        attachments: attachmentsPlan,
        prerequisiteVideoIds: selectedPrerequisites.map((item) => item.id)
      });

      router.replace('/admin');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <p className={status ? 'error-text' : 'empty-text'}>{status || '正在加载课程编辑页...'}</p>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>编辑课程视频</h1>
          <p>编辑会更新原课程记录；不选择新视频或封面时，会保留原文件。</p>
        </div>
        <a className="hero-button" href="/admin">返回后台</a>
      </section>

      <section className="upload-panel upload-panel-compact edit-video-panel">
        <div className="upload-panel-head">
          <h2>课程内容</h2>
          <p>当前课程：{video.title}</p>
        </div>

        <form className="upload-form edit-video-form" onSubmit={handleSubmit}>
          <div className="edit-video-grid">
            <div className="edit-card edit-main-card">
              <label>
                <span>标题</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX_LENGTH} required />
                <small>标题最多 {TITLE_MAX_LENGTH} 个字，不能填写 null、undefined、NaN。</small>
              </label>

              <label>
                <span>视频介绍</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows="5" maxLength={DESCRIPTION_MAX_LENGTH} />
                <small>介绍最多 {DESCRIPTION_MAX_LENGTH} 个字。</small>
              </label>

              <label>
                <span>替换视频文件</span>
                <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(event) => setVideoFile(event.target.files?.[0] || null)} />
                {videoFile ? <span className="selected-file-row">{videoFile.name}<button className="file-remove-button" type="button" onClick={clearVideoFile}>移除视频</button></span> : null}
                <small>不选择表示保留旧视频。支持 mp4、webm、mov，最大 {formatFileSize(MAX_VIDEO_SIZE)}。</small>
              </label>

              <label>
                <span>替换封面图片</span>
                <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} />
                {coverFile ? <span className="selected-file-row">{coverFile.name}<button className="file-remove-button" type="button" onClick={clearCoverFile}>移除封面</button></span> : null}
                <small>不选择表示保留旧封面。支持 jpg、jpeg、png、webp，最大 {formatFileSize(MAX_COVER_SIZE)}。</small>
              </label>
            </div>

            <aside className="edit-card upload-preview-panel edit-preview-panel">
              <h3>编辑预览</h3>
              <div className="upload-preview-card edit-preview-card">
                <div className="cover-wrap upload-preview-cover">
                  {coverPreview ? <img alt="新封面预览" src={coverPreview} /> : <img alt={title} src={video.cover_url} />}
                </div>
                <div className="upload-preview-content">
                  <strong>{title || '课程标题预览'}</strong>
                  <p>{description || '暂无介绍'}</p>
                  <div className="upload-preview-meta">
                    <span>{videoFile ? `新视频：${videoFile.name}` : '保留旧视频'}</span>
                    <span>{coverFile ? `新封面：${coverFile.name}` : '保留旧封面'}</span>
                    <span>资料 {visibleAttachmentCount} 个</span>
                    <span>前置知识 {selectedPrerequisites.length} 个</span>
                  </div>
                  {selectedPrerequisites.length > 0 ? (
                    <div className="prerequisite-preview-list">
                      {selectedPrerequisites.map((item) => <span key={item.id}>{item.title}</span>)}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="edit-card edit-wide-section attachment-editor-card">
              <div className="edit-section-head">
                <div>
                  <strong>资料附件</strong>
                  <small>不删除就会自动保留；可以删除、替换或新增资料。</small>
                </div>
                <span>{visibleAttachmentCount}/{MAX_ATTACHMENT_COUNT}</span>
              </div>
              {attachments.length === 0 ? <p className="empty-text">暂无资料。</p> : null}
              <div className="attachment-editor-list">
                {attachments.map((attachment) => (
                  <div className={`plan-row attachment-editor-row ${attachment.action === 'delete' ? 'attachment-editor-row-deleted' : ''}`} key={attachment.id}>
                    <div className="plan-row-info">
                      <strong>{attachment.file_name}</strong>
                      <small>{attachment.action === 'delete' ? '保存后删除' : attachment.action === 'replace' ? '保存后替换' : '未操作'}</small>
                    </div>
                    <div className="plan-row-actions">
                      <button
                        type="button"
                        className={attachment.action === 'delete' ? 'secondary-button' : 'danger-button'}
                        onClick={() => updateAttachment(attachment.id, attachment.action === 'delete' ? { action: 'keep', replacementFile: null } : { action: 'delete', replacementFile: null })}
                      >
                        {attachment.action === 'delete' ? '撤销删除' : '删除资料'}
                      </button>
                      <button
                        type="button"
                        className="icon-action-button refresh-action-button"
                        aria-label="替换资料"
                        title="替换资料"
                        onClick={() => chooseReplacementAttachment(attachment.id)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                          <path d="M3 16v5h5" />
                          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                          <path d="M21 8V3h-5" />
                        </svg>
                      </button>
                      <input
                        id={`attachment-replacement-${attachment.id}`}
                        className="visually-hidden-file"
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.mp4"
                        onChange={(event) => updateAttachment(attachment.id, { action: 'replace', replacementFile: event.target.files?.[0] || null })}
                      />
                    </div>
                    {attachment.replacementFile ? <small>新资料：{attachment.replacementFile.name}</small> : null}
                  </div>
                ))}
              </div>

              <label className="add-attachment-field">
                <span>新增资料</span>
                <input ref={addAttachmentsInputRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.mp4" multiple onChange={(event) => {
                  const selectedFiles = Array.from(event.target.files || []);
                  setAddFiles((current) => {
                    const nextFiles = [...current, ...selectedFiles];
                    if (addAttachmentsInputRef.current) {
                      addAttachmentsInputRef.current.files = toFileList(nextFiles);
                    }
                    return nextFiles;
                  });
                }} />
                {addFiles.length > 0 ? (
                  <div className="attachment-chips">
                    {addFiles.map((file, index) => (
                      <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                        <span>{file.name}</span>
                        <button type="button" onClick={() => removeAddFile(index)}>移除</button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <small>最终资料最多 {MAX_ATTACHMENT_COUNT} 个，单个最大 {formatFileSize(MAX_ATTACHMENT_SIZE)}。</small>
              </label>
            </div>

            <div className="edit-card edit-wide-section prerequisite-picker prerequisite-editor-card">
              <div className="edit-section-head">
                <div>
                  <strong>前置知识点</strong>
                  <small>当前课程的所有子节点会自动置灰，不能选为前置知识。</small>
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
                {prerequisiteVideos.map((item) => {
                  const isSelected = selectedPrerequisites.some((selected) => selected.id === item.id);
                  const isDisabled = disabledPrerequisiteIds.has(Number(item.id));

                  return (
                    <button
                      className={`prerequisite-item ${isSelected ? 'prerequisite-item-selected' : ''} ${isDisabled ? 'prerequisite-item-disabled' : ''}`}
                      type="button"
                      key={item.id}
                      disabled={isDisabled}
                      onClick={() => togglePrerequisite(item)}
                    >
                      <span>{item.title}</span>
                      <small>{isDisabled ? '不可选' : isSelected ? '已选' : '未选'}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="edit-submit-row">
            <button type="submit" disabled={saving}>{saving ? '保存中...' : '保存编辑'}</button>
            <p className="status-text">{status}</p>
          </div>
          {saving ? (
            <div className="upload-progress-list">
              <label><span>视频上传 {progress.video}%</span><progress max="100" value={progress.video} /></label>
              <label><span>封面上传 {progress.cover}%</span><progress max="100" value={progress.cover} /></label>
              <label><span>资料上传 {progress.attachments}%</span><progress max="100" value={progress.attachments} /></label>
            </div>
          ) : null}
        </form>
      </section>
    </>
  );
}
