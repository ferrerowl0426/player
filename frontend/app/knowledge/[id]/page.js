'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import ListRow from '../../../components/ui/ListRow.js';
import PanelBox from '../../../components/ui/PanelBox.js';
import VideoPlayer from '../../../components/VideoPlayer.js';
import { fetchCurrentViewer, fetchKnowledgePointById, fetchPrerequisites } from '../../../lib/api.js';

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

function fileLabel(fileName = '', fileType = '') {
  const value = `${fileName} ${fileType}`.toLowerCase();
  if (value.includes('mp4') || value.includes('video')) return 'MP4';
  if (value.includes('mp3') || value.includes('wav') || value.includes('audio')) return 'AUDIO';
  if (value.includes('png')) return 'PNG';
  if (value.includes('jpg') || value.includes('jpeg')) return 'JPG';
  if (value.includes('pdf')) return 'PDF';
  if (value.includes('doc') || value.includes('word')) return 'DOC';
  if (value.includes('xls') || value.includes('excel')) return 'XLS';
  if (value.includes('zip')) return 'ZIP';
  if (value.includes('ppt')) return 'PPT';
  return 'FILE';
}

function isPlayableFile(attachment) {
  return ['MP4', 'AUDIO'].includes(fileLabel(attachment.file_name, attachment.file_type));
}

function isPreviewableFile(attachment) {
  return ['PNG', 'JPG', 'PDF', 'DOC', 'XLS'].includes(fileLabel(attachment.file_name, attachment.file_type));
}

function resourceActions(resource) {
  const url = resource?.file_url;
  if (!url) return null;
  const playable = isPlayableFile(resource);
  const previewable = isPreviewableFile(resource);
  return (
    <>
      {playable || previewable ? <a className="fbtn" href={url} target="_blank" rel="noreferrer">{playable ? '播放' : '预览'}</a> : null}
      <a className="fbtn solid" href={url} download>下载</a>
    </>
  );
}

function prerequisiteHref(item) {
  if (item.objectType === 'track_collection' || item.prerequisiteType === 'track_collection') return `/tracks/collections/${item.objectId || item.prerequisiteId}`;
  if (item.objectType === 'knowledge_collection' || item.prerequisiteType === 'knowledge_collection') return `/knowledge/collections/${item.objectId || item.prerequisiteId}`;
  if (item.objectType === 'track_point' || item.prerequisiteType === 'track_point') return `/tracks/${item.objectId || item.prerequisiteId}`;
  return `/knowledge/${item.objectId || item.prerequisiteId}`;
}

function prerequisiteTitle(item) {
  return item.title || item.name || item.prerequisiteTitle || '前置内容';
}

export default function KnowledgePointPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const initialPart = searchParams.get('part');
  const [point, setPoint] = useState(null);
  const [prerequisites, setPrerequisites] = useState([]);
  const [activePartId, setActivePartId] = useState(null);
  const [viewer, setViewer] = useState({ role: 'guest', username: '访客', nickname: '访客' });
  const [status, setStatus] = useState('正在加载知识点...');

  useEffect(() => {
    async function loadPoint() {
      try {
        const [result, prerequisiteResult] = await Promise.all([
          fetchKnowledgePointById(params.id),
          fetchPrerequisites({ objectType: 'knowledge_point', objectId: params.id }).catch(() => ({ data: [] }))
        ]);
        setPoint(result.data);
        setPrerequisites(prerequisiteResult.data || []);
        setActivePartId(Number(initialPart) || result.data.parts?.[0]?.id || null);
        setStatus('');
      } catch (error) {
        setStatus(error.message);
      }
    }

    loadPoint();
    fetchCurrentViewer().then((result) => setViewer(result.data)).catch(() => setViewer({ role: 'guest', username: '访客', nickname: '访客' }));
  }, [params.id, initialPart]);

  const accountName = viewer.nickname || viewer.username || '访客';

  if (status) {
    return (
      <>
        <AppNav role={viewer.role || 'guest'} accountName={accountName} />
        <main className="detail">
          <section className="main"><p className="empty-text">{status}</p></section>
        </main>
      </>
    );
  }

  const parts = point.parts || [];
  const libraryResources = point.library_resources || [];
  const activePart = parts.find((part) => part.id === activePartId) || parts[0];
  const activePartIndex = parts.findIndex((part) => part.id === activePart?.id);
  const nextPart = activePartIndex >= 0 ? parts[activePartIndex + 1] : null;

  return (
    <>
      <AppNav role={viewer.role || 'guest'} accountName={accountName} />
      <main className="detail">
        <section className="main rise">
          <nav className="crumb" aria-label="面包屑">
            <Link href="/knowledge">知识点区</Link>
            <span className="sep">/</span>
            <span className="cur">{point.name}{activePart ? ` · 第 ${activePart.part_no} 段` : ''}</span>
          </nav>

          <div className="title-card">
            <div>
              <h1>{point.name}</h1>
              <p className="detail-time">更新 {formatDate(point.updated_at)} · {parts.length} 个分段</p>
            </div>
            <Link className="fbtn" href="/knowledge">返回知识点区</Link>
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
              {activePart?.video_url ? (
                <VideoPlayer src={activePart.video_url} poster={point.cover || activePart.video_cover_url} renditions={activePart.renditions || []} onNext={nextPart ? () => setActivePartId(nextPart.id) : null} />
              ) : (
                <div className="video-cover"><span className="vlabel"><i /></span></div>
              )}
            </div>
          </div>

          <div className="note-card">
            <div className="fsec-title">知识点简介</div>
            <p>{point.description || '暂无介绍'}</p>
          </div>
        </section>

        <aside className="side rise d1">
          <PanelBox title="播放列表" meta={`${parts.length} 段`} className="pl-box">
            <div className="scroll">
              {parts.length ? parts.map((part, index) => (
                <ListRow
                  type="part"
                  index={index + 1}
                  title={part.title}
                  meta={formatDuration(part.duration)}
                  active={part.id === activePart?.id}
                  onClick={() => setActivePartId(part.id)}
                  key={part.id}
                />
              )) : <p className="empty-text">暂无分段。</p>}
            </div>
          </PanelBox>

          <PanelBox title="资料下载" meta={`${point.attachments?.length || 0} 个`} className="file-box">
            <div className="scroll">
              {point.attachments?.length ? point.attachments.map((attachment) => {
                const label = fileLabel(attachment.file_name, attachment.file_type);
                return (
                  <ListRow
                    title={attachment.file_name}
                    meta={formatFileSize(attachment.file_size)}
                    label={label}
                    action={resourceActions(attachment)}
                    key={attachment.id}
                  />
                );
              }) : <p className="empty-text">这个知识点还没有资料附件。</p>}
            </div>
          </PanelBox>

          <PanelBox title="关联图书馆" meta={`${libraryResources.length} 份`} className="lib-box">
            {libraryResources.length ? libraryResources.map((resource) => (
              <ListRow
                type="book"
                title={resource.title}
                label={fileLabel(resource.file_name, resource.file_type)}
                action={resourceActions(resource)}
                key={resource.id}
              />
            )) : <p className="empty-text">暂未关联图书馆资料。</p>}
          </PanelBox>
        </aside>
      </main>
    </>
  );
}
