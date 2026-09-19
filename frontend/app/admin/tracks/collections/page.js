'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppNav from '../../../../components/ui/AppNav.js';
import {
  createTrackCollection,
  fetchAdminMe,
  fetchCollectionById,
  fetchKnowledgeLibrary,
  fetchTrackLibrary,
  fetchPrerequisites,
  fetchLibraryResources,
  createLibraryUploadUrl,
  uploadLibraryFileToBucket,
  saveContentLibraryLinks,
  savePrerequisites,
  updateTrackCollection,
  updateTrackCollectionItems
} from '../../../../lib/api.js';

const PAGE_SIZE = 16;
const DRAFT_KEY = 'admin-track-collection-draft';

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function Pager({ page, total, onChange }) {
  const pages = Array.from({ length: Math.min(total, 5) }, (_, index) => Math.max(1, Math.min(total - 4, page - 2)) + index).filter((item) => item <= total);
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
  return (
    <Suspense fallback={<p className="empty-text">正在加载曲目合集...</p>}>
      <AdminTrackCollectionsContent />
    </Suspense>
  );
}

function AdminTrackCollectionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = Number(searchParams.get('id')) || null;
  const [admin, setAdmin] = useState(null);
  const [collection, setCollection] = useState({ name: '', description: '', cover: '' });
  const [trackLibrary, setTrackLibrary] = useState({ track_points: [], track_collections: [] });
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ knowledge_points: [], knowledge_collections: [] });
  const [selectedTrackIds, setSelectedTrackIds] = useState([]);
  const [prerequisites, setPrerequisites] = useState([]);
  const [linkedResources, setLinkedResources] = useState([]);
  const [originalLinkedResourceIds, setOriginalLinkedResourceIds] = useState([]);
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [libraryResults, setLibraryResults] = useState([]);
  const [isLibraryFocused, setIsLibraryFocused] = useState(false);
  const [trackKeyword, setTrackKeyword] = useState('');
  const [preKeyword, setPreKeyword] = useState('');
  const [isPreFocused, setIsPreFocused] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('正在检查登录状态...');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const coverInputRef = useRef(null);
  const [draftAvailable, setDraftAvailable] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }
        const [tracks, knowledge, resources] = await Promise.all([fetchTrackLibrary(''), fetchKnowledgeLibrary(''), fetchLibraryResources('')]);
        setAdmin(me.data);
        setTrackLibrary(tracks.data);
        setKnowledgeLibrary(knowledge.data);
        setLibraryResults(resources.data || []);
        setDraftAvailable(Boolean(localStorage.getItem(DRAFT_KEY)));
        if (initialId) await editCollection(initialId);
        setStatus('');
      } catch (error) {
        router.replace('/admin/login');
      }
    }
    init();
  }, [router, initialId]);

  async function editCollection(id) {
    setStatus('正在加载曲谱集...');
    const [result, prerequisiteResult] = await Promise.all([
      fetchCollectionById(id),
      fetchPrerequisites({ objectType: 'track_collection', objectId: id }).catch(() => ({ data: [] }))
    ]);
    const data = result.data;
    setCollection({ name: data.name || '', description: data.description || '', cover: data.cover || '' });
    setSelectedTrackIds((data.track_points || data.tracks || []).map((item) => item.id));
    setPrerequisites(prerequisiteResult.data || []);
    setLinkedResources(data.library_resources || []);
    setOriginalLinkedResourceIds((data.library_resources || []).map((item) => item.id));
    setStatus('');
  }

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
      ...(knowledgeLibrary.knowledge_collections || []).map((item) => ({ objectType: 'knowledge_collection', objectId: item.id, title: item.name, tag: '知识点集', tagClass: 't-kset' })),
      ...(knowledgeLibrary.knowledge_points || []).map((item) => ({ objectType: 'knowledge_point', objectId: item.id, title: item.name, tag: '单知识点', tagClass: 't-kp' })),
      ...(trackLibrary.track_points || []).map((item) => ({ objectType: 'track_point', objectId: item.id, title: item.name, tag: '单曲目', tagClass: 't-track' })),
      ...(trackLibrary.track_collections || []).filter((item) => item.id !== initialId).map((item) => ({ objectType: 'track_collection', objectId: item.id, title: item.name, tag: '曲谱集', tagClass: 't-score' }))
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

  async function searchLibraryResources(keyword) {
    setLibraryKeyword(keyword);
    try {
      const result = await fetchLibraryResources(keyword);
      setLibraryResults(result.data || []);
    } catch (error) {
      setStatus(error.message || '搜索图书馆资料失败');
    }
  }

  async function handleCoverFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('请上传图片文件');
      return;
    }
    setStatus('正在上传封面...');
    try {
      const result = await createLibraryUploadUrl(file, 'cover');
      await uploadLibraryFileToBucket({ uploadUrl: result.data.uploadUrl, file });
      setCollection((current) => ({ ...current, cover: result.data.publicUrl }));
      setErrors((current) => ({ ...current, cover: undefined }));
      setStatus('封面上传成功');
    } catch (error) {
      setStatus(error.message || '封面上传失败');
    }
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ collection, selectedTrackIds, prerequisites, linkedResources, savedAt: Date.now() }));
    setDraftAvailable(true);
    setStatus('草稿已保存到本机');
  }

  function restoreDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setCollection({ name: '', description: '', cover: '', ...(draft.collection || {}) });
      setSelectedTrackIds(draft.selectedTrackIds || []);
      setPrerequisites(draft.prerequisites || []);
      setLinkedResources(draft.linkedResources || []);
      setStatus('已恢复本机草稿');
    } catch {
      setStatus('草稿读取失败');
    }
  }

  function addLinkedResource(item) {
    if (!linkedResources.some((resource) => resource.id === item.id)) {
      setLinkedResources((current) => [...current, item]);
    }
    setLibraryKeyword('');
    setIsLibraryFocused(false);
  }

  function removeLinkedResource(id) {
    setLinkedResources((current) => current.filter((item) => item.id !== id));
  }

  async function saveCollectionLibraryLinks(collectionId) {
    await saveContentLibraryLinks({
      objectType: 'track_collection',
      objectId: collectionId,
      selectedResourceIds: linkedResources.map((resource) => resource.id),
      originalResourceIds: originalLinkedResourceIds
    });
    setOriginalLinkedResourceIds(linkedResources.map((resource) => resource.id));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = {};
    if (!collection.name.trim()) nextErrors.name = '请填写合集名称';
    else if (collection.name.trim().length > 120) nextErrors.name = '合集名称最多 120 个字';
    if ((collection.description || '').length > 1000) nextErrors.description = '简介最多 1000 个字';
    if (!collection.cover) nextErrors.cover = '请上传封面';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setStatus('请先完善必填信息');
      return;
    }

    setBusy(true);
    try {
      let collectionId = initialId;
      if (collectionId) {
        await updateTrackCollection({ id: collectionId, ...collection });
      } else {
        const created = await createTrackCollection(collection);
        collectionId = created.data.id;
      }
      await updateTrackCollectionItems({ id: collectionId, trackIds: selectedTrackIds });
      await savePrerequisites({ objectType: 'track_collection', objectId: collectionId, prerequisites });
      await saveCollectionLibraryLinks(collectionId);
      localStorage.removeItem(DRAFT_KEY);
      setDraftAvailable(false);
      setStatus(initialId ? '曲谱集保存成功' : '曲谱集发布成功');
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
            <h1><mark>{initialId ? '编辑曲目合集' : '新建曲目合集'}</mark></h1>
            <span className="zone-badge">曲目区</span>
            <span className="eyebrow">CREATE COLLECTION</span>
          </div>

          <form className="form-body" autoComplete="off" onSubmit={submit}>
              <div className="form-cols">
                {draftAvailable && !initialId ? (
                  <div className="draft-tip">
                    检测到本机保存的曲目合集草稿，可恢复继续编辑。
                    <span className="spacer" />
                    <button className="btn btn-ghost" type="button" onClick={restoreDraft}>恢复草稿</button>
                  </div>
                ) : null}
              <section className="fsec">
                <div className="fsec-title">基本信息</div>
                  <div className={`field${errors.name ? ' error' : ''}`}>
                  <label>合集名称 <span className="cnt num">{collection.name.length}/120</span></label>
                  <input type="text" value={collection.name} onChange={(event) => { setCollection({ ...collection, name: event.target.value }); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="如：周杰伦专辑 · 指弹改编合集" maxLength={140} />
                  <span className="err-msg">{errors.name || ''}</span>
                </div>
                  <div className={`field${errors.description ? ' error' : ''}`}>
                  <label>简介 <span className="cnt num">{collection.description.length}/1000</span></label>
                  <textarea value={collection.description} onChange={(event) => { setCollection({ ...collection, description: event.target.value }); setErrors((current) => ({ ...current, description: undefined })); }} placeholder="这个合集收录哪些曲目、适合什么阶段的学员…" />
                  <span className="err-msg">{errors.description || ''}</span>
                </div>
              </section>

              <section className="fsec">
                  <div className="fsec-title">封面 <span className="note req">支持任意比例 · 上传后裁切为 1:1</span></div>
                  <div className={`cover-flex${errors.cover ? ' error' : ''}`}>
                    <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={(event) => handleCoverFile(event.target.files?.[0]).finally(() => { event.target.value = ''; })} />
                    <div className={`cover-box${collection.cover ? ' has' : ''}`} role="button" tabIndex={0} onClick={() => coverInputRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); coverInputRef.current?.click(); } }}>
                      {collection.cover ? <><img src={collection.cover} alt="合集封面" /><button type="button" className="cov-rm" aria-label="移除封面" onClick={(event) => { event.stopPropagation(); setCollection((current) => ({ ...current, cover: '' })); }}>×</button></> : <><span className="t1">＋ 上传封面</span><span className="t2">任意比例 · 自动裁切 1:1</span><div className="vinyl"><i /></div></>}
                    </div>
                  </div>
                  <span className="err-msg">{errors.cover || ''}</span>
              </section>

              <section className="fsec">
                <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                <div className="pv-card">
                  <div className={`pv-cover${collection.cover ? ' has-img' : ''}`} style={collection.cover ? { backgroundImage: `url(${collection.cover})` } : undefined}>
                    {!collection.cover ? <div className="disc"><span className="lbl"><i /></span></div> : null}
                  </div>
                  <div className="pv-name">{collection.name.trim() || '未命名合集'}</div>
                  <div className="pv-meta num">曲目集 · 已选 {selectedTrackIds.length} 首曲目</div>
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">前置知识点 <span className="note">学员需先掌握这些知识点，再进入本合集学习</span></div>
                <p className="pick-count">已选 <b className="num">{prerequisites.length}</b> 个前置知识点<span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· 上方已选条目可点 ✕ 快捷移除</span></p>
                <div className={`picked-list${prerequisites.length ? ' has-items' : ''}`} id="preChips" aria-label="已选前置知识点">
                  {prerequisites.map((item) => (
                    <span className="picked-chip" key={`${item.objectType}-${item.objectId}`}>
                      <span className="nm">
                        <span className={`ptag ${item.tagClass}`}>{item.tag}</span>{item.title}
                      </span>
                      <button type="button" className="rm" onClick={() => removePrerequisite(item)} aria-label={`移除 ${item.title}`}>✕</button>
                    </span>
                  ))}
                </div>
                <div className="pre-picker">
                  <label className={`pick-search big${preKeyword ? ' has' : ''}`} onFocus={() => setIsPreFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setTimeout(() => setIsPreFocused(false), 120); }}>
                    <SearchIcon />
                    <input type="text" value={preKeyword} onChange={(event) => setPreKeyword(event.target.value)} placeholder="搜索知识点集 / 单知识点 / 曲目集 / 单曲谱…" />
                    <button type="button" className="clr" onClick={() => setPreKeyword('')}>清除</button>
                  </label>
                  <div className={`pre-drop${isPreFocused && preKeyword.trim() ? ' open' : ''}`} onMouseDown={(event) => event.preventDefault()}>
                    {prerequisiteOptions.map((item) => (
                      <button type="button" className={`pre-item${isPrerequisiteSelected(item) ? ' off' : ''}`} onClick={() => { addPrerequisite(item); setPreKeyword(''); }} key={`${item.objectType}-${item.objectId}`}>
                        <span className={`ptag ${item.tagClass}`}>{item.tag}</span><span className="pnm">{item.title}</span><span className="pmeta">{isPrerequisiteSelected(item) ? '已加入' : '点击加入'}</span>
                      </button>
                    ))}
                    {prerequisiteOptions.length === 0 ? <div className="pick-empty show">未找到匹配的内容，换个关键词试试</div> : null}
                  </div>
                </div>
                <p className="pre-hint">按「类型 + 标题」选取前置内容：知识点集 · 单知识点 · 曲目集 · 单曲谱，如【曲目集】周杰伦专辑、【单曲谱】稻香 · 弹唱谱；点击结果加入，已选项置灰</p>
              </section>

              <section className="fsec full collection-pick-sec">
                <div className="fsec-title">从已有单课中多选加入 <span className="note">一首课可同时进入多个合集</span></div>
                <p className="pick-count">已选 <b className="num">{selectedTrackIds.length}</b> 首曲目<span style={{ fontSize: 10, color: 'var(--ink-3)' }}>· 顺序即合集内播放顺序：上方已选条目可点 ↑↓ 调序、✕ 快捷移除</span></p>
                <div className={`picked-list${selectedTracks.length ? ' has-items' : ''}`} id="pickChips" aria-label="已加入合集的内容">
                  {selectedTracks.map((track, index) => (
                    <span className="picked-chip" key={track.id}>
                      <span className="seq num">{index + 1}</span><span className="nm">{track.name}</span>
                      <button type="button" className="mv" disabled={index === 0} onClick={() => moveTrack(index, -1)} aria-label="上移">↑</button>
                      <button type="button" className="mv" disabled={index === selectedTracks.length - 1} onClick={() => moveTrack(index, 1)} aria-label="下移">↓</button>
                      <button type="button" className="rm" onClick={() => toggleTrack(track.id)} aria-label={`移除 ${track.name}`}>✕</button>
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
                    <button type="button" aria-pressed={selectedTrackIds.includes(track.id)} className={selectedTrackIds.includes(track.id) ? 'pick-card sel' : 'pick-card'} onClick={() => toggleTrack(track.id)} key={track.id}>
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

              <section className="fsec full lib-link-sec">
                <div className="fsec-title">关联图书馆 <span className="note">可选 · 可关联多本 · 学员在合集详情页查看与下载</span></div>
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
                <p className="pre-hint">从图书馆搜索并关联图书，如【图书】民谣吉他入门一本通；点击结果加入，已关联项置灰；学员在合集详情页「关联图书馆」处可查看并下载</p>
              </section>
            </div>
          </form>

            <div className="wiz-foot">
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/tracks')}>← 返回曲目区</button>
            <span className="foot-hint">{status || (initialId ? '曲目区 · 编辑合集' : '曲目区 · 新建合集')}</span>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={saveDraft} disabled={busy}>保存草稿</button>
            <button type="button" className="btn btn-main" onClick={submit} disabled={busy}>{busy ? '保存中...' : (initialId ? '保 存' : '发 布')}</button>
          </div>
        </div>
      </main>
    </>
  );
}
