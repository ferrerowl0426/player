'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import {
  createLibraryResource,
  createLibraryUploadUrl,
  fetchAdminMe,
  fetchKnowledgeLibrary,
  fetchLibraryResourceById,
  fetchTrackLibrary,
  updateLibraryResource,
  uploadLibraryFileToBucket
} from '../../../lib/api.js';
import styles from './admin-library.module.css';

const PDF_MAX_SIZE = 500 * 1024 * 1024;
const COVER_MAX_SIZE = 10 * 1024 * 1024;

function label(type) {
  if (type === 'track_collection') return '曲谱集';
  if (type === 'knowledge_point') return '单知识点';
  if (type === 'knowledge_collection') return '知识点集';
  return '单曲目';
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 MB';
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function validateImage(file) {
  if (!file) return '封面为必填项（A4 竖版 210 : 297）';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '请上传 JPG / PNG / WEBP 封面';
  if (file.size > COVER_MAX_SIZE) return '封面不能超过 10MB';
  return '';
}

function validatePdf(file) {
  if (!file) return '请上传 PDF 文件';
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return '请上传 PDF 文件';
  if (file.size > PDF_MAX_SIZE) return 'PDF 文件不能超过 500MB';
  return '';
}

export default function AdminLibraryPage() {
  return (
    <Suspense fallback={<p className="empty-text">正在加载图书馆管理...</p>}>
      <AdminLibraryContent />
    </Suspense>
  );
}

function AdminLibraryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingId = searchParams.get('id');
  const isEditing = Boolean(editingId);
  const pdfRef = useRef(null);
  const coverRef = useRef(null);
  const toastTimer = useRef(null);
  const [admin, setAdmin] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState('');
  const [coverFile, setCoverFile] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [links, setLinks] = useState([]);
  const [trackLibrary, setTrackLibrary] = useState({ track_points: [], track_collections: [] });
  const [knowledgeLibrary, setKnowledgeLibrary] = useState({ points: [], knowledge_collections: [] });
  const [keyword, setKeyword] = useState('');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('正在检查登录状态...');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  function showToast(message) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/tracks');
          return;
        }
        setAdmin(me.data);
        const [tracks, knowledge] = await Promise.all([fetchTrackLibrary(''), fetchKnowledgeLibrary('')]);
        setTrackLibrary(tracks.data || {});
        setKnowledgeLibrary(knowledge.data || {});
        if (editingId) {
          const detail = await fetchLibraryResourceById(editingId);
          setTitle(detail.data.title || '');
          setDescription(detail.data.description || '');
          setCover(detail.data.cover || '');
          setLinks(detail.data.links || []);
        }
        setStatus('');
      } catch {
        router.replace('/login');
      }
    }
    init();
  }, [router, editingId]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const options = useMemo(() => {
    const items = [
      ...(trackLibrary.track_points || []).map((item) => ({ objectType: 'track_point', objectId: item.id, title: item.name })),
      ...(trackLibrary.track_collections || []).map((item) => ({ objectType: 'track_collection', objectId: item.id, title: item.name })),
      ...(knowledgeLibrary.knowledge_points || knowledgeLibrary.points || []).map((item) => ({ objectType: 'knowledge_point', objectId: item.id, title: item.name })),
      ...(knowledgeLibrary.knowledge_collections || []).map((item) => ({ objectType: 'knowledge_collection', objectId: item.id, title: item.name }))
    ];
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => !q || `${label(item.objectType)} ${item.title}`.toLowerCase().includes(q)).slice(0, 18);
  }, [trackLibrary, knowledgeLibrary, keyword]);

  function selected(item) {
    return links.some((link) => link.objectType === item.objectType && link.objectId === item.objectId);
  }

  function toggle(item) {
    if (selected(item)) {
      setLinks((current) => current.filter((link) => !(link.objectType === item.objectType && link.objectId === item.objectId)));
      return;
    }
    setLinks((current) => [...current, item]);
  }

  function pickCover(file) {
    const message = validateImage(file);
    if (message) {
      setErrors((current) => ({ ...current, cover: message }));
      return;
    }
    if (cover?.startsWith('blob:')) URL.revokeObjectURL(cover);
    setCoverFile(file);
    setCover(URL.createObjectURL(file));
    setErrors((current) => ({ ...current, cover: '' }));
  }

  function pickPdf(file) {
    const message = validatePdf(file);
    if (message) {
      setErrors((current) => ({ ...current, pdf: message }));
      return;
    }
    setPdf(file);
    setErrors((current) => ({ ...current, pdf: '' }));
  }

  function validateForm() {
    const nextErrors = {};
    if (!title.trim()) nextErrors.title = '请填写资料名称';
    if (!cover) nextErrors.cover = '封面为必填项（A4 竖版 210 : 297）';
    if (!isEditing) {
      const pdfError = validatePdf(pdf);
      if (pdfError) nextErrors.pdf = pdfError;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function uploadCoverIfNeeded() {
    if (!coverFile) return cover;
    setStatus('正在申请封面上传地址...');
    const upload = await createLibraryUploadUrl(coverFile, 'cover');
    setStatus('正在上传封面：0%');
    await uploadLibraryFileToBucket({ uploadUrl: upload.data.uploadUrl, file: coverFile, onProgress: (progress) => setStatus(`正在上传封面：${progress}%`) });
    return upload.data.publicUrl;
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !validateForm()) return;

    setBusy(true);
    try {
      const uploadedCover = await uploadCoverIfNeeded();
      let result;
      if (isEditing) {
        setStatus('正在更新资料...');
        result = await updateLibraryResource({
          id: editingId,
          title: title.trim(),
          description: description.trim(),
          cover: uploadedCover,
          links
        });
        showToast('保存成功 · 正在返回图书馆…');
      } else {
        setStatus('正在申请 PDF 上传地址...');
        const upload = await createLibraryUploadUrl(pdf);
        setStatus('正在上传 PDF：0%');
        await uploadLibraryFileToBucket({ uploadUrl: upload.data.uploadUrl, file: pdf, onProgress: (progress) => setStatus(`正在上传 PDF：${progress}%`) });
        result = await createLibraryResource({
          title: title.trim(),
          description: description.trim(),
          cover: uploadedCover,
          fileName: upload.data.fileName,
          fileKey: upload.data.key,
          fileType: upload.data.fileType,
          fileSize: upload.data.fileSize,
          links
        });
        showToast('发布成功 · 正在返回图书馆…');
      }
      setStatus('');
      setTimeout(() => router.push(`/library/${result.data.id}`), 900);
    } catch (error) {
      setStatus(error.message);
      showToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  const previewTitle = title.trim() || '未命名资料';
  const previewMeta = `PDF 资料 · ${pdf ? formatSize(pdf.size) : '待上传'} · ${cover ? '已选封面' : '未选封面'}`;

  return (
    <>
      <AppNav role="super_admin" accountName={admin?.nickname || admin?.username || '教导主任'} />
      <main className={styles.adminWrap}>
        <form className="wizard rise" onSubmit={submit} noValidate>
          <div className="wiz-head">
            <h1>{isEditing ? '编辑' : '上传'} <mark>PDF 资料</mark></h1>
            <span className="zone-badge">图书馆</span>
            <span className="eyebrow">{isEditing ? 'EDIT PDF' : 'UPLOAD PDF'}</span>
          </div>

          <div className="form-body">
            <div className="form-cols">
              <section className="fsec">
                <div className="fsec-title">基本信息</div>
                <div className={`field${errors.title ? ' error' : ''}`}>
                  <label>资料名称 <span className="cnt num">{title.length}/120</span></label>
                  <input type="text" value={title} maxLength={120} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: '' })); }} placeholder="如：卡农独奏 · 全曲乐谱" />
                  {errors.title ? <div className="err-msg">⚠ {errors.title}</div> : null}
                </div>
                <div className="field">
                  <label>简介 <span className="cnt num">{description.length}/800</span></label>
                  <textarea value={description} maxLength={800} onChange={(event) => setDescription(event.target.value)} placeholder="这份资料的内容、适用对象或使用建议…" />
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">封面 <span className="note req">A4 竖版 · 必填</span></div>
                <div className={`field${errors.cover ? ' error' : ''}`}>
                  <div className={`a4-box${cover ? ' has' : ''}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined} role="button" tabIndex={0} onClick={() => coverRef.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') coverRef.current?.click(); }}>
                    {cover ? <button className="cov-rm" type="button" onClick={(event) => { event.stopPropagation(); setCover(''); setCoverFile(null); }}>×</button> : <span className="a4-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 16.5V20h16v-3.5" /></svg><b>上传封面</b><em>210 : 297 · A4 竖版</em></span>}
                  </div>
                  <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden onChange={(event) => pickCover(event.target.files?.[0] || null)} />
                  {errors.cover ? <div className="err-msg">⚠ {errors.cover}</div> : null}
                </div>
              </section>

              <section className="fsec">
                <div className="fsec-title">预览 <span className="note">学员视角 · 实时</span></div>
                <div className="pv-card">
                  <div className={`pv-cover${cover ? ' has' : ''}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}><span className="pdf-badge">PDF</span></div>
                  <div className="pv-name">{previewTitle}</div>
                  <div className="pv-meta">{previewMeta}</div>
                </div>
              </section>

              <section className="fsec full">
                <div className={`field${errors.pdf ? ' error' : ''}`}>
                  <div className="pmanage">
                    <div className="pmanage-head">
                      <span className="pm-t">PDF 文件</span>
                      <span className="pm-note">必填 · 单个文件 ≤ 500 MB · 上传后自动生成预览</span>
                      <span className={`pm-state${pdf || isEditing ? ' ok' : ''}`}>{pdf ? `已选择 · ${formatSize(pdf.size)}` : (isEditing ? '已上传' : '未上传')}</span>
                    </div>
                    <div className="pm-body">
                      <button className={`drop-box${pdf || isEditing ? ' has' : ''}`} type="button" onClick={() => pdfRef.current?.click()}>
                        <span className="pd-t">{pdf ? pdf.name : (isEditing ? '重新选择 PDF 文件' : '点击选择 PDF 文件')}</span>
                        <span className="pd-s">仅支持 .pdf 格式 · 上传后自动生成预览</span>
                      </button>
                      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => pickPdf(event.target.files?.[0] || null)} />
                    </div>
                  </div>
                  {errors.pdf ? <div className="err-msg">⚠ {errors.pdf}</div> : null}
                </div>
              </section>

              <section className="fsec full">
                <div className="fsec-title">关联图书馆 <span className="note">可关联单课 / 合集 / 知识点</span></div>
                <div className="link-picker">
                  <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索要关联的曲目、合集或知识点…" />
                  <div className="link-options">
                    {options.map((item) => (
                      <button type="button" className={selected(item) ? 'on' : ''} onClick={() => toggle(item)} key={`${item.objectType}:${item.objectId}`}>
                        <span>{label(item.objectType)}</span>{item.title}
                      </button>
                    ))}
                  </div>
                  <div className="picked-links">
                    {links.map((item) => <span key={`${item.objectType}:${item.objectId}`}>{label(item.objectType)} · {item.title}</span>)}
                    {links.length === 0 ? <span>暂未关联内容对象。</span> : null}
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="wiz-foot">
            <Link className="btn btn-ghost" href="/library">← 返回</Link>
            <span className="foot-hint">图书馆 · {isEditing ? '编辑 PDF 资料' : '上传 PDF 资料'}{status ? ` · ${status}` : ''}</span>
            <span className="spacer" />
            <button className="btn btn-main" type="submit" disabled={busy}>{busy ? (isEditing ? '保存中...' : '发布中...') : (isEditing ? '保 存 修 改' : '发 布')}</button>
          </div>
        </form>
      </main>
      <div className={`dean-toast${toast ? ' show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
