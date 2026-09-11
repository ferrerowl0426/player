'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
// TODO(M4 cleanup): 知识点管理页仍是旧紧凑表单；M4 需按 admin-create-track-point/collection 同构返工。
import { fetchAdminMe, fetchKnowledgeLibrary, fetchKnowledgePointById, createKnowledgePoint, updateKnowledgePoint, deleteKnowledgePoint, createKnowledgePartUpload, createKnowledgePartUploadUrl, completeKnowledgePartUpload, abortKnowledgePartUpload, saveKnowledgePart, updateKnowledgePart, deleteKnowledgePart, uploadMultipartPartToBucket } from '../../../lib/api.js';
import { uploadVideoByMultipart } from '../../../components/uploadVideo.js';

function emptyPart(no) { return { id: null, part_no: no, title: '', duration: '', video: null, video_url: '' }; }

export default function AdminKnowledgePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [point, setPoint] = useState({ name: '', description: '', cover: '', parts: [] });
  const [status, setStatus] = useState('正在检查登录状态...');
  const [busy, setBusy] = useState(false);
  const nextNo = useMemo(() => point.parts.reduce((max, item) => Math.max(max, Number(item.part_no) || 0), 0) + 1, [point.parts]);

  async function reload() { const result = await fetchKnowledgeLibrary(''); setItems(result.data.points || []); }
  useEffect(() => { fetchAdminMe().then(async (result) => { if (result.data.role !== 'super_admin') { router.replace('/admin'); return; } await reload(); setReady(true); setStatus(''); }).catch(() => router.replace('/admin/login')); }, [router]);
  function patchPart(index, patch) { setPoint((current) => ({ ...current, parts: current.parts.map((part, partIndex) => partIndex === index ? { ...part, ...patch } : part) })); }
  async function uploadPart(pointId, part, index) {
    const created = await createKnowledgePartUpload({ pointId, partNo: Number(part.part_no), title: part.title, video: part.video });
    const info = created.data.video;
    try {
      const parts = await uploadVideoByMultipart({ file: part.video, key: info.key, uploadId: info.uploadId, onProgress: (value) => setStatus(`正在上传 P${part.part_no}：${value}%`), uploadPart: async ({ key, uploadId, partNumber }) => (await createKnowledgePartUploadUrl({ pointId, key, uploadId, partNumber })).data.uploadUrl, uploadPartFile: uploadMultipartPartToBucket });
      await completeKnowledgePartUpload({ pointId, key: info.key, uploadId: info.uploadId, parts });
    } catch (error) { await abortKnowledgePartUpload({ pointId, key: info.key, uploadId: info.uploadId }).catch(() => {}); throw error; }
    await saveKnowledgePart({ pointId, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0, videoKey: info.key });
    patchPart(index, { id: `uploaded-${Date.now()}`, video: null, video_url: info.publicUrl });
  }
  async function submit(event) {
    event.preventDefault(); if (!point.name.trim()) { setStatus('请填写知识点名称'); return; } setBusy(true);
    try { let pointId = editingId; const data = { name: point.name, description: point.description, cover: point.cover }; if (pointId) await updateKnowledgePoint({ id: pointId, ...data }); else { pointId = (await createKnowledgePoint(data)).data.id; setEditingId(pointId); } for (const [index, part] of point.parts.entries()) if (part.video && !part.id) await uploadPart(pointId, part, index); for (const part of point.parts.filter((item) => item.id && !String(item.id).startsWith('uploaded-'))) await updateKnowledgePart({ pointId, partId: part.id, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0 }); await reload(); const result = await fetchKnowledgePointById(pointId); setPoint({ ...result.data, parts: result.data.parts.map((part) => ({ ...part, video: null })) }); setStatus('知识点保存成功'); } catch (error) { setStatus(error.message); } finally { setBusy(false); }
  }
  async function removePart(part, index) { if (part.id && !String(part.id).startsWith('uploaded-')) await deleteKnowledgePart({ pointId: editingId, partId: part.id }); setPoint((current) => ({ ...current, parts: current.parts.filter((_, i) => i !== index) })); }
  async function removePoint(id) { if (!window.confirm('确定删除这个知识点吗？')) return; await deleteKnowledgePoint(id); if (id === editingId) { setEditingId(null); setPoint({ name: '', description: '', cover: '', parts: [] }); } await reload(); }
  if (!ready) return <p className="empty-text">{status}</p>;
  return <div className="admin-track-page"><section className="hero"><div><h1>知识点管理</h1><p>复用曲目管理流程，知识点和 P 分段内容仅教导主任可管理。</p></div><a className="hero-button" href="/admin">返回后台</a></section><div className="admin-track-layout"><section className="video-section"><div className="section-title"><h2>知识点列表</h2><button type="button" onClick={() => { setEditingId(null); setPoint({ name: '', description: '', cover: '', parts: [] }); }}>新建知识点</button></div>{items.map((item) => <div className="admin-track-row" key={item.id}><div><strong>{item.name}</strong><span>{item.part_count || 0} 个分段</span></div><div><button type="button" onClick={async () => { const result = await fetchKnowledgePointById(item.id); setEditingId(item.id); setPoint({ ...result.data, parts: result.data.parts.map((part) => ({ ...part, video: null })) }); }}>编辑</button><button type="button" onClick={() => removePoint(item.id)}>删除</button></div></div>)}</section><section className="video-section"><div className="section-title"><h2>{editingId ? `编辑：${point.name}` : '新建知识点'}</h2></div><form className="admin-track-form" onSubmit={submit}><label>知识点名称<input value={point.name} onChange={(event) => setPoint({ ...point, name: event.target.value })} /></label><label>简介<textarea value={point.description} onChange={(event) => setPoint({ ...point, description: event.target.value })} /></label><label>封面 URL<input value={point.cover} onChange={(event) => setPoint({ ...point, cover: event.target.value })} /></label><div className="section-title"><h3>P 分段</h3><button type="button" onClick={() => setPoint({ ...point, parts: [...point.parts, emptyPart(nextNo)] })}>添加 P</button></div>{point.parts.map((part, index) => <div className="admin-part-row" key={part.id || index}><input value={part.part_no} onChange={(event) => patchPart(index, { part_no: event.target.value })} placeholder="序号" /><input value={part.title} onChange={(event) => patchPart(index, { title: event.target.value })} placeholder="P 标题" /><input type="number" value={part.duration} onChange={(event) => patchPart(index, { duration: event.target.value })} placeholder="时长/秒" />{part.video_url ? <span className="section-note">已上传</span> : <input type="file" accept="video/*" onChange={(event) => patchPart(index, { video: event.target.files?.[0] || null })} />}<button type="button" onClick={() => removePart(part, index)}>删除</button></div>)}<button className="primary-button" type="submit" disabled={busy}>{busy ? '保存中...' : '保存知识点'}</button></form><p className="track-status">{status}</p></section></div></div>;
}
