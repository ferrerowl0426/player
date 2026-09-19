'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppNav from '../../components/ui/AppNav.js';
import { deleteLibraryResource, fetchCurrentViewer, fetchLibraryResources } from '../../lib/api.js';
import styles from './library.module.css';

const COLS = 8;
const DEFAULT_PAGE_SIZE = 16;

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 MB';
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(value) {
  const time = value ? new Date(value).getTime() : 0;
  if (!time) return '暂无更新';
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < week) return `${Math.floor(diff / day)} 天前`;
  if (diff < 5 * week) return `${Math.floor(diff / week)} 周前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

function cardMeta(item) {
  return `${formatSize(item.file_size)} · ${relativeTime(item.updated_at)}`;
}

function calcPageSize() {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const height = window.innerHeight || 900;
  const reserved = 270;
  const cardHeight = 230;
  const rows = Math.max(1, Math.min(2, Math.floor((height - reserved) / cardHeight)));
  return rows * COLS;
}

export default function LibraryPage() {
  const router = useRouter();
  const toastTimer = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [items, setItems] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState('正在加载图书馆...');
  const [jump, setJump] = useState('');
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }, []);

  const loadLibrary = useCallback(async (value = keyword) => {
    const result = await fetchLibraryResources(value);
    setItems(result.data || []);
    setStatus('');
  }, [keyword]);

  useEffect(() => {
    fetchCurrentViewer().then((result) => setViewer(result.data)).catch(() => setViewer({ role: 'guest' }));
    loadLibrary('').catch((error) => setStatus(error.message));
  }, [loadLibrary]);

  useEffect(() => {
    const resize = () => setPageSize(calcPageSize());
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const isSuperAdmin = viewer?.role === 'super_admin';

  useEffect(() => {
    document.body.classList.toggle('dean', isSuperAdmin);
    return () => document.body.classList.remove('dean');
  }, [isSuperAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      loadLibrary(keyword).catch((error) => setStatus(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [keyword, loadLibrary]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const sortedItems = useMemo(() => {
    return [...items].sort((first, second) => {
      if (sort === 'name') return first.title.localeCompare(second.title, 'zh-CN');
      if (sort === 'old') return new Date(first.updated_at || 0) - new Date(second.updated_at || 0);
      return new Date(second.updated_at || 0) - new Date(first.updated_at || 0);
    });
  }, [items, sort]);

  const total = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const safePage = Math.min(page, total);
  const visibleItems = sortedItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const accountName = viewer?.nickname || viewer?.username || '访客';

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(true);
    try {
      await deleteLibraryResource(pending.id);
      setPending(null);
      await loadLibrary(keyword);
      showToast('删除成功');
    } catch (error) {
      showToast(error.message);
    } finally {
      setDeleting(false);
    }
  }

  function jumpToPage() {
    const target = Number(jump);
    if (!Number.isInteger(target)) return;
    setPage(Math.min(total, Math.max(1, target)));
    setJump('');
  }

  const emptyText = keyword.trim() ? '未找到相关资料，换个关键词试试' : '暂无资料。';

  return (
    <>
      <AppNav role={viewer?.role || 'guest'} accountName={accountName} />
      <main className={`${styles.library} home`}>
        <div className="toolrow rise">
          <label className={`searchbar${keyword ? ' filtering' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索资料名称…" aria-label="搜索资料名称" />
            <button className="clr" type="button" onClick={() => setKeyword('')}>清除</button>
          </label>
        </div>

        <section className="zone rise d1">
          <div className="zone-head">
            <h2>图书馆</h2>
            <span className="meta num">共 {sortedItems.length} 份</span>
            <span className="order-wrap">
              <select className="order" aria-label="图书馆排序方式" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
                <option value="new">按更新时间倒序</option>
                <option value="old">按更新时间正序</option>
                <option value="name">按首字母</option>
              </select>
              <svg className="order-chevron" viewBox="0 0 12 18" aria-hidden="true" focusable="false"><path d="m3 7 3-3 3 3M3 11l3 3 3-3" /></svg>
            </span>
            {isSuperAdmin ? <div className="zone-ops"><Link className="zbtn ghost" href="/admin/library">＋ 上传 PDF</Link></div> : null}
          </div>

          <div className="grid">
            {visibleItems.map((item) => (
              <Link className="card" href={`/library/${item.id}`} key={item.id}>
                <span className="cover" style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}>
                  <span className="pdf-badge">PDF</span>
                  {isSuperAdmin ? (
                    <span className="ops">
                      <button type="button" onClick={(event) => { event.preventDefault(); router.push(`/library/${item.id}`); }}>查看详情</button>
                      <button type="button" onClick={(event) => { event.preventDefault(); router.push(`/admin/library?id=${item.id}`); }}>编辑</button>
                      <button type="button" className="op-del" onClick={(event) => { event.preventDefault(); setPending(item); }}>删除</button>
                    </span>
                  ) : null}
                </span>
                <span className="name">{item.title}</span>
                <span className="meta"><span>{cardMeta(item)}</span></span>
              </Link>
            ))}
            {!status && sortedItems.length === 0 ? <p className="zone-empty show">{emptyText}</p> : null}
            {status ? <p className="zone-empty show">{status}</p> : null}
          </div>

          <div className="pager">
            <button className="pgbtn" type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</button>
            <span className="pginfo num">第 <b>{safePage}</b> 页 · 共 {total} 页</span>
            <button className="pgbtn" type="button" disabled={safePage >= total} onClick={() => setPage(safePage + 1)}>下一页</button>
            <label className="pgjump">跳转到 <input value={jump} onChange={(event) => setJump(event.target.value.replace(/\D/g, '').slice(0, 3))} onKeyDown={(event) => { if (event.key === 'Enter') jumpToPage(); }} /> 页 <button type="button" onClick={jumpToPage}>跳转</button></label>
          </div>
        </section>
      </main>

      <div className={`modal-mask${pending ? ' show' : ''}`}>
        <div className="modal">
          <h3>删 除 确 认</h3>
          <p>确定要删除「{pending?.title}」吗？<br />删除后该资料将不可恢复。</p>
          <div className="modal-actions">
            <button className="mbtn" type="button" onClick={() => setPending(null)} disabled={deleting}>取 消</button>
            <button className="mbtn danger" type="button" onClick={confirmDelete} disabled={deleting}>{deleting ? '删除中...' : '确认删除'}</button>
          </div>
        </div>
      </div>
      <div className={`dean-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
