'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import AppNav from '../../../../components/ui/AppNav.js';
import ContentCard from '../../../../components/ui/ContentCard.js';
import { fetchCollectionById } from '../../../../lib/api.js';

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

export default function CollectionDetailPage() {
  const params = useParams();
  const [collection, setCollection] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('正在加载曲谱集...');

  useEffect(() => {
    async function loadCollection() {
      try {
        const result = await fetchCollectionById(params.id);
        setCollection(result.data);
        setStatus('');
      } catch (error) {
        setStatus(error.message);
      }
    }

    loadCollection();
  }, [params.id]);

  const tracks = useMemo(() => collection?.track_points || [], [collection]);
  const total = Math.max(1, Math.ceil(tracks.length / PAGE_SIZE));
  const visibleTracks = tracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (status) {
    return (
      <>
        <AppNav role="guest" accountName="访客" />
        <main className="home"><p className="empty-text">{status}</p></main>
      </>
    );
  }

  return (
    <>
      <AppNav role="guest" accountName="访客" />
      <main className="home collection-detail-home">
        <div className="crumb rise">
          <Link href="/tracks">曲目库</Link>
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
            <span className="c-chip">曲谱集</span>
            <h1>{collection.name}</h1>
            <div className="c-meta">
              <span>{tracks.length} 首曲目</span>
              <span className="dot" />
              <span>更新 {formatDate(collection.updated_at)}</span>
            </div>
            <p className="c-desc">{collection.description || '暂无介绍'}</p>
          </div>
        </section>

        <section className="sec rise d2">
          <div className="sec-head">
            <h2>收录曲目</h2>
            <span className="meta num">共 {tracks.length} 首</span>
            <span className="note">每页 12 首 · 按合集编排顺序</span>
          </div>
          <div className="grid collection-grid">
            {visibleTracks.map((track, index) => (
              <ContentCard
                href={`/tracks/${track.id}`}
                title={track.name}
                cover={track.cover}
                countLabel={`${track.part_count || 0}P`}
                meta={`第 ${(page - 1) * PAGE_SIZE + index + 1} 首`}
                key={track.id}
              />
            ))}
            {tracks.length === 0 ? <p className="zone-empty show">这个曲谱集还没有曲目。</p> : null}
          </div>
          <Pager page={page} total={total} onChange={setPage} />
        </section>
      </main>
    </>
  );
}
