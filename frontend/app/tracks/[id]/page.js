'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import ListRow from '../../../components/ui/ListRow.js';
import PanelBox from '../../../components/ui/PanelBox.js';
import VideoPlayer from '../../../components/VideoPlayer.js';
import { fetchPrerequisites, fetchTrackById } from '../../../lib/api.js';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '暂无更新时间';
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  if (!seconds) return '视频';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))}KB` : `${Math.round(value / 1024 / 1024)}MB`;
}

function prerequisiteHref(item) {
  if (item.objectType === 'track_collection' || item.prerequisiteType === 'track_collection') return `/tracks/collections/${item.objectId || item.prerequisiteId}`;
  if (item.objectType === 'knowledge_point' || item.prerequisiteType === 'knowledge_point') return `/knowledge/${item.objectId || item.prerequisiteId}`;
  if (item.objectType === 'knowledge_collection' || item.prerequisiteType === 'knowledge_collection') return `/knowledge/collections/${item.objectId || item.prerequisiteId}`;
  return `/tracks/${item.objectId || item.prerequisiteId}`;
}

function prerequisiteTitle(item) {
  return item.title || item.name || item.prerequisiteTitle || '前置内容';
}

export default function TrackDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const initialPart = searchParams.get('part');
  const [track, setTrack] = useState(null);
  const [prerequisites, setPrerequisites] = useState([]);
  const [activePartId, setActivePartId] = useState(null);
  const [status, setStatus] = useState('正在加载曲目...');

  useEffect(() => {
    async function loadTrack() {
      try {
        const [result, prerequisiteResult] = await Promise.all([
          fetchTrackById(params.id),
          fetchPrerequisites({ objectType: 'track_point', objectId: params.id }).catch(() => ({ data: [] }))
        ]);
        setTrack(result.data);
        setPrerequisites(prerequisiteResult.data || []);
        setActivePartId(Number(initialPart) || result.data.parts?.[0]?.id || null);
        setStatus('');
      } catch (error) {
        setStatus(error.message);
      }
    }

    loadTrack();
  }, [params.id, initialPart]);

  if (status) {
    return (
      <>
        <AppNav role="guest" accountName="访客" />
        <main className="detail">
          <section className="main"><p className="empty-text">{status}</p></section>
        </main>
      </>
    );
  }

  const parts = track.parts || [];
  const collections = track.track_collections || track.collections || [];
  const activePart = parts.find((part) => part.id === activePartId) || parts[0];

  return (
    <>
      <AppNav role="guest" accountName="访客" />
      <main className="detail">
        <section className="main rise">
          <nav className="crumb" aria-label="面包屑">
            <Link href="/tracks">曲目区</Link>
            <span className="sep">/</span>
            <span className="cur">{track.name}{activePart ? ` · 第 ${activePart.part_no} 段` : ''}</span>
          </nav>

          <div className="title-card">
            <div>
              <p className="eyebrow">TRACK DETAIL</p>
              <h1>{track.name}</h1>
              <p className="detail-time">更新 {formatDate(track.updated_at)} · {parts.length} 个分段</p>
            </div>
            <Link className="fbtn" href="/tracks">返回曲目库</Link>
          </div>

          <div className="prereq">
            <span className="lbl">前置知识点</span>
            <div className="items">
              {prerequisites.length ? prerequisites.map((item) => (
                <Link className="pi" href={prerequisiteHref(item)} key={`${item.objectType || item.prerequisiteType}-${item.objectId || item.prerequisiteId}`}>
                  <i />{prerequisiteTitle(item)}<span className="pm">查看</span>
                </Link>
              )) : <span className="pi muted"><i />暂无前置内容</span>}
            </div>
          </div>

          <div className="video-wrap">
            <div className="video">
              <span className="video-badge"><span className="dot" />正在学习</span>
              {activePart?.video_url ? (
                <VideoPlayer src={activePart.video_url} poster={track.cover || activePart.video_cover_url} renditions={activePart.renditions || []} />
              ) : (
                <div className="video-cover"><span className="vlabel"><i /></span></div>
              )}
            </div>
          </div>

          <div className="note-card">
            <div className="fsec-title">课程简介</div>
            <p>{track.description || '暂无介绍'}</p>
          </div>
        </section>

        <aside className="side rise d1">
          <PanelBox title="播放列表" meta={`${parts.length} 段`} className="pl-box">
            {parts.length ? (
              <div className="scroll">
                {parts.map((part) => (
                  <ListRow
                    type="part"
                    title={part.title}
                    meta={formatDuration(part.duration)}
                    active={part.id === activePart?.id}
                    onClick={() => setActivePartId(part.id)}
                    key={part.id}
                  />
                ))}
              </div>
            ) : <p className="empty-text">暂无分段。</p>}
          </PanelBox>

          <PanelBox title="资料下载" meta={`${track.attachments?.length || 0} 个`} className="file-box">
            {track.attachments?.length ? track.attachments.map((attachment) => (
              <ListRow href={attachment.file_url} title={attachment.file_name} meta={formatFileSize(attachment.file_size)} key={attachment.id} />
            )) : <p className="empty-text">这个曲目还没有资料附件。</p>}
          </PanelBox>

          <PanelBox title="所属曲谱集" meta={`${collections.length} 个`} className="lib-box">
            {collections.length ? collections.map((collection) => (
              <Link className="brow" href={`/tracks/collections/${collection.id}`} key={collection.id}>
                <span className="bcover">曲谱</span>
                <span><span className="bname">{collection.name}</span><span className="bmeta"><i className="link-dot" />点击查看合集</span></span>
              </Link>
            )) : <p className="empty-text">暂未加入曲谱集。</p>}
          </PanelBox>
        </aside>
      </main>
    </>
  );
}
