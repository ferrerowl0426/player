'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
// TODO(M4 cleanup): 知识点集详情仍使用旧 player-page/track-card-grid 样式；M4 需按 knowledge-collection-detail.html 返工。
import { fetchKnowledgeCollectionById } from '../../../../lib/api.js';

export default function KnowledgeCollectionPage() {
  const params = useParams();
  const [collection, setCollection] = useState(null);
  const [status, setStatus] = useState('正在加载知识点集...');

  useEffect(() => { fetchKnowledgeCollectionById(params.id).then((result) => { setCollection(result.data); setStatus(''); }).catch((error) => setStatus(error.message)); }, [params.id]);
  if (status) return <section className="player-page"><Link className="back-link" href="/knowledge">← 返回知识点区</Link><p className="empty-text">{status}</p></section>;
  return <section className="player-page track-detail-page"><Link className="back-link" href="/knowledge">← 返回知识点区</Link><div className="track-detail-heading"><div><p className="track-eyebrow">KNOWLEDGE COLLECTION</p><h1>{collection.name}</h1><p className="detail-time">更新时间：{new Date(collection.updated_at).toLocaleString('zh-CN')}</p></div><div className="track-detail-cover">{collection.cover ? <img src={collection.cover} alt={collection.name} /> : <span>知识点集</span>}</div></div><p className="detail-desc">{collection.description || '暂无介绍'}</p><div className="track-part-section"><div className="track-section-head"><div><p className="track-eyebrow">POINTS</p><h2>知识点列表</h2></div><span>{collection.points?.length || 0} 项</span></div>{collection.points?.length ? <div className="track-card-grid">{collection.points.map((point) => <Link className="track-card" href={`/knowledge/${point.id}`} key={point.id}><div className="track-cover">{point.cover ? <img src={point.cover} alt={point.name} /> : <div className="track-cover-empty"><span>知识点</span></div>}</div><div className="track-card-body"><div className="track-card-meta"><span>知识点</span><span>{point.part_count || 0} 个分段</span></div><h3>{point.name}</h3><p>{point.description || '暂无简介'}</p></div></Link>)}</div> : <p className="empty-text">这个知识点集还没有内容。</p>}</div></section>;
}
