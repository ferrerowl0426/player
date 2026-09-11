'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../../../../components/ui/AppNav.js';
import {
  createTrackCollection,
  fetchAdminMe,
  fetchKnowledgeLibrary,
  fetchTrackLibrary,
  savePrerequisites,
  updateTrackCollectionItems
} from '../../../../lib/api.js';

const PAGE_SIZE = 16;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function Pager({ page, total, onChange }) {
  const pages = Array.from({ length: Math.min(total, 5) }, (_, index) => index + 1);
  return (
    <nav className="pager" aria-label="合集内容分页">
      <button type="button" className="pgbtn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">‹</button>
      <span className="pgnums num">
        {pages.map((item) => <button type="button" className={item === page ? 'pgnum on' : 'pgnum'} onClick={() => onChange(item)} key={item}>{item}</button>)}
        {total > 5 ? <span className="pgdots">…</span> : null}
      </span>
      <button type="button" className="pgbtn" disabled={page >= total} onClick={() => onChange(page + 1)} aria-label="下一页">›</button>
    </nav>
  );
}

export default function AdminTrackCollectionsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [collection, setCollection] = useState({ name: '', description: '', cover: '' });
  const [trackLibrary, setTrackLibrary] = useState({ track_points: [], track_collections: [] });
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ knowledge_points: [], knowledge_collections: [] });
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [prerequisites, setPrerequisites] = useState([]);
  const [trackKeyword, setTrackKeyword] = useState('');
  const [preKeyword, setPreKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('正在检查登录状态...');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }
        const [tracks, knowledge] = await Promise.all([fetchTrackLibrary(''), fetchKnowledgeLibrary('')]);
        setAdmin(me.data);
        setTrackLibrary(tracks.data);
        setKnowledgeLibrary(knowledge.data);
        setStatus('');
      } catch (error) {
        router.replace('/admin/login');
      }
    }
    init();
  }, [router]);

  const selectedTracks = selectedTrackIds
    .map((id) => (trackLibrary.track_points || []).find((track) => track.id === id))
    .filter(Boolean);

  const filteredTracks = useMemo(() => {
    const keyword = trackKeyword.trim().toLowerCase();
    return (trackLibrary.track_points || []).filter((track) => !keyword || track.name.toLowerCase().includes(keyword));
  }, [trackLibrary, trackKeyword]);

  const total = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE));
  const visibleTracks = filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const prerequisiteOptions = useMemo(() => {
    const items = [
      ...(knowledgeLibrary.knowledge_collections || []).map((item) => ({ objectType: 'knowledge_collection', objectId: item.id, title: item.name, tag: '知识点集' })),
      ...(knowledgeLibrary.knowledge_points || []).map((item) => ({ objectType: 'knowledge_point', objectId: item.id, title: item.name, tag: '单知识点' })),
      ...(trackLibrary.track_points || []).map((item) => ({ objectType: 'track_point', objectId: item.id, title: item.name, tag: '单曲目' })),
      ...(trackLibrary.track_collections || []).map((item) => ({ objectType: 'track_collection', objectId: item.id, title: item.name, tag: '曲谱集' }))
    ];
    const keyword = preKeyword.trim().toLowerCase();
    return items.filter((item) => !keyword || `${item.tag} ${item.title}`.toLowerCase().includes(keyword)).slice(0, 12);
  }, [knowledgeLibrary, preKeyword, trackLibrary]);

  function isPrerequisiteSelected(item) {
    return prerequisites.some((selected) => selected.objectType === item.objectType && selected.objectId === item.objectId);
  }

  function addPrerequisite(item) {
    if (!isPrerequisiteSelected(item)) setPrerequisites((current) => [...current, item]);
  }

  function removePrerequisite(item) {
    setPrerequisites((current) => current.filter((selected) => !(selected.objectType === item.objectType && selected.objectId === item.objectId)));
  }

  function toggleTrack(id) {
    setSelectedTrackIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function moveTrack(index, offset) {
    setSelectedTrackIds((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!collection.name.trim()) {
      setStatus('请填写合集名称');
      return;
    }

    setBusy(true);
    try {
      const created = await createTrackCollection(collection);
      const collectionId = created.data.id;
      await updateTrackCollectionItems({ id: collectionId, trackIds: selectedTrackIds });
      await savePrerequisites({ objectType: 'track_collection', objectId: collectionId, prerequisites });
      setStatus('曲谱集发布成功');
      router.push(`/tracks/collections/${collectionId}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!admin) return <p className="empty-text">{status}</p>;

  return (
    <>
      <AppNav role="super_admin" accountName={admin.nickname || admin.username} homeHref="/admin" actions={<span className="role-tag">教导主任工作台 · {admin.nickname || admin.username}</span>} />
      <main className="admin-wrap">
        <div className="wizard rise">
          <div className="wiz-head">
            <h1><mark>新建合集</mark></h1>
            <span className="zone-badge">曲目区</span>
            <span className="eyebrow">CREATE COLLECTION</span>
          </div>

          <form className="form-body" autoComplete="off" onSubmit={submit}>
            <div className="form-cols">
              <section className="fsec">
                <div className="fsec-title">基本信息</div>
                <div className="field">
                  <label>合集名称 <span className="cnt num">{collection.name.length}/120</span></label>
                  <input type="text" value={collection.name} onChange={(event) => setCollection({ ...collection, name: event.target.value })} placeholder="如：周杰伦专辑 · 指弹改编合集" maxLength={140} />
                </div>
                <div className="field">
                  <label>简介 <span className="cnt num">{collection.description.length}/1000</span></label>
                  <textarea value={collection.description} onChange={(event) => setCollection({ ...collection, description: event.target.value })} placeholder="这个合集收录哪些曲目、适合什么阶段的学员…" />
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">封面 <span className="note req">1:1 · 必填</span></div>
                <div className="cover-flex">
                  <div className={`cover-box${collection.cover ? ' has' : ''}`}>
                    {collection.cover ? <img src={collection.cover} alt="合集封面" /> : <><span className="t1">上传封面</span><span className="t2">比例 1:1 · 必填</span><div className="vinyl"><i /></div></>}
                  </div>
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <input type="text" value={collection.cover} onChange={(event) => setCollection({ ...collection, cover: event.target.value })} placeholder="填写已存在的公开图片 URL" />
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                <div className="pv-card">
                  <div className={`pv-cover${collection.cover ? ' has-img' : ''}`} style={collection.cover ? { backgroundImage: `url(${collection.cover})` } : undefined}>
                    {!collection.cover ? <div className="disc"><span className="lbl"><i /></span></div> : null}
                  </div>
                  <div className="pv-name">{collection.name.trim() || '未命名合集'}</div>
                  <div className="pv-meta num">曲目集 · 已选 {selectedTrackIds.length} 首</div>
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">前置知识点 <span className="note">学员需先掌握这些内容，再进入本合集学习</span></div>
                <p className="pick-count">已选 <b className="num">{prerequisites.length}</b> 个前置内容<span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· 上方已选条目可点 × 快捷移除</span></p>
                <div className="picked-list" aria-label="已选前置知识点">
                  {prerequisites.map((item) => (
                    <span className="picked-chip" key={`${item.objectType}-${item.objectId}`}>
                      <span className="ptag t-kp">{item.tag}</span><span className="nm">{item.title}</span>
                      <button type="button" className="rm" onClick={() => removePrerequisite(item)}>×</button>
                    </span>
                  ))}
                </div>
                <div className="pre-picker">
                  <label className={`pick-search big${preKeyword ? ' has' : ''}`}>
                    <SearchIcon />
                    <input type="text" value={preKeyword} onChange={(event) => setPreKeyword(event.target.value)} placeholder="搜索知识点集 / 单知识点 / 曲目集 / 单曲谱…" />
                    <button type="button" className="clr" onClick={() => setPreKeyword('')}>清除</button>
                  </label>
                  <div className="pre-drop open">
                    {prerequisiteOptions.map((item) => (
                      <button type="button" className={`pre-item${isPrerequisiteSelected(item) ? ' off' : ''}`} onClick={() => addPrerequisite(item)} key={`${item.objectType}-${item.objectId}`}>
                        <span className="ptag t-kp">{item.tag}</span><span className="pnm">{item.title}</span><span className="pmeta">点击加入</span>
                      </button>
                    ))}
                    {prerequisiteOptions.length === 0 ? <div className="pick-empty show">未找到匹配的内容，换个关键词试试</div> : null}
                  </div>
                </div>
                <p className="pre-hint">按「类型 + 标题」选取前置内容；点击结果加入，已选项置灰。</p>
              </section>

              <section className="fsec full">
                <div className="fsec-title">从已有单课中多选加入 <span className="note">一首课可同时进入多个合集</span></div>
                <p className="pick-count">已选 <b className="num">{selectedTrackIds.length}</b> 首曲目<span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· 顺序即合集内播放顺序：上方已选条目可点 ↑↓ 调序、× 快捷移除</span></p>
                <div className="picked-list" aria-label="已加入合集的内容">
                  {selectedTracks.map((track, index) => (
                    <span className="picked-chip" key={track.id}>
                      <span className="seq num">{index + 1}</span><span className="nm">{track.name}</span>
                      <button type="button" className="mv" disabled={index === 0} onClick={() => moveTrack(index, -1)}>↑</button>
                      <button type="button" className="mv" disabled={index === selectedTracks.length - 1} onClick={() => moveTrack(index, 1)}>↓</button>
                      <button type="button" className="rm" onClick={() => toggleTrack(track.id)}>×</button>
                    </span>
                  ))}
                </div>
                <label className={`pick-search big${trackKeyword ? ' has' : ''}`}>
                  <SearchIcon />
                  <input type="text" value={trackKeyword} onChange={(event) => { setTrackKeyword(event.target.value); setPage(1); }} placeholder="搜索名称…" />
                  <button type="button" className="clr" onClick={() => setTrackKeyword('')}>清除</button>
                </label>
                <div className="pick-grid">
                  {visibleTracks.map((track, index) => (
                    <button type="button" className={selectedTrackIds.includes(track.id) ? 'pick-card sel' : 'pick-card'} onClick={() => toggleTrack(track.id)} key={track.id}>
                      <span className={`pc-cover v${(index % 3) + 1}${track.cover ? ' img' : ''}`} style={track.cover ? { backgroundImage: `url(${track.cover})` } : undefined} />
                      <span className="pc-name">{track.name}</span>
                      <span className="pc-meta num">{track.part_count || 0} 个分段</span>
                      <span className="pc-check">✓</span>
                    </button>
                  ))}
                </div>
                <Pager page={page} total={total} onChange={setPage} />
                {visibleTracks.length === 0 ? <div className="pick-empty show">未找到匹配的内容，换个关键词试试</div> : null}
              </section>
            </div>
          </form>

          <div className="wiz-foot">
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/admin/tracks')}>← 返回</button>
            <span className="foot-hint">{status || '曲目区 · 新建合集'}</span>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" disabled>保存草稿</button>
            <button type="button" className="btn btn-main" onClick={submit} disabled={busy}>{busy ? '发布中...' : '发 布'}</button>
          </div>
        </div>
      </main>
    </>
  );
}
