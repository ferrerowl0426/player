'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import { fetchCurrentViewer, fetchLibraryResourceById } from '../../../lib/api.js';
import styles from './library-book.module.css';

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 MB';
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function LibraryBookPage() {
  const params = useParams();
  const [admin, setAdmin] = useState(null);
  const [book, setBook] = useState(null);
  const [status, setStatus] = useState('正在加载资料...');

  useEffect(() => {
    fetchCurrentViewer().then((result) => setAdmin(result.data)).catch(() => setAdmin(null));
    fetchLibraryResourceById(params.id).then((result) => {
      setBook(result.data);
      setStatus('');
    }).catch((error) => setStatus(error.message));
  }, [params.id]);

  const accountName = admin?.nickname || admin?.username || '访客';

  if (status) {
    return (
      <>
        <AppNav role={admin?.role || 'guest'} accountName={accountName} />
        <main className={styles.wrap}><p className="empty-text">{status}</p></main>
      </>
    );
  }

  return (
    <>
      <AppNav role={admin?.role || 'guest'} accountName={accountName} />
      <main className={styles.wrap}>
        <div className="crumb rise"><Link href="/library">← 返回图书馆</Link></div>
        <section className="detail rise d1">
          <div className="bcover" style={book.cover ? { backgroundImage: `url(${book.cover})` } : undefined}>
            <span className="pdf-badge">PDF</span>
          </div>
          <div className="binfo">
            <span className="chip">图书馆 · PDF 资料</span>
            <h1>{book.title}</h1>
            <div className="bmeta num">
              <span>{formatSize(book.file_size)}</span>
              <i />
              <span>{book.uploader_name || '教研组'} 上传</span>
              <i />
              <span>PDF 文档</span>
            </div>
            <div className="bsec">
              <div className="lbl">简介</div>
              <div className="desc-scroll"><p>{book.description || '暂无简介'}</p></div>
            </div>
            <div className="bops">
              <a className="bbtn ghost" href={book.file_url} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>
                预 览
              </a>
              <a className="bbtn solid" href={book.file_url} download={book.file_name}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M4.5 19.5h15" /></svg>
                下 载
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
