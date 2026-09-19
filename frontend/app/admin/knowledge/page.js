'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import {
  abortKnowledgePartUpload,
  completeKnowledgePartUpload,
  createKnowledgeCollection,
  createKnowledgeAttachmentUploadUrl,
  createLibraryUploadUrl,
  createKnowledgePartUpload,
  createKnowledgePartUploadUrl,
  createKnowledgePoint,
  deleteKnowledgePart,
  fetchAdminMe,
  fetchLibraryResourceById,
  fetchKnowledgeCollectionById,
  fetchKnowledgeLibrary,
  fetchKnowledgePointById,
  fetchPrerequisites,
  fetchLibraryResources,
  fetchTrackLibrary,
  saveKnowledgeAttachments,
  saveKnowledgePart,
  saveContentLibraryLinks,
  saveLibraryResourceLinks,
  savePrerequisites,
  updateKnowledgeCollection,
  updateKnowledgeCollectionItems,
  updateKnowledgePart,
  updateKnowledgePoint,
  uploadLibraryFileToBucket,
  uploadMultipartPartToBucket
} from '../../../lib/api.js';
import { uploadVideoByMultipart } from '../../../components/uploadVideo.js';

const PAGE_SIZE = 16;
const DRAFT_KEY = 'admin:create:knowledge:draft';

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

function Pager({ page, total, onChange }) {
  const pages = Array.from({ length: Math.min(total, 5) }, (_, index) => index + 1);
  return (
    <nav className="pager" aria-label="内容分页">
      <button type="button" className="pgbtn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">‹</button>
      <span className="pgnums num">
        {pages.map((item) => <button type="button" className={item === page ? 'pgnum on' : 'pgnum'} onClick={() => onChange(item)} key={item}>{item}</button>)}
        {total > 5 ? <span className="pgdots">…</span> : null}
      </span>
      <button type="button" className="pgbtn" disabled={page >= total} onClick={() => onChange(page + 1)} aria-label="下一页">›</button>
    </nav>
  );
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

function buildPrerequisiteItems({ knowledgeLibrary, trackLibrary, editingId = null }) {
  return [
    ...(knowledgeLibrary.knowledge_collections || []).map((item) => ({ objectType: 'knowledge_collection', objectId: item.id, title: item.name })),
    ...(knowledgeLibrary.knowledge_points || []).filter((item) => item.id !== editingId).map((item) => ({ objectType: 'knowledge_point', objectId: item.id, title: item.name })),
    ...(trackLibrary.track_points || []).map((item) => ({ objectType: 'track_point', objectId: item.id, title: item.name })),
    ...(trackLibrary.track_collections || []).map((item) => ({ objectType: 'track_collection', objectId: item.id, title: item.name }))
  ];
}

export default function AdminKnowledgePage() {
  return (
    <Suspense fallback={<p className="empty-text">正在加载知识点管理...</p>}>
      <AdminKnowledgeContent />
    </Suspense>
  );
}

function AdminKnowledgeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('type') === 'collection' ? 'collection' : 'point';
  const initialId = Number(searchParams.get('id')) || null;
  const [admin, setAdmin] = useState(null);
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ knowledge_points: [], knowledge_collections: [] });
  const [trackLibrary, setTrackLibrary] = useState({ track_points: [], track_collections: [] });
  const [editingId, setEditingId] = useState(null);
  const [point, setPoint] = useState({ name: '', description: '', cover: '', parts: [], attachments: [] });
  const [collection, setCollection] = useState({ name: '', description: '', cover: '' });
  const [selectedPointIds, setSelectedPointIds] = useState([]);
  const [prerequisites, setPrerequisites] = useState([]);
  const [prerequisiteKeyword, setPrerequisiteKeyword] = useState('');
  const [linkedResources, setLinkedResources] = useState([]);
  const [originalLinkedResourceIds, setOriginalLinkedResourceIds] = useState([]);
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryResults, setLibraryResults] = useState([]);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [errors, setErrors] = useState({});
  const coverInputRef = useRef(null);
  const collectionCoverInputRef = useRef(null);
  const [isLibraryFocused, setIsLibraryFocused] = useState(false);
  const attachmentInputRef = useRef(null);
  const [pointKeyword, setPointKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('正在检查登录状态...');
  const [busy, setBusy] = useState(false);

  const nextPartNo = useMemo(() => point.parts.reduce((max, part) => Math.max(max, Number(part.part_no) || 0), 0) + 1, [point.parts]);

  async function reloadLibrary() {
    const [knowledge, tracks] = await Promise.all([fetchKnowledgeLibrary(''), fetchTrackLibrary('')]);
    setKnowledgeLibrary(knowledge.data);
    setTrackLibrary(tracks.data);
  }

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }
        setAdmin(me.data);
        const draftKey = mode === 'collection' ? `${DRAFT_KEY}:collection` : DRAFT_KEY;
        setDraftAvailable(Boolean(localStorage.getItem(draftKey)));
        const resources = await fetchLibraryResources('');
        setLibraryResults(resources.data || []);
        await reloadLibrary();
        if (initialId) {
          if (mode === 'collection') {
            await editCollection(initialId);
          } else {
            await editPoint(initialId);
          }
        } else {
          setStatus('');
        }
      } catch (error) {
        router.replace('/login');
      }
    }
    init();
  }, [router, mode, initialId]);

  async function editPoint(id) {
    setStatus('正在加载知识点...');
    const [result, prerequisiteResult] = await Promise.all([
      fetchKnowledgePointById(id),
      fetchPrerequisites({ objectType: 'knowledge_point', objectId: id }).catch(() => ({ data: [] }))
    ]);
    setEditingId(id);
    setPoint({ ...result.data, parts: result.data.parts.map((part) => ({ ...part, video: null })), attachments: (result.data.attachments || []).map(normalizeAttachment) });
    setPrerequisites(prerequisiteResult.data || []);
    setLinkedResources(result.data.library_resources || []);
    setOriginalLinkedResourceIds((result.data.library_resources || []).filter(isDirectLibraryResource).map((item) => item.id));
    setErrors({});
    setStatus('');
  }

  async function editCollection(id) {
    setStatus('正在加载知识点集...');
    const [result, prerequisiteResult] = await Promise.all([
      fetchKnowledgeCollectionById(id),
      fetchPrerequisites({ objectType: 'knowledge_collection', objectId: id }).catch(() => ({ data: [] }))
    ]);
    const points = result.data.points || result.data.items || [];
    setEditingId(id);
    setCollection({
      name: result.data.name || '',
      description: result.data.description || '',
      cover: result.data.cover || '',
    });
    setSelectedPointIds(points.map((item) => item.id));
    setPrerequisites(prerequisiteResult.data || []);
    setLinkedResources(result.data.library_resources || []);
    setOriginalLinkedResourceIds((result.data.library_resources || []).map((item) => item.id));
    setStatus('');
  }

  function startNewPoint() {
    setEditingId(null);
    setPoint({ name: '', description: '', cover: '', parts: [], attachments: [] });
    setPrerequisites([]);
    setLinkedResources([]);
    setOriginalLinkedResourceIds([]);
    setPrerequisiteKeyword('');
    setLibraryKeyword('');
    setErrors({});
    setStatus('');
  }

  function startNewCollection() {
    setEditingId(null);
    setCollection({ name: '', description: '', cover: '' });
    setSelectedPointIds([]);
    setPrerequisites([]);
    setErrors({});
    setStatus('');
  }

  function patchCollection(patch) {
    setCollection((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((field) => {
        delete next[field];
        if (field === 'name') delete next.collectionName;
        if (field === 'description') delete next.collectionDescription;
        if (field === 'cover') delete next.collectionCover;
      });
      return next;
    });
  }

  function updatePart(index, patch) {
    setPoint((current) => ({ ...current, parts: current.parts.map((part, partIndex) => partIndex === index ? { ...part, ...patch } : part) }));
    clearError(`part-${index}`);
  }

  function clearError(field) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function patchPoint(patch) {
    setPoint((current) => ({ ...current, ...patch }));
    Object.keys(patch).forEach(clearError);
  }

  async function movePart(index, offset) {
    const target = index + offset;
    const currentParts = point.parts;
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
        await updateKnowledgePart({ pointId: editingId, partId: sourcePart.id, partNo: temporaryNo, title: sourcePart.title, duration: Number(sourcePart.duration) || 0 });
        await updateKnowledgePart({ pointId: editingId, partId: targetPart.id, partNo: Number(sourceNo), title: targetPart.title, duration: Number(targetPart.duration) || 0 });
        await updateKnowledgePart({ pointId: editingId, partId: sourcePart.id, partNo: Number(targetNo), title: sourcePart.title, duration: Number(sourcePart.duration) || 0 });
      } catch (error) {
        setStatus(error.message || '这个 P 序号已经存在，无法调序');
        return;
      }
    }

    setPoint((current) => {
      const parts = [...current.parts];
      parts[index] = { ...parts[index], part_no: targetNo };
      parts[target] = { ...parts[target], part_no: sourceNo };
      [parts[index], parts[target]] = [parts[target], parts[index]];
      return { ...current, parts };
    });
  }

  function updateAttachmentOrder(index, offset) {
    setPoint((current) => {
      const target = index + offset;
      if (target < 0 || target >= (current.attachments || []).length) return current;
      const attachments = [...(current.attachments || [])];
      [attachments[index], attachments[target]] = [attachments[target], attachments[index]];
      return { ...current, attachments };
    });
  }

  function removeAttachment(index) {
    setPoint((current) => ({ ...current, attachments: (current.attachments || []).filter((_, itemIndex) => itemIndex !== index) }));
  }

  function validateCollectionForm() {
    const next = {};
    if (!collection.name.trim()) next.collectionName = '请填写知识点集名称';
    else if (collection.name.length > 120) next.collectionName = '名称最多 120 个字';
    if ((collection.description || '').length > 1000) next.collectionDescription = '简介最多 1000 个字';
    if (!collection.cover) next.collectionCover = '请上传封面';
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

  function validatePointForm() {
    const next = {};
    if (!point.name.trim()) next.name = '请填写名称';
    else if (point.name.length > 120) next.name = '名称最多 120 个字';
    if ((point.description || '').length > 1000) next.description = '简介最多 1000 个字';
    if (!point.cover) next.cover = '请上传封面';
    if (point.parts.length === 0) next.parts = '请至少添加 1 个 P 分段';
    point.parts.forEach((part, index) => {
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
      if (!file.type.startsWith('image/')) throw new Error('请上传图片文件');
      setStatus('正在上传封面...');
      const result = await createLibraryUploadUrl(file, 'cover');
      await uploadLibraryFileToBucket({ uploadUrl: result.data.uploadUrl, file });
      patchPoint({ cover: result.data.publicUrl });
      setStatus('封面上传成功');
    } catch (error) {
      setErrors((current) => ({ ...current, cover: error.message || '封面上传失败' }));
      setStatus(error.message || '封面上传失败');
    }
  }

  async function handleCollectionCoverFile(file) {
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('请上传图片文件');
      setStatus('正在上传封面...');
      const result = await createLibraryUploadUrl(file, 'cover');
      await uploadLibraryFileToBucket({ uploadUrl: result.data.uploadUrl, file });
      patchCollection({ cover: result.data.publicUrl });
      setStatus('封面上传成功');
    } catch (error) {
      setErrors((current) => ({ ...current, collectionCover: error.message || '封面上传失败' }));
      setStatus(error.message || '封面上传失败');
    }
  }

  function addAttachments(files) {
    const items = Array.from(files || []).map((file) => normalizeAttachment({ file }));
    if (!items.length) return;
    setPoint((current) => ({ ...current, attachments: [...(current.attachments || []), ...items] }));
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  const prerequisiteOptions = useMemo(() => {
    const keyword = prerequisiteKeyword.trim().toLowerCase();
    return buildPrerequisiteItems({ knowledgeLibrary, trackLibrary, editingId })
      .filter((item) => !keyword || `${prerequisiteLabel(item.objectType)} ${item.title}`.toLowerCase().includes(keyword))
      .slice(0, 12);
  }, [editingId, knowledgeLibrary, prerequisiteKeyword, trackLibrary]);

  function isPrerequisiteSelected(item) {
    return prerequisites.some((selected) => selected.objectType === item.objectType && selected.objectId === item.objectId);
  }

  function addPrerequisite(item) {
    if (!isPrerequisiteSelected(item)) {
      setPrerequisites((current) => [...current, item]);
      setPrerequisiteKeyword('');
    }
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
    setLibraryKeyword('');
    setIsLibraryFocused(false);
  }

  function removeLinkedResource(id) {
    setLinkedResources((current) => current.filter((item) => item.id !== id || isInheritedLibraryResource(item)));
  }

  async function saveLinkedResources(objectId) {
    const target = { objectType: 'knowledge_point', objectId };
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

  async function persistAttachments(pointId) {
    const attachments = [];
    for (const attachment of point.attachments || []) {
      if (attachment.file) {
        setStatus(`正在上传附件：${attachment.file_name}`);
        const created = await createKnowledgeAttachmentUploadUrl({ pointId, file: attachment.file });
        await uploadLibraryFileToBucket({ uploadUrl: created.data.uploadUrl, file: attachment.file });
        attachments.push({ ...attachment, file: null, file_url: created.data.publicUrl, file_key: created.data.key, file_type: created.data.fileType, file_size: created.data.fileSize });
      } else {
        attachments.push(attachment);
      }
    }
    await saveKnowledgeAttachments({ pointId, attachments: attachments.map((item, index) => ({ fileName: item.file_name, fileUrl: item.file_url, fileKey: item.file_key, fileType: item.file_type, fileSize: item.file_size, sortOrder: index })) });
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ point, prerequisites, linkedResources, savedAt: Date.now() }));
    setDraftAvailable(true);
    setStatus('草稿已保存到本机');
  }

  function saveCollectionDraft() {
    localStorage.setItem(`${DRAFT_KEY}:collection`, JSON.stringify({ collection, selectedPointIds, prerequisites, savedAt: Date.now() }));
    setDraftAvailable(true);
    setStatus('草稿已保存到本机');
  }

  function restoreDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setPoint({ name: '', description: '', cover: '', parts: [], attachments: [], ...(draft.point || {}) });
      setPrerequisites(draft.prerequisites || []);
      setLinkedResources(draft.linkedResources || []);
      setOriginalLinkedResourceIds([]);
      setErrors({});
      setStatus('已恢复本机草稿');
    } catch {
      setStatus('草稿读取失败');
    }
  }

  function restoreCollectionDraft() {
    const raw = localStorage.getItem(`${DRAFT_KEY}:collection`);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setCollection({ name: '', description: '', cover: '', ...(draft.collection || {}) });
      setSelectedPointIds(draft.selectedPointIds || []);
      setPrerequisites(draft.prerequisites || []);
      setErrors({});
      setStatus('已恢复本机草稿');
    } catch {
      setStatus('草稿读取失败');
    }
  }

  async function uploadPart(pointId, part, index) {
    if (!part.video || !part.title || !part.part_no) {
      throw new Error(`请填写 P${index + 1} 的序号、标题并选择视频`);
    }

    const created = await createKnowledgePartUpload({ pointId, partNo: Number(part.part_no), title: part.title, video: part.video });
    const uploadInfo = created.data.video;
    let uploadedParts;

    try {
      uploadedParts = await uploadVideoByMultipart({
        file: part.video,
        key: uploadInfo.key,
        uploadId: uploadInfo.uploadId,
        onProgress: (progress) => setStatus(`正在上传 P${part.part_no}：${progress}%`),
        uploadPart: async ({ key, uploadId, partNumber }) => {
          const result = await createKnowledgePartUploadUrl({ pointId, key, uploadId, partNumber });
          return result.data.uploadUrl;
        },
        uploadPartFile: async ({ uploadUrl, blob, contentType, onProgress }) => uploadMultipartPartToBucket({ uploadUrl, blob, contentType, onProgress })
      });
    } catch (error) {
      await abortKnowledgePartUpload({ pointId, key: uploadInfo.key, uploadId: uploadInfo.uploadId }).catch(() => {});
      throw error;
    }

    await completeKnowledgePartUpload({ pointId, key: uploadInfo.key, uploadId: uploadInfo.uploadId, parts: uploadedParts });
    await saveKnowledgePart({ pointId, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0, videoKey: uploadInfo.key });
    updatePart(index, { video: null, video_url: uploadInfo.publicUrl, id: `uploaded-${Date.now()}` });
  }

  async function submitPoint(event) {
    event.preventDefault();
    if (busy) return;
    if (!validatePointForm()) return;

    setBusy(true);
    try {
      let pointId = editingId;
      const isCreating = !pointId;
      const payload = { name: point.name, description: point.description, cover: point.cover };
      if (pointId) {
        await updateKnowledgePoint({ id: pointId, ...payload });
      } else {
        const result = await createKnowledgePoint(payload);
        pointId = result.data.id;
        setEditingId(pointId);
      }

      const newParts = point.parts.filter((part) => part.video && !part.id);
      if (newParts.length > 0) setStatus(`准备上传 ${newParts.length} 个 P 分段...`);
      for (const [index, part] of point.parts.entries()) {
        if (part.video && !part.id) await uploadPart(pointId, part, index);
      }

      await savePrerequisites({ objectType: 'knowledge_point', objectId: pointId, prerequisites });
      await persistAttachments(pointId);
      await saveLinkedResources(pointId);
      for (const part of point.parts.filter((item) => item.id && !String(item.id).startsWith('uploaded-') && item.title)) {
        await updateKnowledgePart({ pointId, partId: part.id, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0 });
      }

      localStorage.removeItem(DRAFT_KEY);
      setDraftAvailable(false);
      if (isCreating) {
        router.push(`/knowledge/${pointId}`);
        return;
      }
      await reloadLibrary();
      await editPoint(pointId);
      setStatus('知识点保存成功');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removePart(part, index) {
    if (part.id && !String(part.id).startsWith('uploaded-')) {
      if (!window.confirm(`确定删除 P${part.part_no} 吗？`)) return;
      await deleteKnowledgePart({ pointId: editingId, partId: part.id });
    }
    setPoint((current) => ({ ...current, parts: current.parts.filter((_, partIndex) => partIndex !== index) }));
  }

  const filteredPoints = useMemo(() => {
    const keyword = pointKeyword.trim().toLowerCase();
    return (knowledgeLibrary.knowledge_points || []).filter((item) => !keyword || item.name.toLowerCase().includes(keyword));
  }, [knowledgeLibrary, pointKeyword]);

  const total = Math.max(1, Math.ceil(filteredPoints.length / PAGE_SIZE));
  const visiblePoints = filteredPoints.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedPoints = selectedPointIds.map((id) => (knowledgeLibrary.knowledge_points || []).find((item) => item.id === id)).filter(Boolean);

  function togglePoint(id) {
    setSelectedPointIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function movePoint(index, offset) {
    setSelectedPointIds((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submitCollection(event) {
    event.preventDefault();
    if (busy) return;
    if (!validateCollectionForm()) return;

    setBusy(true);
    try {
      let collectionId = editingId;
      if (collectionId) {
        await updateKnowledgeCollection({ id: collectionId, ...collection });
      } else {
        const created = await createKnowledgeCollection(collection);
        collectionId = created.data.id;
        setEditingId(collectionId);
      }
      await updateKnowledgeCollectionItems({ id: collectionId, pointIds: selectedPointIds });
      await savePrerequisites({ objectType: 'knowledge_collection', objectId: collectionId, prerequisites });
      await saveContentLibraryLinks({
        objectType: 'knowledge_collection',
        objectId: collectionId,
        selectedResourceIds: linkedResources.map((resource) => resource.id),
        originalResourceIds: originalLinkedResourceIds
      });
      setOriginalLinkedResourceIds(linkedResources.map((resource) => resource.id));
      localStorage.removeItem(`${DRAFT_KEY}:collection`);
      setDraftAvailable(false);
      setStatus('知识点集保存成功');
      router.push(`/knowledge/collections/${collectionId}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!admin) return <p className="empty-text">{status}</p>;

  const accountName = admin.nickname || admin.username;

  return (
    <>
      <AppNav role="super_admin" accountName={accountName} homeHref="/admin" actions={<span className="role-tag">教导主任工作台 · {accountName}</span>} />
      {mode === 'collection' ? (
        <main className="admin-wrap">
          <div className="wizard rise">
            <div className="wiz-head">
              <h1><mark>{editingId ? '编辑知识点集' : '新建知识点集'}</mark></h1>
              <span className="zone-badge">知识点区</span>
              <span className="eyebrow">CREATE KNOWLEDGE SET</span>
            </div>

            <form className="form-body" autoComplete="off" onSubmit={submitCollection}>
              <div className="form-cols">
                {draftAvailable && !editingId ? (
                  <div className="draft-tip">
                    检测到本机保存的知识点集草稿，可恢复继续编辑。
                    <span className="spacer" />
                    <button className="btn btn-ghost" type="button" onClick={restoreCollectionDraft}>恢复草稿</button>
                  </div>
                ) : null}
                <section className="fsec">
                  <div className="fsec-title">基本信息</div>
                  <div className={`field${errors.collectionName ? ' error' : ''}`} data-field="collectionName">
                    <label>知识点集名称 <span className="cnt num">{collection.name.length}/120</span></label>
                    <input type="text" value={collection.name} onChange={(event) => patchCollection({ name: event.target.value })} placeholder="如：右手基本功系列" maxLength={140} />
                    <span className="err-msg">{errors.collectionName || ''}</span>
                  </div>
                  <div className={`field${errors.collectionDescription ? ' error' : ''}`} data-field="collectionDescription">
                    <label>简介 <span className="cnt num">{collection.description.length}/1000</span></label>
                    <textarea value={collection.description} onChange={(event) => patchCollection({ description: event.target.value })} placeholder="这个知识点集收录哪些知识点、解决什么问题…" />
                    <span className="err-msg">{errors.collectionDescription || ''}</span>
                  </div>
                </section>

                <section className="fsec">
                  <div className="fsec-title">封面 <span className="note req">支持任意比例 · 上传后裁切为 1:1</span></div>
                  <div className="cover-flex" data-field="collectionCover">
                    <input ref={collectionCoverInputRef} type="file" accept="image/*" hidden onChange={(event) => handleCollectionCoverFile(event.target.files?.[0]).finally(() => { event.target.value = ''; })} />
                    <div className={`cover-box${collection.cover ? ' has' : ''}`} role="button" tabIndex={0} onClick={() => collectionCoverInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') collectionCoverInputRef.current?.click(); }}>
                      {collection.cover ? <><img src={collection.cover} alt="知识点集封面" /><button className="cov-rm" type="button" onClick={(event) => { event.stopPropagation(); patchCollection({ cover: '' }); }}>×</button></> : <><span className="t1">＋ 上传封面</span><span className="t2">任意比例 · 自动裁切 1:1</span><div className="vinyl"><i /></div></>}
                    </div>
                  </div>
                  <span className="err-msg">{errors.collectionCover || ''}</span>
                </section>

                <section className="fsec">
                  <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                  <div className="pv-card">
                    <div className={`pv-cover${collection.cover ? ' has-img' : ''}`} style={collection.cover ? { backgroundImage: `url(${collection.cover})` } : undefined}>
                      {!collection.cover ? <div className="disc"><span className="lbl"><i /></span></div> : null}
                    </div>
                    <div className="pv-name">{collection.name.trim() || '未命名知识点集'}</div>
                    <div className="pv-meta num">知识点集 · 已选 {selectedPointIds.length} 个知识点</div>
                  </div>
                </section>

                <PrerequisiteSection
                  prerequisites={prerequisites}
                  prerequisiteKeyword={prerequisiteKeyword}
                  setPrerequisiteKeyword={setPrerequisiteKeyword}
                  prerequisiteOptions={prerequisiteOptions}
                  isPrerequisiteSelected={isPrerequisiteSelected}
                  addPrerequisite={addPrerequisite}
                  removePrerequisite={removePrerequisite}
                />

                <section className="fsec full">
                  <div className="fsec-title">从已有单知识点中多选加入 <span className="note">一个知识点可同时进入多个知识点集</span></div>
                  <p className="pick-count">已选 <b className="num">{selectedPointIds.length}</b> 个知识点<span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· 顺序即合集内播放顺序：上方已选条目可点 ↑↓ 调序、✕ 快捷移除</span></p>
                  <div className={`picked-list${selectedPoints.length ? ' has-items' : ''}`} aria-label="已加入知识点集的内容">
                    {selectedPoints.map((item, index) => (
                      <span className="picked-chip" key={item.id}>
                        <span className="seq num">{index + 1}</span><span className="nm">{item.name}</span>
                        <button type="button" className="mv" disabled={index === 0} onClick={() => movePoint(index, -1)} aria-label="上移">↑</button>
                        <button type="button" className="mv" disabled={index === selectedPoints.length - 1} onClick={() => movePoint(index, 1)} aria-label="下移">↓</button>
                        <button type="button" className="rm" onClick={() => togglePoint(item.id)} aria-label={`移除 ${item.name}`}>✕</button>
                      </span>
                    ))}
                  </div>
                  <label className={`pick-search big${pointKeyword ? ' has' : ''}`}>
                    <SearchIcon />
                    <input type="text" value={pointKeyword} onChange={(event) => { setPointKeyword(event.target.value); setPage(1); }} placeholder="搜索知识点名称…" />
                    <button type="button" className="clr" onClick={() => setPointKeyword('')}>清除</button>
                  </label>
                  <div className="pick-grid">
                    {visiblePoints.map((item, index) => (
                      <button type="button" className={selectedPointIds.includes(item.id) ? 'pick-card sel' : 'pick-card'} onClick={() => togglePoint(item.id)} key={item.id}>
                        <span className={`pc-cover v${(index % 3) + 1}${item.cover ? ' img' : ''}`} style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined} />
                        <span className="pc-name">{item.name}</span>
                        <span className="pc-meta num">{item.part_count || 0} 个分段</span>
                        <span className="pc-check">✓</span>
                      </button>
                    ))}
                  </div>
                  <Pager page={page} total={total} onChange={setPage} />
                  {visiblePoints.length === 0 ? <div className="pick-empty show">未找到匹配的知识点，换个关键词试试</div> : null}
                </section>

                <section className="fsec full lib-link-sec">
                  <div className="fsec-title">关联图书馆 <span className="note">可选 · 可关联多本 · 学员在知识点集详情页查看与下载</span></div>
                  <p className="pick-count">已关联 <b className="num">{linkedResources.length}</b> 本图书<span style={{ fontSize: 10, color: 'var(--ink-3)' }}> · 上方已选条目可点 ✕ 快捷移除</span></p>
                  <div className={`picked-list${linkedResources.length ? ' has-items' : ''}`} id="libChips" aria-label="已关联图书馆图书">
                    {linkedResources.map((item) => (
                      <span className="picked-chip" key={item.id}>
                        <span className="nm">
                          <span className="ptag t-book">图书</span>{item.title || item.file_name}
                        </span>
                        <button type="button" className="rm" onClick={() => removeLinkedResource(item.id)} aria-label={`移除 ${item.title || item.file_name}`}>✕</button>
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
                          <span className="ptag t-book">图书</span><span className="pnm">{item.title || item.file_name}</span><span className="pmeta">点击关联</span>
                        </button>
                      ))}
                      {libraryResults.filter((item) => !linkedResources.some((resource) => resource.id === item.id)).length === 0 ? <div className="pick-empty show">未找到匹配的图书，换个关键词试试</div> : null}
                    </div>
                  </div>
                  <p className="pre-hint">从图书馆搜索并关联图书，如【图书】民谣吉他入门一本通；点击结果加入，已关联项置灰；学员在知识点集详情页「关联图书馆」处可查看并下载</p>
                </section>
              </div>
            </form>

            <div className="wiz-foot">
              <button type="button" className="btn btn-ghost" onClick={() => router.push('/knowledge')}>← 返回知识点区</button>
              <span className="foot-hint">{status || '知识点区 · 新建知识点集'}</span>
              <span className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={saveCollectionDraft} disabled={busy}>保存草稿</button>
              <button type="button" className="btn btn-main" onClick={submitCollection} disabled={busy}>{busy ? '发布中...' : '发 布'}</button>
            </div>
          </div>
        </main>
      ) : (
        <main className="admin-wrap">
          <div className="wizard rise">
            <div className="wiz-head">
              <h1><mark>{editingId ? '编辑知识点' : '新建知识点'}</mark></h1>
              <span className="zone-badge">知识点区</span>
              <span className="eyebrow">CREATE KNOWLEDGE</span>
            </div>

            <form className="form-body" autoComplete="off" onSubmit={submitPoint}>
              <div className="form-cols">
                <section className="fsec">
                  <div className="fsec-title">基本信息</div>
                  <div className={`field${errors.name ? ' error' : ''}`} data-field="name">
                    <label>名称 <span className="cnt num">{point.name.length}/120</span></label>
                    <input type="text" value={point.name} maxLength={140} onChange={(event) => patchPoint({ name: event.target.value })} placeholder="如：右手分解和弦基础" />
                    <span className="err-msg">{errors.name || ''}</span>
                  </div>
                  <div className={`field${errors.description ? ' error' : ''}`} data-field="description">
                    <label>简介 <span className="cnt num">{point.description.length}/1000</span></label>
                    <textarea value={point.description} onChange={(event) => patchPoint({ description: event.target.value })} placeholder="这个知识点的教学目标、练习要点、常见问题…" />
                    <span className="err-msg">{errors.description || ''}</span>
                  </div>
                </section>

                <section className="fsec">
                  <div className="fsec-title">封面 <span className="note req">支持任意比例 · 上传后裁切为 1:1</span></div>
                  <div className="cover-flex" data-field="cover">
                    <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={(event) => handleCoverFile(event.target.files?.[0]).finally(() => { event.target.value = ''; })} />
                    <div className={`cover-box${point.cover ? ' has' : ''}`} role="button" tabIndex={0} onClick={() => coverInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') coverInputRef.current?.click(); }}>
                      {point.cover ? <><img src={point.cover} alt="知识点封面" /><button className="cov-rm" type="button" onClick={(event) => { event.stopPropagation(); patchPoint({ cover: '' }); }}>×</button></> : <><span className="t1">＋ 上传封面</span><span className="t2">任意比例 · 自动裁切 1:1</span><div className="vinyl"><i /></div></>}
                    </div>
                  </div>
                  <span className="err-msg">{errors.cover || ''}</span>
                </section>

                <section className="fsec">
                  <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                  <div className="pv-card">
                    <div className={`pv-cover${point.cover ? ' has-img' : ''}`} style={point.cover ? { backgroundImage: `url(${point.cover})` } : undefined}>
                      {!point.cover ? <div className="disc"><span className="lbl"><i /></span></div> : null}
                    </div>
                    <div className="pv-name">{point.name.trim() || '未命名知识点'}</div>
                    <div className="pv-meta num">知识点 · {point.parts.length} 个分段</div>
                  </div>
                </section>

                <PrerequisiteSection
                  prerequisites={prerequisites}
                  prerequisiteKeyword={prerequisiteKeyword}
                  setPrerequisiteKeyword={setPrerequisiteKeyword}
                  prerequisiteOptions={prerequisiteOptions}
                  isPrerequisiteSelected={isPrerequisiteSelected}
                  addPrerequisite={addPrerequisite}
                  removePrerequisite={removePrerequisite}
                />

                <section className="fsec full">
                  <div className="fsec-title">P 分段管理 <span className="note">逐个上传 P 视频 · 可增删 / 调顺序 · P 无需封面</span></div>
                  <div className="pmanage">
                    <div className="pmanage-head">
                      <span className="pm-t">P 分段</span>
                      <span className="pm-note">已添加 {point.parts.length} 段</span>
                      <button type="button" className="pm-add" onClick={() => setPoint({ ...point, parts: [...point.parts, makePart(nextPartNo)] })}>＋ 添加分段</button>
                    </div>
                    <div className="pm-list">
                      {point.parts.map((part, index) => (
                        <div className={`prow${errors[`part-${index}`] ? ' field error' : ''}`} data-field={`part-${index}`} key={part.id || `new-${index}`}>
                          <div className="pidx num">P{part.part_no || index + 1}<span className="pmark">第 {part.part_no || index + 1} 段</span></div>
                          <div className="wiz-part-main">
                            <input className="pname" value={part.title} onChange={(event) => updatePart(index, { title: event.target.value })} placeholder="P 标题" />
                            <span className="err-msg">{errors[`part-${index}`] || ''}</span>
                          </div>
                          <PartFileLabel part={part} onChange={(event) => updatePart(index, { video: event.target.files?.[0] || null })} />
                          <div className="pops">
                            <button type="button" data-op disabled={index === 0} onClick={() => movePart(index, -1)}>↑</button>
                            <button type="button" data-op disabled={index === point.parts.length - 1} onClick={() => movePart(index, 1)}>↓</button>
                            <button type="button" data-op onClick={() => removePart(part, index)}>×</button>
                          </div>
                        </div>
                      ))}
                      {point.parts.length === 0 ? <p className="empty-text">还没有 P 分段，请先添加。</p> : null}
                      {errors.parts ? <span className="err-msg" data-field="parts">{errors.parts}</span> : null}
                    </div>
                  </div>
                </section>

                <section className="fsec full">
                  <div className="fsec-title">附件资料 <span className="note">PDF / GP / MP3 / PNG · 学员逐个下载 · 可调顺序</span></div>
                  <div className="pmanage">
                    <div className="pmanage-head">
                      <span className="pm-t">附件</span>
                      <span className="pm-note num">已添加 {(point.attachments || []).length} 份</span>
                      <input ref={attachmentInputRef} type="file" multiple hidden onChange={(event) => addAttachments(event.target.files)} />
                      <button type="button" className="pm-add" onClick={() => attachmentInputRef.current?.click()}>＋ 添加附件</button>
                    </div>
                    <div className="pm-list">
                      {(point.attachments || []).map((item, index) => (
                        <div className="frow" key={item.id || item.file_key || `${item.file_name}-${index}`}>
                          <span className="fico">{attachmentBadge(item.file_name)}</span>
                          <span><span className="fname">{item.file_name}</span><span className="fmeta">{formatSize(item.file_size)} · {item.file ? '待上传' : '已上传'}</span></span>
                          <div className="pops">
                            <button type="button" data-op disabled={index === 0} onClick={() => updateAttachmentOrder(index, -1)}>↑</button>
                            <button type="button" data-op disabled={index === (point.attachments || []).length - 1} onClick={() => updateAttachmentOrder(index, 1)}>↓</button>
                            <button type="button" data-op onClick={() => removeAttachment(index)}>×</button>
                          </div>
                        </div>
                      ))}
                      {(point.attachments || []).length === 0 ? <p className="empty-text">还没有附件资料，请先添加。</p> : null}
                    </div>
                  </div>
                </section>

                <section className="fsec full">
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
                  <p className="pre-hint">从图书馆搜索并关联图书，如【图书】民谣吉他入门一本通；点击结果加入，已关联项置灰；学员在知识点详情页右下「关联图书馆」处可查看并下载</p>
                </section>

              </div>

              <div className="wiz-foot">
                <button className="btn btn-ghost" type="button" onClick={() => router.push('/knowledge')}>← 返回知识点区</button>
                <span className="foot-hint">{status || '知识点区 · 新建单知识点'}</span>
                <span className="spacer" />
                <button className="btn btn-ghost" type="button" onClick={saveDraft} disabled={busy}>保存草稿</button>
                <button className="btn btn-main" type="submit" disabled={busy}>{busy ? '发布中...' : '发 布'}</button>
              </div>
            </form>
          </div>
        </main>
      )}
    </>
  );
}

function PrerequisiteSection({ prerequisites, prerequisiteKeyword, setPrerequisiteKeyword, prerequisiteOptions, isPrerequisiteSelected, addPrerequisite, removePrerequisite }) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <section className="fsec full">
      <div className="fsec-title">前置知识点 <span className="note">可选 · 支持单知识点 / 知识点集 / 单曲目 / 曲谱集</span></div>
      <p className="pick-count">已选 <b className="num">{prerequisites.length}</b> 项前置内容</p>
      <div className={`picked-list${prerequisites.length ? ' has-items' : ''}`} aria-label="已选前置内容">
        {prerequisites.map((item) => (
          <span className="picked-chip" key={`${item.objectType}-${item.objectId}`}>
            <span className="nm">
              <span className={`ptag ${prerequisiteTagClass(item.objectType)}`}>{prerequisiteLabel(item.objectType)}</span>
              {item.title}
            </span>
            <button className="rm" type="button" onClick={() => removePrerequisite(item)} aria-label={`移除 ${item.title}`}>✕</button>
          </span>
        ))}
      </div>
      <div className="pre-picker">
        <label className={`pick-search big${prerequisiteKeyword ? ' has' : ''}`} onFocus={() => setIsFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setTimeout(() => setIsFocused(false), 120); }}>
          <SearchIcon />
          <input type="text" value={prerequisiteKeyword} onChange={(event) => setPrerequisiteKeyword(event.target.value)} placeholder="搜索单知识点 / 知识点集 / 单曲目 / 曲谱集…" />
          <button type="button" className="clr" onClick={() => setPrerequisiteKeyword('')}>清除</button>
        </label>
        <div className={`pre-drop${isFocused && prerequisiteKeyword.trim() ? ' open' : ''}`} onMouseDown={(event) => event.preventDefault()}>
          {prerequisiteOptions.map((item) => (
            <button type="button" className={`pre-item${isPrerequisiteSelected(item) ? ' off' : ''}`} onClick={() => addPrerequisite(item)} key={`${item.objectType}-${item.objectId}`}>
              <span className={`ptag ${prerequisiteTagClass(item.objectType)}`}>{prerequisiteLabel(item.objectType)}</span>
              <span className="pnm">{item.title}</span>
              <span className="pmeta">{isPrerequisiteSelected(item) ? '已加入' : '点击加入'}</span>
            </button>
          ))}
          {prerequisiteOptions.length === 0 ? <div className="pick-empty show">未找到匹配的前置内容，换个关键词试试</div> : null}
        </div>
      </div>
      <p className="pre-hint">按「类型 + 标题」选取前置内容：知识点集 · 单知识点 · 单曲目 · 曲谱集，如【知识点集】右手基本功系列、【单曲谱】稻香 · 弹唱谱；点击结果加入，已选项置灰</p>
    </section>
  );
}
