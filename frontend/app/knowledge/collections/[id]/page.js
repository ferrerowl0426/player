'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import AppNav from '../../../../components/ui/AppNav.js';
import ContentCard from '../../../../components/ui/ContentCard.js';
import {
  deleteKnowledgePoint,
  fetchCurrentViewer,
  fetchKnowledgeCollectionById,
  updateKnowledgeCollectionItems
} from '../../../../lib/api.js';

const PAGE_SIZE = 12;

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '暂无更新';
}

function Pager({ page, total, onChange }) {
  const pages = Array.from({ length: Math.min(total, 5) }, (_, index) => index + 1);

  return (
    <div className="pager">
      <button className="pgbtn" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">‹</button>
      <div className="pgnums">
        {pages.map((item) => (
          <button type="button" className={item === page ? 'pgnum on' : 'pgnum'} onClick={() => onChange(item)} key={item}>{item}</button>
        ))}
        {total > 5 ? <span className="pgdots">…</span> : null}
      </div>
      <button className="pgbtn" type="button" disabled={page >= total} onClick={() => onChange(page + 1)} aria-label="下一页">›</button>
    </div>
  );
}

export default function KnowledgeCollectionPage() {
  const params = useParams();
  const [collection, setCollection] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('正在加载知识点集...');
  const [viewer, setViewer] = useState({ role: 'guest', username: '访客', nickname: '访客' });
  const [pending, setPending] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef(null);

  const loadCollection = useCallback(async () => {
    try {
      const result = await fetchKnowledgeCollectionById(params.id);
      setCollection(result.data);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }, [params.id]);

  useEffect(() => {
    loadCollection();
    fetchCurrentViewer()
      .then((result) => setViewer(result.data))
      .catch(() => setViewer({ role: 'guest', username: '访客', nickname: '访客' }));
  }, [loadCollection]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const isSuperAdmin = viewer?.role === 'super_admin';

  useEffect(() => {
    document.body.classList.toggle('dean', isSuperAdmin);
    return () => document.body.classList.remove('dean');
  }, [isSuperAdmin]);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }

  const points = useMemo(() => collection?.points || [], [collection]);
  const libraryResources = useMemo(() => collection?.library_resources || [], [collection]);
  const total = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const visiblePoints = points.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const accountName = viewer.nickname || viewer.username || '访客';

  async function removeFromCollection() {
    if (!pending || !collection) return;
    setBusy(true);
    try {
      const nextIds = points.filter((item) => item.id !== pending.id).map((item) => item.id);
      await updateKnowledgeCollectionItems({ id: collection.id, pointIds: nextIds });
      setPending(null);
      setPage(1);
      await loadCollection();
      showToast('移出成功');
    } catch (error) {
      showToast(error.message || '移出失败');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await deleteKnowledgePoint(purgeTarget.id);
      setPurgeTarget(null);
      setPending(null);
      setPage(1);
      await loadCollection();
      showToast('删除成功');
    } catch (error) {
      showToast(error.message || '删除失败');
    } finally {
      setBusy(false);
    }
  }

  if (status) {
    return (
      <>
        <AppNav role={viewer.role || 'guest'} accountName={accountName} />
        <main className="home"><p className="empty-text">{status}</p></main>
      </>
    );
  }

  return (
    <>
      <AppNav role={viewer.role || 'guest'} accountName={accountName} />
      <main className="home collection-detail-home">
        <div className="crumb rise">
          <Link href="/knowledge">知识点区</Link>
          <span className="sep">/</span>
          <span className="cur">{collection.name}</span>
        </div>

        <section className="c-head rise d1">
          <div className="c-cover">
            {collection.cover ? (
              <img src={collection.cover} alt={collection.name} />
            ) : (
              <div className="cover stack"><span className="disc"><span className="lbl"><i /></span></span></div>
            )}
          </div>
          <div className="c-info">
            <span className="c-chip">知识点集</span>
            <h1>{collection.name}</h1>
            <div className="c-meta">
              <span>{points.length} 个知识点</span>
              <span className="dot" />
              <span>更新 {formatDate(collection.updated_at)}</span>
            </div>
            <p className="c-desc">{collection.description || '暂无介绍'}</p>
          </div>
          <aside className="c-lib" aria-label="关联图书馆">
            <div className="c-lib-head"><h2>关联图书馆</h2><span className="count num">{libraryResources.length} 份</span></div>
            <p className="c-lib-note">本合集配套资料，可查看与下载</p>
            <div className="c-lib-list">
              {libraryResources.map((resource) => (
                <Link className="c-lib-item" href={`/library/${resource.id}`} key={resource.id}>
                  <span className="book-mark" aria-hidden="true">书</span>
                  <span className="book-name">{resource.title || resource.file_name}</span>
                  <span className="book-meta">资料</span>
                </Link>
              ))}
              {libraryResources.length === 0 ? <span className="c-lib-empty">暂未关联图书馆资料</span> : null}
            </div>
          </aside>
        </section>

        <section className="sec rise d2">
          <div className="sec-head">
            <h2>收录知识点</h2>
            <span className="meta num">共 {points.length} 个</span>
            <span className="note">每页 12 个 · 按合集编排顺序</span>
          </div>
          <div className="grid collection-grid">
            {visiblePoints.map((point, index) => (
              <ContentCard
                href={`/knowledge/${point.id}`}
                title={point.name}
                cover={point.cover}
                countLabel={`${point.part_count || 0}P`}
                meta={`第 ${(page - 1) * PAGE_SIZE + index + 1} 个`}
                key={point.id}
                actions={isSuperAdmin ? (
                  <>
                    <Link href={`/knowledge/${point.id}`}>查看详情</Link>
                    <Link href={`/admin/knowledge?id=${point.id}`}>编辑</Link>
                    <button type="button" className="op-del" onClick={() => setPending(point)}>删除</button>
                  </>
                ) : null}
              />
            ))}
            {points.length === 0 ? <p className="zone-empty show">这个知识点集还没有内容。</p> : null}
          </div>
          <Pager page={page} total={total} onChange={setPage} />
        </section>
      </main>

      <div
        className={`modal-mask${pending ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="删除确认"
        onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPending(null); }}
      >
        <div className="modal">
          <div className="modal-title">删除确认</div>
          <p>
            要如何处理「<b>{pending?.name}</b>」？<br />
            移出本合集只解除收录关系，知识点与其视频保留；彻底删除会连同全部分段与视频一并删除。
          </p>
          <div className="modal-ops">
            <button type="button" className="mbtn" onClick={() => setPending(null)} disabled={busy}>取消</button>
            <button type="button" className="mbtn" onClick={removeFromCollection} disabled={busy}>移出本合集</button>
            <button type="button" className="mbtn danger" onClick={() => setPurgeTarget(pending)} disabled={busy}>彻底删除</button>
          </div>
        </div>
      </div>

      <div
        className={`modal-mask${purgeTarget ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="彻底删除确认"
        onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPurgeTarget(null); }}
      >
        <div className="modal">
          <div className="modal-title">彻底删除确认</div>
          <p>
            确定要彻底删除「<b>{purgeTarget?.name}</b>」吗？<br />
            删除后该内容及其所有分段、视频将不可恢复。
          </p>
          <div className="modal-ops">
            <button type="button" className="mbtn" onClick={() => setPurgeTarget(null)} disabled={busy}>取消</button>
            <button type="button" className="mbtn danger" onClick={confirmPurge} disabled={busy}>确认删除</button>
          </div>
        </div>
      </div>

      <div className={`dean-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
