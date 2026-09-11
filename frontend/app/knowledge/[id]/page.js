'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
// TODO(M4 cleanup): 知识点详情仍使用旧 player-page/track-detail-page 样式；M4 需复用 track-point-detail.html 对齐后的曲目详情骨架。
import VideoPlayer from '../../../components/VideoPlayer.js';
import { fetchKnowledgePointById } from '../../../lib/api.js';

export default function KnowledgePointPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const initialPart = searchParams.get('part');
  const [point, setPoint] = useState(null);
  const [status, setStatus] = useState('正在加载知识点...');
  const [activePartId, setActivePartId] = useState(null);

  useEffect(() => {
    fetchKnowledgePointById(params.id).then((result) => { setPoint(result.data); setActivePartId(Number(initialPart) || result.data.parts?.[0]?.id || null); setStatus(''); }).catch((error) => setStatus(error.message));
  }, [params.id]);

  if (status) return <section className="player-page"><Link className="back-link" href="/knowledge">← 返回知识点区</Link><p className="empty-text">{status}</p></section>;
  const activePart = point.parts?.find((part) => part.id === activePartId) || point.parts?.[0];
  return <section className="player-page track-detail-page"><Link className="back-link" href="/knowledge">← 返回知识点区</Link>{activePart?.video_url ? <VideoPlayer src={activePart.video_url} poster={point.cover || activePart.video_cover_url} /> : <p className="empty-text">此知识点暂时没有可播放的视频。</p>}<div className="track-detail-heading"><div><p className="track-eyebrow">KNOWLEDGE POINT</p><h1>{point.name}</h1><p className="detail-time">更新时间：{new Date(point.updated_at).toLocaleString('zh-CN')}</p></div><div className="track-detail-cover">{point.cover ? <img src={point.cover} alt={point.name} /> : <span>知识点</span>}</div></div><p className="detail-desc">{point.description || '暂无介绍'}</p><div className="track-part-section"><div className="track-section-head"><div><p className="track-eyebrow">PARTS</p><h2>教学分段</h2></div><span>{point.parts?.length || 0} 段</span></div>{point.parts?.length ? <div className="track-part-list">{point.parts.map((part) => <button className={part.id === activePart?.id ? 'track-part-item active' : 'track-part-item'} onClick={() => setActivePartId(part.id)} key={part.id}><strong>P{part.part_no}</strong><span>{part.title}</span><small>{part.duration ? `${part.duration} 秒` : '视频'}</small></button>)}</div> : <p className="empty-text">暂无分段。</p>}</div><div className="prerequisite-section"><h2>所属知识点集</h2>{point.collections?.length ? point.collections.map((item) => <Link className="prerequisite-link" href={`/knowledge/collections/${item.id}`} key={item.id}>{item.name}</Link>) : <p className="empty-text">暂未加入知识点集。</p>}</div><div className="attachment-section"><h2>资料下载</h2>{point.attachments?.length ? point.attachments.map((item) => <a className="attachment-item" href={item.file_url} target="_blank" rel="noreferrer" key={item.id}><strong>{item.file_name}</strong><span>{item.file_type || '资料'}</span></a>) : <p className="empty-text">暂无资料附件。</p>}</div></section>;
}
