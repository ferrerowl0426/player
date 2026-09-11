'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import {
  abortTrackPartUpload,
  completeTrackPartUpload,
  createTrack,
  createTrackPartUpload,
  createTrackPartUploadUrl,
  deleteTrack,
  deleteTrackPart,
  fetchAdminMe,
  fetchKnowledgeLibrary,
  fetchPrerequisites,
  fetchTrackById,
  fetchTrackLibrary,
  savePrerequisites,
  saveTrackPart,
  updateTrack,
  updateTrackPart,
  uploadMultipartPartToBucket
} from '../../../lib/api.js';
import { uploadVideoByMultipart } from '../../../components/uploadVideo.js';

function makePart(partNo = '') {
  return { id: null, part_no: partNo, title: '', duration: '', video: null, video_url: '' };
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
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [library, setLibrary] = useState({ track_points: [], track_collections: [] });
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ knowledge_points: [], knowledge_collections: [] });
  const [editingId, setEditingId] = useState(null);
  const [track, setTrack] = useState({ name: '', description: '', cover: '', parts: [] });
  const [prerequisites, setPrerequisites] = useState([]);
  const [prerequisiteKeyword, setPrerequisiteKeyword] = useState('');
  const [status, setStatus] = useState('正在检查登录状态...');
  const [busy, setBusy] = useState(false);

  const isEditing = Boolean(editingId);
  const nextPartNo = useMemo(() => (track.parts.reduce((max, part) => Math.max(max, Number(part.part_no) || 0), 0) + 1), [track.parts]);

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
          router.replace('/admin');
          return;
        }
        setAdmin(me.data);
        await reloadLibrary();
        setStatus('');
      } catch (error) {
        router.replace('/admin/login');
      }
    }
    init();
  }, [router]);

  async function editTrack(id) {
    setStatus('正在加载曲目...');
    const [result, prerequisiteResult] = await Promise.all([
      fetchTrackById(id),
      fetchPrerequisites({ objectType: 'track_point', objectId: id }).catch(() => ({ data: [] }))
    ]);
    setEditingId(id);
    setTrack({ ...result.data, parts: result.data.parts.map((part) => ({ ...part, video: null })) });
    setPrerequisites(prerequisiteResult.data || []);
    setStatus('');
  }

  function startNewTrack() {
    setEditingId(null);
    setTrack({ name: '', description: '', cover: '', parts: [] });
    setPrerequisites([]);
    setPrerequisiteKeyword('');
    setStatus('');
  }

  function updatePart(index, patch) {
    setTrack((current) => ({ ...current, parts: current.parts.map((part, partIndex) => partIndex === index ? { ...part, ...patch } : part) }));
  }

  function prerequisiteLabel(type) {
    if (type === 'knowledge_collection') return '知识点集';
    if (type === 'knowledge_point') return '单知识点';
    if (type === 'track_collection') return '曲谱集';
    return '单曲目';
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
  }

  function removePrerequisite(item) {
    setPrerequisites((current) => current.filter((selected) => !(selected.objectType === item.objectType && selected.objectId === item.objectId)));
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
    if (!track.name.trim()) {
      setStatus('请填写曲目名称');
      return;
    }

    setBusy(true);
    try {
      let trackId = editingId;
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

      for (const part of track.parts.filter((item) => item.id && !String(item.id).startsWith('uploaded-') && item.title)) {
        await updateTrackPart({ trackId, partId: part.id, partNo: Number(part.part_no), title: part.title, duration: Number(part.duration) || 0 });
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
              <section className="fsec">
                <div className="fsec-title">基本信息</div>
                <div className="field">
                  <label>名称 <span className="cnt num">{track.name.length}/120</span></label>
                  <input type="text" value={track.name} onChange={(event) => setTrack({ ...track, name: event.target.value })} placeholder="如：卡农（Johann Pachelbel · 指弹改编）" />
                </div>
                <div className="field">
                  <label>简介 <span className="cnt num">{track.description.length}/1000</span></label>
                  <textarea value={track.description} onChange={(event) => setTrack({ ...track, description: event.target.value })} placeholder="本课的教学目标、适合阶段、练习建议…" />
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">封面 <span className="note req">1:1 · 必填 · 分 P 无需封面</span></div>
                <div className="cover-flex">
                  <div className={`cover-box${track.cover ? ' has' : ''}`}>
                    {track.cover ? <img src={track.cover} alt="曲目封面" /> : <><span className="t1">上传封面</span><span className="t2">比例 1:1 · 必填</span><div className="vinyl"><i /></div></>}
                  </div>
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>封面 URL</label>
                  <input type="text" value={track.cover} onChange={(event) => setTrack({ ...track, cover: event.target.value })} placeholder="填写已存在的公开图片 URL" />
                </div>
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
                <div className="picked-list" aria-label="已选前置内容">
                  {prerequisites.map((item) => (
                    <span className="picked-chip" key={`${item.objectType}-${item.objectId}`}>
                      <span className="ptag">{prerequisiteLabel(item.objectType)}</span>
                      <span className="nm">{item.title}</span>
                      <button className="rm" type="button" onClick={() => removePrerequisite(item)}>×</button>
                    </span>
                  ))}
                </div>
                <div className="pre-picker">
                  <label className={`pick-search big${prerequisiteKeyword ? ' has' : ''}`}>
                    <input type="text" value={prerequisiteKeyword} onChange={(event) => setPrerequisiteKeyword(event.target.value)} placeholder="搜索单知识点 / 知识点集 / 单曲目 / 曲谱集…" />
                    <button type="button" className="clr" onClick={() => setPrerequisiteKeyword('')}>清除</button>
                  </label>
                  <div className="pre-drop open">
                    {prerequisiteResults.map((item) => (
                      <button type="button" className={`pre-item${isPrerequisiteSelected(item) ? ' off' : ''}`} onClick={() => togglePrerequisite(item)} key={`${item.objectType}-${item.objectId}`}>
                        <span className="ptag">{prerequisiteLabel(item.objectType)}</span>
                        <span className="pnm">{item.title}</span>
                        <span className="pmeta">点击加入</span>
                      </button>
                    ))}
                    {prerequisiteResults.length === 0 ? <div className="pick-empty show">未找到匹配的前置内容，换个关键词试试</div> : null}
                  </div>
                </div>
                <p className="pre-hint">按「类型 + 标题」选取前置内容；只禁止直接选择当前对象自身，不做环形依赖判定。</p>
              </section>

              <section className="fsec full">
                <div className="fsec-title">P 分段管理 <span className="note">逐个上传 P 视频 · 可增删 / 调顺序 · P 无需封面</span></div>
                <div className="pmanage">
                  <div className="pmanage-head">
                    <span className="pm-t">分段列表</span>
                    <span className="pm-note">按序号播放，支持后续继续追加</span>
                    <button type="button" className="pm-add" onClick={() => setTrack({ ...track, parts: [...track.parts, makePart(nextPartNo)] })}>＋ 添加 P</button>
                  </div>
                  <div className="pm-list">
                    {track.parts.map((part, index) => (
                      <div className="prow" key={part.id || `new-${index}`}>
                        <div className="pidx"><span className="pmark">P</span>{part.part_no || index + 1}</div>
                        <input className="pname" value={part.title} onChange={(event) => updatePart(index, { title: event.target.value })} placeholder="P 标题" />
                        <PartFileLabel part={part} onChange={(event) => updatePart(index, { video: event.target.files?.[0] || null })} />
                        <div className="pops"><button type="button" onClick={() => removePart(part, index)}>删</button></div>
                      </div>
                    ))}
                    {track.parts.length === 0 ? <p className="empty-text">还没有 P 分段，请先添加。</p> : null}
                  </div>
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">附件资料 <span className="note">PDF / GP / MP3 / PNG · 学员逐个下载 · 可调顺序</span></div>
                <div className="pmanage">
                  <div className="pmanage-head">
                    <span className="pm-t">附件</span>
                    <span className="pm-note num">M3 暂未接入上传，保留设计稿位置</span>
                    <button type="button" className="pm-add" disabled>＋ 添加附件</button>
                  </div>
                  <div className="pm-list">
                    <p className="empty-text">附件上传将在资料阶段接入，这里先按设计稿预留区域。</p>
                  </div>
                </div>
              </section>
            </div>

            <div className="wiz-foot">
              <button className="btn btn-main" type="submit" disabled={busy}>{busy ? '保存中...' : '保存曲目'}</button>
              <button className="btn btn-ghost" type="button" onClick={startNewTrack}>新建空白曲目</button>
              <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/tracks/collections')}>新建曲谱集</button>
              <span className="spacer" />
              <span className="foot-hint">{status || '保存后将同步曲目库与 P 分段'}</span>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
