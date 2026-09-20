'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AppNav from '../../components/ui/AppNav.js';
import ContentCard from '../../components/ui/ContentCard.js';
import {
  fetchCurrentViewer,
  fetchKnowledgeLibrary,
  deleteKnowledgeCollection,
  deleteKnowledgePoint,
} from '../../lib/api.js';

const COLLECTION_ROWS = 1;
const POINT_ROWS = 4;

function getGridColumns() {
  if (typeof window === 'undefined') {
    return 8;
  }
  if (window.matchMedia('(max-width: 640px)').matches) {
    return 2;
  }
  if (window.matchMedia('(max-width: 1024px)').matches) {
    return 4;
  }
  return 8;
}

function useGridColumns() {
  const [columns, setColumns] = useState(8);

  useEffect(() => {
    function syncColumns() {
      setColumns(getGridColumns());
    }

    syncColumns();
    window.addEventListener('resize', syncColumns);
    return () => window.removeEventListener('resize', syncColumns);
  }, []);

  return columns;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '暂无更新';
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function sortItems(items, order) {
  return [...items].sort((a, b) => {
    if (order === 'az') {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    }

    const left = new Date(a.updated_at || 0).getTime();
    const right = new Date(b.updated_at || 0).getTime();
    return order === 'old' ? left - right : right - left;
  });
}

function paginate(items, page, pageSize) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

function Zone({ title, meta, order, onOrderChange, actions = null, children, className = '' }) {
  return (
    <section className={`zone ${className}`.trim()}>
      <div className="zone-head">
        <h2>{title}</h2>
        <span className="meta num">{meta}</span>
        <span className="order-wrap">
          <select className="order" aria-label={`${title}排序方式`} value={order} onChange={(event) => onOrderChange(event.target.value)}>
            <option value="new">按更新时间倒序</option>
            <option value="old">按更新时间正序</option>
            <option value="az">按首字母</option>
          </select>
          <svg className="order-chevron" viewBox="0 0 12 18" aria-hidden="true" focusable="false"><path d="m3 7 3-3 3 3M3 11l3 3 3-3" /></svg>
        </span>
        {actions ? <div className="zone-ops">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
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

function CardGrid({ items, type, emptyText, isSuperAdmin, onDelete }) {
  if (items.length === 0) {
    return <div className="grid"><p className="zone-empty show">{emptyText}</p></div>;
  }

  return (
    <div className="grid">
      {items.map((item) => {
        const href = type === 'point' ? `/knowledge/${item.id}` : `/knowledge/collections/${item.id}`;
        const editHref = type === 'point' ? `/admin/knowledge?id=${item.id}` : `/admin/knowledge?type=collection&id=${item.id}`;

        return (
          <ContentCard
            key={`${type}-${item.id}`}
            href={href}
            title={item.name}
            cover={item.cover}
            collection={type === 'collection'}
            countLabel={type === 'collection' ? `收录 ${item.point_count || 0} 个` : `${item.part_count || 0} 个 P`}
            meta={formatDate(item.updated_at)}
            actions={isSuperAdmin ? (
              <>
                <Link href={href}>查看详情</Link>
                <Link href={editHref}>编辑</Link>
                <button type="button" className="op-del" onClick={(event) => onDelete(event, type, item)}>删除</button>
              </>
            ) : null}
          />
        );
      })}
    </div>
  );
}

export default function KnowledgePage() {
  const [keyword, setKeyword] = useState('');
  const [points, setPoints] = useState([]);
  const [collections, setCollections] = useState([]);
  const [pointOrder, setPointOrder] = useState('new');
  const [collectionOrder, setCollectionOrder] = useState('new');
  const [pointPage, setPointPage] = useState(1);
  const [collectionPage, setCollectionPage] = useState(1);
  const [admin, setAdmin] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [status, setStatus] = useState('正在加载知识点区...');

  async function loadLibrary(nextKeyword = keyword) {
    setStatus('正在加载知识点区...');
    try {
      const result = await fetchKnowledgeLibrary(nextKeyword);
      setPoints(result.data.knowledge_points || result.data.points || []);
      setCollections(result.data.knowledge_collections || []);
      setPointPage(1);
      setCollectionPage(1);
      setStatus('');
    } catch (error) {
      setPoints([]);
      setCollections([]);
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadLibrary('');
    fetchCurrentViewer().then((result) => setAdmin(result.data)).catch(() => setAdmin(null));
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    loadLibrary(keyword);
  }

  function clearSearch() {
    setKeyword('');
    loadLibrary('');
  }

  function changePointOrder(value) {
    setPointOrder(value);
    setPointPage(1);
  }

  function changeCollectionOrder(value) {
    setCollectionOrder(value);
    setCollectionPage(1);
  }

  function handleDelete(event, type, item) {
    event.preventDefault();
    event.stopPropagation();
    setDeleteTarget({ type, item });
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      if (deleteTarget.type === 'collection') {
        await deleteKnowledgeCollection(deleteTarget.item.id);
      } else {
        await deleteKnowledgePoint(deleteTarget.item.id);
      }
      setDeleteTarget(null);
      await loadLibrary(keyword);
    } catch (error) {
      setStatus(error.message);
    }
  }

  const gridColumns = useGridColumns();
  const collectionPageSize = gridColumns * COLLECTION_ROWS;
  const pointPageSize = gridColumns * POINT_ROWS;
  const sortedPoints = useMemo(() => sortItems(points, pointOrder), [points, pointOrder]);
  const sortedCollections = useMemo(() => sortItems(collections, collectionOrder), [collections, collectionOrder]);
  const pointTotal = Math.max(1, Math.ceil(sortedPoints.length / pointPageSize));
  const collectionTotal = Math.max(1, Math.ceil(sortedCollections.length / collectionPageSize));
  const isFiltering = keyword.trim().length > 0;
  const allEmpty = !status && points.length === 0 && collections.length === 0;
  const isSuperAdmin = admin?.role === 'super_admin';
  const navRole = admin?.role || 'guest';
  const accountName = admin?.nickname || admin?.username || '访客';

  useEffect(() => {
    setCollectionPage((page) => Math.min(page, collectionTotal));
    setPointPage((page) => Math.min(page, pointTotal));
  }, [collectionTotal, pointTotal]);

  useEffect(() => {
    document.body.classList.toggle('dean', isSuperAdmin);
    document.body.classList.add('library-index-page');
    return () => {
      document.body.classList.remove('dean');
      document.body.classList.remove('library-index-page');
    };
  }, [isSuperAdmin]);

  return (
    <>
      <AppNav role={navRole} accountName={accountName} />
      <main className="home knowledge-home">
        <form className="toolrow rise" onSubmit={handleSubmit}>
          <div className={`searchbar${isFiltering ? ' filtering' : ''}`}>
            <SearchIcon />
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索知识点集、知识点…"
              aria-label="搜索知识点集和知识点"
            />
            <button type="button" className="clr" onClick={clearSearch}>清除</button>
          </div>
        </form>

        {status ? <p className="track-status">{status}</p> : null}
        {allEmpty ? (
          <div className="global-empty show">
            <div className="big">没有找到相关内容</div>
            <button type="button" onClick={clearSearch}>清除搜索</button>
          </div>
        ) : null}

        <Zone
          title="知识点集"
          meta={`共 ${collections.length} 套`}
          order={collectionOrder}
          onOrderChange={changeCollectionOrder}
          className="sets rise d1"
          actions={isSuperAdmin ? <Link className="zbtn ghost" href="/admin/knowledge?type=collection">＋ 新建知识点集</Link> : null}
        >
          <CardGrid
            items={paginate(sortedCollections, collectionPage, collectionPageSize)}
            type="collection"
            emptyText={isFiltering ? `知识点集中未找到与「${keyword}」相关的内容` : '暂无知识点集'}
            isSuperAdmin={isSuperAdmin}
            onDelete={handleDelete}
          />
          <Pager page={collectionPage} total={collectionTotal} onChange={setCollectionPage} />
        </Zone>

        <Zone
          title="知识点"
          meta={`共 ${points.length} 个`}
          order={pointOrder}
          onOrderChange={changePointOrder}
          className="tracks rise d2"
          actions={isSuperAdmin ? <Link className="zbtn ghost" href="/admin/knowledge">＋ 新建单课</Link> : null}
        >
          <CardGrid
            items={paginate(sortedPoints, pointPage, pointPageSize)}
            type="point"
            emptyText={isFiltering ? `知识点中未找到与「${keyword}」相关的内容` : '暂无知识点'}
            isSuperAdmin={isSuperAdmin}
            onDelete={handleDelete}
          />
          <Pager page={pointPage} total={pointTotal} onChange={setPointPage} />
        </Zone>

        <div className={`modal-mask${deleteTarget ? ' show' : ''}`} role="dialog" aria-modal="true" aria-label="删除确认">
          <div className="modal">
            <div className="modal-title">删除确认</div>
            <p>确定要删除「<b>{deleteTarget?.item.name}</b>」吗？<br />删除后该内容将不可恢复。</p>
            <div className="modal-ops">
              <button type="button" className="mbtn" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="mbtn danger" onClick={confirmDelete}>确认删除</button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
