'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import {
  abortTrackPartUpload,
  completeTrackPartUpload,
  createLibraryUploadUrl,
  createTrack,
  createTrackAttachmentUploadUrl,
  createTrackPartUpload,
  createTrackPartUploadUrl,
  deleteTrack,
  deleteTrackPart,
  fetchAdminMe,
  fetchKnowledgeLibrary,
  fetchLibraryResourceById,
  fetchLibraryResources,
  fetchPrerequisites,
  fetchTrackById,
  fetchTrackLibrary,
  savePrerequisites,
  saveTrackAttachments,
  saveTrackPart,
  saveLibraryResourceLinks,
  updateTrack,
  updateTrackPart,
  uploadLibraryFileToBucket,
  uploadMultipartPartToBucket
} from '../../../lib/api.js';
import { uploadVideoByMultipart } from '../../../components/uploadVideo.js';

const DRAFT_KEY = 'admin:create:tracks:draft';

function makePart(partNo = '') {
  return { id: null, part_no: partNo, title: '', duration: '', video: null, video_url: '' };
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function formatSize(value) {
  const size = Number(value) || 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function attachmentBadge(name = '') {
  const ext = name.split('.').pop()?.toUpperCase() || 'FILE';
  return ext.slice(0, 4);
}

function isDirectLibraryResource(item) {
  return item?.link_source !== 'inherited';
}

function isInheritedLibraryResource(item) {
  return item?.link_source === 'inherited';
}

function normalizeAttachment(item) {
  return {
    id: item.id || null,
    file_name: item.file_name || item.fileName || item.file?.name || '',
    file_url: item.file_url || item.fileUrl || '',
    file_key: item.file_key || item.fileKey || '',
    file_type: item.file_type || item.fileType || item.file?.type || '',
    file_size: item.file_size || item.fileSize || item.file?.size || 0,
    file: item.file || null
  };
}

function PartFileLabel({ part, onChange }) {
  const fileName = part.video?.name || (part.video_url ? '已上传视频' : '选择视频文件');

  return (
    <label className={`pfile${part.video || part.video_url ? ' has' : ''}`}>
      <span className="fn">{fileName}</span>
      <input type="file" accept="video/*" onChange={onChange} />
    </label>
  );
}

export default function AdminTracksPage() {
  return (
    <Suspense fallback={<p className="empty-text">正在加载曲目管理...</p>}>
      <AdminTracksContent />
    </Suspense>
  );
}

function AdminTracksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = Number(searchParams.get('id')) || null;
  const [admin, setAdmin] = useState(null);
  const [library, setLibrary] = useState({ track_points: [], track_collections: [] });
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ knowledge_points: [], knowledge_collections: [] });
  const [editingId, setEditingId] = useState(null);
  const [track, setTrack] = useState({ name: '', description: '', cover: '', parts: [], attachments: [] });
  const [prerequisites, setPrerequisites] = useState([]);
  const [linkedResources, setLinkedResources] = useState([]);
  const [originalLinkedResourceIds, setOriginalLinkedResourceIds] = useState([]);
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryResults, setLibraryResults] = useState([]);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [errors, setErrors] = useState({});
  const coverInputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const [prerequisiteKeyword, setPrerequisiteKeyword] = useState('');
  const [isPrerequisiteFocused, setIsPrerequisiteFocused] = useState(false);
  const [isLibraryFocused, setIsLibraryFocused] = useState(false);
  const [status, setStatus] = useState('正在检查登录状态...');
  const [busy, setBusy] = useState(false);

  const isEditing = Boolean(editingId);
  const nextPartNo = useMemo(() => (track.parts.reduce((max, part) => Math.max(max, Number(part.part_no) || 0), 0) + 1), [track.parts]);

  function clearError(field) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function patchTrack(patch) {
    setTrack((current) => ({ ...current, ...patch }));
    Object.keys(patch).forEach(clearError);
  }

  async function reloadLibrary() {
    const [trackResult, knowledgeResult] = await Promise.all([fetchTrackLibrary(''), fetchKnowledgeLibrary('')]);
    setLibrary(trackResult.data);
    setKnowledgeLibrary(knowledgeResult.data);
  }

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/tracks');
          return;
        }
        setAdmin(me.data);
        setDraftAvailable(Boolean(localStorage.getItem(DRAFT_KEY)));
        const resources = await fetchLibraryResources('');
        setLibraryResults(resources.data || []);
        await reloadLibrary();
        if (initialId) await editTrack(initialId);
        else setStatus('');
      } catch (error) {
        router.replace('/login');
      }
    }
    init();
  }, [router, initialId]);

  async function editTrack(id) {
    setStatus('正在加载曲目...');
    const [result, prerequisiteResult] = await Promise.all([
      fetchTrackById(id),
      fetchPrerequisites({ objectType: 'track_point', objectId: id }).catch(() => ({ data: [] }))
    ]);
    setEditingId(id);
    setTrack({ ...result.data, parts: result.data.parts.map((part) => ({ ...part, video: null })), attachments: (result.data.attachments || []).map(normalizeAttachment) });
    setPrerequisites(prerequisiteResult.data || []);
    setLinkedResources(result.data.library_resources || []);
    setOriginalLinkedResourceIds((result.data.library_resources || []).filter(isDirectLibraryResource).map((item) => item.id));
    setErrors({});
    setStatus('');
  }

  function startNewTrack() {
    setEditingId(null);
    setTrack({ name: '', description: '', cover: '', parts: [], attachments: [] });
    setPrerequisites([]);
    setLinkedResources([]);
    setOriginalLinkedResourceIds([]);
    setPrerequisiteKeyword('');
    setLibraryKeyword('');
    setErrors({});
    setStatus('');
  }

  function updatePart(index, patch) {
    setTrack((current) => ({ ...current, parts: current.parts.map((part, partIndex) => partIndex === index ? { ...part, ...patch } : part) }));
    clearError(`part-${index}`);
  }

  async function movePart(index, offset) {
    const target = index + offset;
    const currentParts = track.parts;
    if (target < 0 || target >= currentParts.length) return;

    const sourcePart = currentParts[index];
    const targetPart = currentParts[target];
    const sourceNo = sourcePart.part_no;
    const targetNo = targetPart.part_no;
    const sourcePersisted = sourcePart.id && !String(sourcePart.id).startsWith('uploaded-');
    const targetPersisted = targetPart.id && !String(targetPart.id).startsWith('uploaded-');

    if (editingId && sourcePersisted && targetPersisted) {
      try {
        const temporaryNo = Math.max(...currentParts.map((part) => Number(part.part_no) || 0), 0) + 1;
        await updateTrackPart({ trackId: editingId, partId: sourcePart.id, partNo: temporaryNo, title: sourcePart.title, duration: Number(sourcePart.duration) || 0 });
        await updateTrackPart({ trackId: editingId, partId: targetPart.id, partNo: Number(sourceNo), title: targetPart.title, duration: Number(targetPart.duration) || 0 });
        await updateTrackPart({ trackId: editingId, partId: sourcePart.id, partNo: Number(targetNo), title: sourcePart.title, duration: Number(sourcePart.duration) || 0 });
      } catch (error) {
        setStatus(error.message || '这个 P 序号已经存在，无法调序');
        return;
      }
    }

    setTrack((current) => {
      const parts = [...current.parts];
      parts[index] = { ...parts[index], part_no: targetNo };
      parts[target] = { ...parts[target], part_no: sourceNo };
      [parts[index], parts[target]] = [parts[target], parts[index]];
      return { ...current, parts };
    });
  }

  function updateAttachmentOrder(index, offset) {
    setTrack((current) => {
      const target = index + offset;
      if (target < 0 || target >= (current.attachments || []).length) return current;
      const attachments = [...(current.attachments || [])];
      [attachments[index], attachments[target]] = [attachments[target], attachments[index]];
      return { ...current, attachments };
    });
  }

  function removeAttachment(index) {
    setTrack((current) => ({ ...current, attachments: (current.attachments || []).filter((_, itemIndex) => itemIndex !== index) }));
  }

  function validateForm() {
    const next = {};
    if (!track.name.trim()) next.name = '请填写名称';
    else if (track.name.length > 120) next.name = '名称最多 120 个字';
    if ((track.description || '').length > 1000) next.description = '简介最多 1000 个字';
    if (!track.cover) next.cover = '请上传封面';
    if (track.parts.length === 0) next.parts = '请至少添加 1 个 P 分段';
    track.parts.forEach((part, index) => {
      if (!part.title.trim()) next[`part-${index}`] = `请填写 P${index + 1} 标题`;
      else if (!part.video && !part.video_url) next[`part-${index}`] = `请为 P${index + 1} 选择视频`;
    });
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      requestAnimationFrame(() => {
        const node = document.querySelector(`[data-field="${first}"]`);
        node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node?.querySelector('input, textarea, [role="button"]')?.focus?.();
      });
    }
    return Object.keys(next).length === 0;
  }

  async function handleCoverFile(file) {
    if (!file) return;
    clearError('cover');
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('请上传图片文件');
      }
      setStatus('正在上传封面...');
      const result = await createLibraryUploadUrl(file, 'cover');
      await uploadLibraryFileToBucket({ uploadUrl: result.data.uploadUrl, file });
      patchTrack({ cover: result.data.publicUrl });
      setStatus('封面上传成功');
    } catch (error) {
      setErrors((current) => ({ ...current, cover: error.message || '封面上传失败' }));
      setStatus(error.message || '封面上传失败');
    }
  }

  async function addAttachments(files) {
    const items = Array.from(files || []).map((file) => normalizeAttachment({ file }));
    if (items.length) patchTrack({ attachments: [...(track.attachments || []), ...items] });
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  function prerequisiteLabel(type) {
    if (type === 'knowledge_collection') return '知识点集';
    if (type === 'knowledge_point') return '单知识点';
    if (type === 'track_collection') return '曲谱集';
    return '单曲目';
  }

  // 类型标签配色取自设计稿 admin-create-track-collection.html §ptag
  function prerequisiteTagClass(type) {
    if (type === 'knowledge_collection') return 't-kset';
    if (type === 'knowledge_point') return 't-kp';
    if (type === 'track_collection') return 't-score';
    return 't-track';
  }

  function prerequisiteOptions() {
    const items = [
      ...(knowledgeLibrary.knowledge_collections || []).map((item) => ({ objectType: 'knowledge_collection', objectId: item.id, title: item.name })),
      ...(knowledgeLibrary.knowledge_points || []).map((item) => ({ objectType: 'knowledge_point', objectId: item.id, title: item.name })),
      ...(library.track_points || []).filter((item) => item.id !== editingId).map((item) => ({ objectType: 'track_point', objectId: item.id, title: item.name })),
      ...(library.track_collections || []).map((item) => ({ objectType: 'track_collection', objectId: item.id, title: item.name }))
    ];

    const keyword = prerequisiteKeyword.trim().toLowerCase();
    return items.filter((item) => !keyword || `${prerequisiteLabel(item.objectType)} ${item.title}`.toLowerCase().includes(keyword)).slice(0, 12);
  }

  function isPrerequisiteSelected(item) {
    return prerequisites.some((selected) => selected.objectType === item.objectType && selected.objectId === item.objectId);
  }

  function togglePrerequisite(item) {
    if (isPrerequisiteSelected(item)) return;
    setPrerequisites((current) => [...current, item]);
    setPrerequisiteKeyword('');
  }

  function removePrerequisite(item) {
    setPrerequisites((current) => current.filter((selected) => !(selected.objectType === item.objectType && selected.objectId === item.objectId)));
  }

  async function searchLibraryResources(keyword) {
    setLibraryKeyword(keyword);
    const result = await fetchLibraryResources(keyword);
    setLibraryResults(result.data || []);
  }

  function addLinkedResource(item) {
    if (!linkedResources.some((resource) => resource.id === item.id)) setLinkedResources((current) => [...current, item]);
  }

  function removeLinkedResource(id) {
    setLinkedResources((current) => current.filter((item) => item.id !== id || isInheritedLibraryResource(item)));
  }

  async function saveLinkedResources(objectId) {
    const target = { objectType: 'track_point', objectId };
    const selectedIds = linkedResources.filter(isDirectLibraryResource).map((resource) => resource.id);
    const affectedIds = Array.from(new Set([...originalLinkedResourceIds, ...selectedIds]));
    await Promise.all(affectedIds.map(async (resourceId) => {
      const selected = selectedIds.includes(resourceId);
      const detail = await fetchLibraryResourceById(resourceId);
      const links = (detail.data.links || []).filter((link) => !((link.objectType ?? link.object_type) === target.objectType && Number(link.objectId ?? link.object_id) === Number(target.objectId)));
      if (selected) links.push(target);
      await saveLibraryResourceLinks({ id: resourceId, links });
    }));
    setOriginalLinkedResourceIds(selectedIds);
  }

  async function persistAttachments(trackId) {
    const attachments = [];
    for (const attachment of track.attachments || []) {
      if (attachment.file) {
        setStatus(`正在上传附件：${attachment.file_name}`);
        const created = await createTrackAttachmentUploadUrl({ trackId, file: attachment.file });
        await uploadLibraryFileToBucket({ uploadUrl: created.data.uploadUrl, file: attachment.file });
        attachments.push({ ...attachment, file: null, file_url: created.data.publicUrl, file_key: created.data.key, file_type: created.data.fileType, file_size: created.data.fileSize });
      } else {
        attachments.push(attachment);
      }
    }
    await saveTrackAttachments({ trackId, attachments: attachments.map((item, index) => ({ fileName: item.file_name, fileUrl: item.file_url, fileKey: item.file_key, fileType: item.file_type, fileSize: item.file_size, sortOrder: index })) });
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ track, prerequisites, linkedResources, savedAt: Date.now() }));
    setDraftAvailable(true);
    setStatus('草稿已保存到本机');
  }

  function restoreDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setTrack({ name: '', description: '', cover: '', parts: [], attachments: [], ...(draft.track || {}) });
      setPrerequisites(draft.prerequisites || []);
      setLinkedResources(draft.linkedResources || []);
      setOriginalLinkedResourceIds([]);
      setErrors({});
      setStatus('已恢复本机草稿');
    } catch {
      setStatus('草稿读取失败');
    }
  }

  const previewName = track.name.trim() || '未命名单课';
  const previewPartCount = track.parts.length;
  const prerequisiteResults = prerequisiteOptions();

  async function uploadPart(trackId, part, index) {
    if (!part.video || !part.title || !part.part_no) {
      throw new Error(`请填写 P${index + 1} 的序号、标题并选择视频`);
    }

    const created = await createTrackPartUpload({
      trackId,
      partNo: Number(part.part_no),
      title: part.title,
      video: part.video
    });
    const uploadInfo = created.data.video;
    let uploadedParts;

    try {
      uploadedParts = await uploadVideoByMultipart({
        file: part.video,
        key: uploadInfo.key,
        uploadId: uploadInfo.uploadId,
        onProgress: (progress) => setStatus(`正在上传 P${part.part_no}：${progress}%`),
        uploadPart: async ({ key, uploadId, partNumber }) => {
          const result = await createTrackPartUploadUrl({ trackId, key, uploadId, partNumber });
          return result.data.uploadUrl;
        },
        uploadPartFile: async ({ uploadUrl, blob, contentType, onProgress }) => uploadMultipartPartToBucket({ uploadUrl, blob, contentType, onProgress })
      });
    } catch (error) {
      await abortTrackPartUpload({ trackId, key: uploadInfo.key, uploadId: uploadInfo.uploadId }).catch(() => {});
      throw error;
    }

    await completeTrackPartUpload({ trackId, key: uploadInfo.key, uploadId: uploadInfo.uploadId, parts: uploadedParts });
    await saveTrackPart({ trackId, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0, videoKey: uploadInfo.key });
    updatePart(index, { video: null, video_url: uploadInfo.publicUrl, id: `uploaded-${Date.now()}` });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!validateForm()) return;

    setBusy(true);
    try {
      let trackId = editingId;
      const isCreating = !trackId;
      const payload = { name: track.name, description: track.description, cover: track.cover };
      if (trackId) {
        await updateTrack({ id: trackId, ...payload });
      } else {
        const result = await createTrack(payload);
        trackId = result.data.id;
        setEditingId(trackId);
      }

      const newParts = track.parts.filter((part) => part.video && !part.id);
      if (newParts.length > 0) {
        setStatus(`准备上传 ${newParts.length} 个 P 分段...`);
        for (const [index, part] of track.parts.entries()) {
          if (part.video && !part.id) {
            await uploadPart(trackId, part, index);
          }
        }
      }

      await savePrerequisites({ objectType: 'track_point', objectId: trackId, prerequisites });
      await persistAttachments(trackId);
      await saveLinkedResources(trackId);

      for (const part of track.parts.filter((item) => item.id && !String(item.id).startsWith('uploaded-') && item.title)) {
        await updateTrackPart({ trackId, partId: part.id, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0 });
      }

      localStorage.removeItem(DRAFT_KEY);
      setDraftAvailable(false);
      if (isCreating) {
        router.push(`/tracks/${trackId}`);
        return;
      }
      await reloadLibrary();
      await editTrack(trackId);
      setStatus('曲目保存成功');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removePart(part, index) {
    if (part.id && !String(part.id).startsWith('uploaded-')) {
      if (!window.confirm(`确定删除 P${part.part_no} 吗？`)) return;
      await deleteTrackPart({ trackId: editingId, partId: part.id });
    }
    setTrack((current) => ({ ...current, parts: current.parts.filter((_, partIndex) => partIndex !== index) }));
  }

  async function removeTrack(id) {
    if (!window.confirm('确定删除这个曲目吗？')) return;
    try {
      await deleteTrack(id);
      if (editingId === id) startNewTrack();
      await reloadLibrary();
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!admin) return <p className="empty-text">{status}</p>;

  return (
    <>
      <AppNav
        role="super_admin"
        accountName={admin.nickname || admin.username}
        homeHref="/admin"
        actions={<span className="role-tag">教导主任工作台 · {admin.nickname || admin.username}</span>}
      />
      <main className="admin-wrap">
        <div className="wizard rise">
          <div className="wiz-head">
            <h1><mark>{isEditing ? '编辑单课' : '新建单课'}</mark></h1>
            <span className="zone-badge">曲目区</span>
            <span className="eyebrow">CREATE LESSON</span>
          </div>

          <form className="form-body" autoComplete="off" onSubmit={submit}>
            <div className="form-cols">
              {draftAvailable && !isEditing ? (
                <div className="draft-tip">
                  检测到本机保存的单课草稿，可恢复继续编辑。
                  <span className="spacer" />
                  <button className="btn btn-ghost" type="button" onClick={restoreDraft}>恢复草稿</button>
                </div>
              ) : null}
              <section className="fsec">
                <div className="fsec-title">基本信息</div>
                <div className={`field${errors.name ? ' error' : ''}`} data-field="name">
                  <label>名称 <span className="cnt num">{track.name.length}/120</span></label>
                  <input type="text" value={track.name} maxLength={140} onChange={(event) => patchTrack({ name: event.target.value })} placeholder="如：卡农（Johann Pachelbel · 指弹改编）" />
                  <span className="err-msg">{errors.name || ''}</span>
                </div>
                <div className={`field${errors.description ? ' error' : ''}`} data-field="description">
                  <label>简介 <span className="cnt num">{track.description.length}/1000</span></label>
                  <textarea value={track.description} onChange={(event) => patchTrack({ description: event.target.value })} placeholder="本课的教学目标、适合阶段、练习建议…" />
                  <span className="err-msg">{errors.description || ''}</span>
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">封面 <span className="note req">支持任意比例 · 上传后裁切为 1:1</span></div>
                <div className="cover-flex" data-field="cover">
                  <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={(event) => handleCoverFile(event.target.files?.[0]).finally(() => { event.target.value = ''; })} />
                  <div className={`cover-box${track.cover ? ' has' : ''}`} role="button" tabIndex={0} onClick={() => coverInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') coverInputRef.current?.click(); }}>
                    {track.cover ? <><img src={track.cover} alt="曲目封面" /><button className="cov-rm" type="button" onClick={(event) => { event.stopPropagation(); patchTrack({ cover: '' }); }}>×</button></> : <><span className="t1">＋ 上传封面</span><span className="t2">任意比例 · 自动裁切 1:1</span><div className="vinyl"><i /></div></>}
                  </div>
                </div>
                <span className="err-msg">{errors.cover || ''}</span>
              </section>

              <section className="fsec">
                <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                <div className="pv-card">
                  <div className={`pv-cover${track.cover ? ' has-img' : ''}`} style={track.cover ? { backgroundImage: `url(${track.cover})` } : undefined}>
                    {!track.cover ? <div className="disc"><span className="lbl"><i /></span></div> : null}
                  </div>
                  <div className="pv-name">{previewName}</div>
                  <div className="pv-meta num">单课 · {previewPartCount} 个分段</div>
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">前置知识点 <span className="note">可选 · 支持单知识点 / 知识点集 / 单曲目 / 曲谱集</span></div>
                <p className="pick-count">已选 <b className="num">{prerequisites.length}</b> 项前置内容</p>
                <div className={`picked-list${prerequisites.length ? ' has-items' : ''}`} id="preChips" aria-label="已选前置内容">
                  {prerequisites.map((item) => (
                    <span className="picked-chip" key={`${item.objectType}-${item.objectId}`}>
                      <span className="nm">
                        <span className={`ptag ${prerequisiteTagClass(item.objectType)}`}>{prerequisiteLabel(item.objectType)}</span>{item.title}
                      </span>
                      <button className="rm" type="button" onClick={() => removePrerequisite(item)} aria-label={`移除 ${item.title}`}>✕</button>
                    </span>
                  ))}
                </div>
                <div className="pre-picker">
                  <label className={`pick-search big${prerequisiteKeyword ? ' has' : ''}`} onFocus={() => setIsPrerequisiteFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setTimeout(() => setIsPrerequisiteFocused(false), 120); }}>
                    <SearchIcon />
                    <input type="text" value={prerequisiteKeyword} onChange={(event) => setPrerequisiteKeyword(event.target.value)} placeholder="搜索单知识点 / 知识点集 / 单曲目 / 曲谱集…" />
                    <button type="button" className="clr" onClick={() => setPrerequisiteKeyword('')}>清除</button>
                  </label>
                  <div className={`pre-drop${isPrerequisiteFocused && prerequisiteKeyword.trim() ? ' open' : ''}`} onMouseDown={(event) => event.preventDefault()}>
                    {prerequisiteResults.map((item) => (
                      <button type="button" className={`pre-item${isPrerequisiteSelected(item) ? ' off' : ''}`} onClick={() => togglePrerequisite(item)} key={`${item.objectType}-${item.objectId}`}>
                        <span className={`ptag ${prerequisiteTagClass(item.objectType)}`}>{prerequisiteLabel(item.objectType)}</span>
                        <span className="pnm">{item.title}</span>
                        <span className="pmeta">{isPrerequisiteSelected(item) ? '已加入' : '点击加入'}</span>
                      </button>
                    ))}
                    {prerequisiteResults.length === 0 ? <div className="pick-empty show">未找到匹配的前置内容，换个关键词试试</div> : null}
                  </div>
                </div>
                <p className="pre-hint">按「类型 + 标题」选取前置内容：知识点集 · 单知识点 · 单曲目 · 曲谱集，如【知识点集】右手基本功系列、【单曲谱】稻香 · 弹唱谱；点击结果加入，已选项置灰</p>
              </section>

              <section className="fsec full">
                <div className="fsec-title">P 分段管理 <span className="note">逐个上传 P 视频 · 可增删 / 调顺序 · P 无需封面</span></div>
                <div className="pmanage">
                  <div className="pmanage-head">
                    <span className="pm-t">P 分段</span>
                    <span className="pm-note">已添加 {track.parts.length} 段</span>
                    <button type="button" className="pm-add" onClick={() => setTrack({ ...track, parts: [...track.parts, makePart(nextPartNo)] })}>＋ 添加分段</button>
                  </div>
                  <div className="pm-list">
                    {track.parts.map((part, index) => (
                      <div className={`prow${errors[`part-${index}`] ? ' field error' : ''}`} data-field={`part-${index}`} key={part.id || `new-${index}`}>
                        <div className="pidx num">P{part.part_no || index + 1}<span className="pmark">第 {part.part_no || index + 1} 段</span></div>
                        <div className="wiz-part-main">
                          <input className="pname" value={part.title} onChange={(event) => updatePart(index, { title: event.target.value })} placeholder="P 标题" />
                          <span className="err-msg">{errors[`part-${index}`] || ''}</span>
                        </div>
                        <PartFileLabel part={part} onChange={(event) => updatePart(index, { video: event.target.files?.[0] || null })} />
                        <div className="pops">
                          <button type="button" data-op disabled={index === 0} onClick={() => movePart(index, -1)}>↑</button>
                          <button type="button" data-op disabled={index === track.parts.length - 1} onClick={() => movePart(index, 1)}>↓</button>
                          <button type="button" data-op onClick={() => removePart(part, index)}>×</button>
                        </div>
                      </div>
                    ))}
                    {track.parts.length === 0 ? <p className="empty-text">还没有 P 分段，请先添加。</p> : null}
                    {errors.parts ? <span className="err-msg" data-field="parts">{errors.parts}</span> : null}
                  </div>
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">附件资料 <span className="note">PDF / GP / MP3 / PNG · 学员逐个下载 · 可调顺序</span></div>
                <div className="pmanage">
                  <div className="pmanage-head">
                    <span className="pm-t">附件</span>
                    <span className="pm-note num">已添加 {(track.attachments || []).length} 份</span>
                    <input ref={attachmentInputRef} type="file" multiple hidden onChange={(event) => { addAttachments(event.target.files); event.target.value = ''; }} />
                    <button type="button" className="pm-add" onClick={() => attachmentInputRef.current?.click()}>＋ 添加附件</button>
                  </div>
                  <div className="pm-list">
                    {(track.attachments || []).map((item, index) => (
                      <div className="frow" key={item.id || item.file_key || `${item.file_name}-${index}`}>
                        <span className="fico">{attachmentBadge(item.file_name)}</span>
                        <span><span className="fname">{item.file_name}</span><span className="fmeta">{formatSize(item.file_size)} · {item.file ? '待上传' : '已上传'}</span></span>
                        <div className="pops">
                          <button type="button" data-op disabled={index === 0} onClick={() => updateAttachmentOrder(index, -1)}>↑</button>
                          <button type="button" data-op disabled={index === (track.attachments || []).length - 1} onClick={() => updateAttachmentOrder(index, 1)}>↓</button>
                          <button type="button" data-op onClick={() => removeAttachment(index)}>×</button>
                        </div>
                      </div>
                    ))}
                    {(track.attachments || []).length === 0 ? <p className="empty-text">还没有附件资料，请先添加。</p> : null}
                  </div>
                </div>
              </section>
              <section className="fsec full lib-link-sec">
                <div className="fsec-title">关联图书馆 <span className="note">可选 · 可关联多本 · 学员在详情页「关联图书馆」处查看与下载</span></div>
                <p className="pick-count">已关联 <b className="num">{linkedResources.length}</b> 本图书</p>
                <div className={`picked-list${linkedResources.length ? ' has-items' : ''}`} id="libChips" aria-label="已关联图书馆图书">
                  {linkedResources.map((item) => (
                    <span className={`picked-chip${isInheritedLibraryResource(item) ? ' inherited' : ''}`} key={item.id}>
                      <span className="nm">
                        <span className="ptag t-book">图书</span>{item.title || item.file_name}
                        {isInheritedLibraryResource(item) ? <em className="inherit-note">来自合集</em> : null}
                      </span>
                      {isInheritedLibraryResource(item) ? <span className="rm lock" title="来自合集，需从合集移出后解除">锁</span> : <button className="rm" type="button" onClick={() => removeLinkedResource(item.id)} aria-label={`移除 ${item.title || item.file_name}`}>✕</button>}
                    </span>
                  ))}
                </div>
                <div className="pre-picker">
                  <label className={`pick-search big${libraryKeyword ? ' has' : ''}`} onFocus={() => setIsLibraryFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setTimeout(() => setIsLibraryFocused(false), 120); }}>
                    <SearchIcon />
                    <input type="text" value={libraryKeyword} onChange={(event) => searchLibraryResources(event.target.value)} placeholder="搜索图书馆图书名称…" />
                    <button type="button" className="clr" onClick={() => searchLibraryResources('')}>清除</button>
                  </label>
                  <div className={`pre-drop${isLibraryFocused && libraryKeyword.trim() ? ' open' : ''}`} onMouseDown={(event) => event.preventDefault()}>
                    {libraryResults.filter((item) => !linkedResources.some((resource) => resource.id === item.id)).slice(0, 12).map((item) => (
                      <button type="button" className="pre-item" onClick={() => addLinkedResource(item)} key={item.id}>
                        <span className="ptag t-book">图书</span>
                        <span className="pnm">{item.title || item.file_name}</span>
                        <span className="pmeta">点击关联</span>
                      </button>
                    ))}
                    {libraryResults.filter((item) => !linkedResources.some((resource) => resource.id === item.id)).length === 0 ? <div className="pick-empty show">未找到匹配的图书，换个关键词试试</div> : null}
                  </div>
                </div>
                <p className="pre-hint">从图书馆搜索并关联图书，如【图书】民谣吉他入门一本通；点击结果加入，已关联项置灰；学员在单课详情页右下「关联图书馆」处可查看并下载</p>
              </section>
            </div>

            <div className="wiz-foot">
              <button className="btn btn-ghost" type="button" onClick={() => router.push('/tracks')}>← 返回</button>
              <span className="foot-hint">{status || '曲目区 · 新建单课'}</span>
              <span className="spacer" />
              <button className="btn btn-ghost" type="button" onClick={saveDraft} disabled={busy}>保存草稿</button>
              <button className="btn btn-main" type="submit" disabled={busy}>{busy ? '发布中...' : '发 布'}</button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
