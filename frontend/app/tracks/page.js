'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import AppNav from '../../components/ui/AppNav.js';
import ContentCard from '../../components/ui/ContentCard.js';
import { fetchAdminMe, fetchTrackLibrary } from '../../lib/api.js';

const PAGE_SIZE = 16;

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

function paginate(items, page) {
  return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

function Zone({ title, meta, order, onOrderChange, children, className = '' }) {
  return (
    <section className={`zone ${className}`.trim()}>
      <div className="zone-head">
        <h2>{title}</h2>
        <span className="meta num">{meta}</span>
        <select className="order" aria-label={`${title}排序方式`} value={order} onChange={(event) => onOrderChange(event.target.value)}>
          <option value="new">按更新时间倒序</option>
          <option value="old">按更新时间正序</option>
          <option value="az">按首字母</option>
        </select>
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

function CardGrid({ items, type, emptyText }) {
  if (items.length === 0) {
    return <div className="grid"><p className="zone-empty show">{emptyText}</p></div>;
  }

  return (
    <div className="grid">
      {items.map((item) => (
        <ContentCard
          key={`${type}-${item.id}`}
          href={type === 'track' ? `/tracks/${item.id}` : `/tracks/collections/${item.id}`}
          title={item.name}
          cover={item.cover}
          collection={type === 'collection'}
          countLabel={type === 'collection' ? `收录 ${item.track_count || 0} 首` : `${item.part_count || 0} 个 P`}
          meta={formatDate(item.updated_at)}
        />
      ))}
    </div>
  );
}

export default function TracksPage() {
  const [keyword, setKeyword] = useState('');
  const [tracks, setTracks] = useState([]);
  const [collections, setCollections] = useState([]);
  const [trackOrder, setTrackOrder] = useState('new');
  const [collectionOrder, setCollectionOrder] = useState('new');
  const [trackPage, setTrackPage] = useState(1);
  const [collectionPage, setCollectionPage] = useState(1);
  const [admin, setAdmin] = useState(null);
  const [status, setStatus] = useState('正在加载曲目库...');

  async function loadLibrary(nextKeyword = keyword) {
    setStatus('正在加载曲目库...');
    try {
      const result = await fetchTrackLibrary(nextKeyword);
      setTracks(result.data.track_points || []);
      setCollections(result.data.track_collections || []);
      setTrackPage(1);
      setCollectionPage(1);
      setStatus('');
    } catch (error) {
      setTracks([]);
      setCollections([]);
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadLibrary('');
    fetchAdminMe().then((result) => setAdmin(result.data)).catch(() => setAdmin(null));
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    loadLibrary(keyword);
  }

  function clearSearch() {
    setKeyword('');
    loadLibrary('');
  }

  function changeTrackOrder(value) {
    setTrackOrder(value);
    setTrackPage(1);
  }

  function changeCollectionOrder(value) {
    setCollectionOrder(value);
    setCollectionPage(1);
  }

  const sortedTracks = useMemo(() => sortItems(tracks, trackOrder), [tracks, trackOrder]);
  const sortedCollections = useMemo(() => sortItems(collections, collectionOrder), [collections, collectionOrder]);
  const trackTotal = Math.max(1, Math.ceil(sortedTracks.length / PAGE_SIZE));
  const collectionTotal = Math.max(1, Math.ceil(sortedCollections.length / PAGE_SIZE));
  const isFiltering = keyword.trim().length > 0;
  const allEmpty = !status && tracks.length === 0 && collections.length === 0;
  const isSuperAdmin = admin?.role === 'super_admin';
  const navRole = isSuperAdmin ? 'super_admin' : 'guest';

  return (
    <>
      <AppNav
        role={navRole}
        accountName={isSuperAdmin ? (admin.nickname || admin.username) : '访客'}
        actions={isSuperAdmin ? (
          <div className="nav-actions">
            <Link className="fbtn" href="/admin/tracks">新建单曲目</Link>
            <Link className="fbtn solid" href="/admin/tracks/collections">新建曲谱集</Link>
          </div>
        ) : null}
      />
      <main className="home">
        <form className="toolrow rise" onSubmit={handleSubmit}>
          <div className={`searchbar${isFiltering ? ' filtering' : ''}`}>
            <SearchIcon />
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索曲目、曲谱集…"
              aria-label="搜索曲目和曲谱集"
            />
            <button type="button" className="clr" onClick={clearSearch}>清除</button>
          </div>
          <span className="hint">同时搜索曲目与曲谱集 · 结果按更新时间倒序</span>
        </form>

        {status ? <p className="track-status">{status}</p> : null}
        {allEmpty ? (
          <div className="global-empty show">
            <div className="big">没有找到相关内容</div>
            <button type="button" onClick={clearSearch}>清除搜索</button>
          </div>
        ) : null}

        <Zone title="曲目" meta={`共 ${tracks.length} 首`} order={trackOrder} onOrderChange={changeTrackOrder} className="tracks rise d1">
          <CardGrid items={paginate(sortedTracks, trackPage)} type="track" emptyText={isFiltering ? `曲目中未找到与「${keyword}」相关的内容` : '暂无曲目'} />
          <Pager page={trackPage} total={trackTotal} onChange={setTrackPage} />
        </Zone>

        <Zone title="曲谱集" meta={`共 ${collections.length} 套`} order={collectionOrder} onOrderChange={changeCollectionOrder} className="sets rise d2">
          <CardGrid items={paginate(sortedCollections, collectionPage)} type="collection" emptyText={isFiltering ? `曲谱集中未找到与「${keyword}」相关的内容` : '暂无曲谱集'} />
          <Pager page={collectionPage} total={collectionTotal} onChange={setCollectionPage} />
        </Zone>
      </main>
    </>
  );
}
