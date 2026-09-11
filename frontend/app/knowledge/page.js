'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
// TODO(M4 cleanup): 知识点首页仍使用旧 track-card/track-card-grid 样式；M4 需按 knowledge-home.html 复用 M3 页面骨架返工。
import { fetchKnowledgeLibrary } from '../../lib/api.js';

function date(value) {
  return value ? new Date(value).toLocaleString('zh-CN') : '暂无更新时间';
}

function Card({ item, collection = false }) {
  return <Link className="track-card" href={collection ? `/knowledge/collections/${item.id}` : `/knowledge/${item.id}`}><div className="track-cover">{item.cover ? <img src={item.cover} alt={item.name} /> : <div className="track-cover-empty"><span>{collection ? '知识点集' : '知识点'}</span></div>}</div><div className="track-card-body"><div className="track-card-meta"><span>{collection ? '知识点集' : '知识点'}</span><span>{collection ? `${item.point_count || 0} 个知识点` : `${item.part_count || 0} 个分段`}</span></div><h3>{item.name}</h3><p>{item.description || '暂无简介'}</p><time>更新于 {date(item.updated_at)}</time></div></Link>;
}

export default function KnowledgePage() {
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState({ points: [], knowledge_collections: [] });
  const [status, setStatus] = useState('正在加载知识点区...');

  async function load(value = keyword) {
    setStatus('正在加载知识点区...');
    try {
      const result = await fetchKnowledgeLibrary(value);
      setData(result.data);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => { load(''); }, []);

  return <div className="track-library-page"><section className="track-hero"><div><p className="track-eyebrow">KNOWLEDGE LIBRARY</p><h1>知识点区</h1><p>按更新时间浏览知识点和知识点集，搜索同时覆盖两类内容。</p></div></section><form className="track-search" onSubmit={(event) => { event.preventDefault(); load(); }}><label><span>搜索知识点 / 知识点集</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：1645 和弦进行" /></label><button type="submit">搜索</button><button type="button" onClick={() => { setKeyword(''); load(''); }}>重置</button></form>{status ? <p className="track-status">{status}</p> : null}<section className="track-library-section"><div className="track-section-head"><div><p className="track-eyebrow">KNOWLEDGE POINTS</p><h2>知识点</h2><p>一个知识点可以包含多个教学分段。</p></div><span>{data.points.length} 项</span></div>{data.points.length ? <div className="track-card-grid">{data.points.map((item) => <Card item={item} key={item.id} />)}</div> : <p className="track-empty">暂无知识点</p>}</section><section className="track-library-section"><div className="track-section-head"><div><p className="track-eyebrow">COLLECTIONS</p><h2>知识点集</h2><p>把多个知识点整理为一个学习合集。</p></div><span>{data.knowledge_collections.length} 项</span></div>{data.knowledge_collections.length ? <div className="track-card-grid">{data.knowledge_collections.map((item) => <Card item={item} collection key={item.id} />)}</div> : <p className="track-empty">暂无知识点集</p>}</section></div>;
}
