'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../components/ui/AppNav.js';
import { fetchCurrentViewer, fetchTodayAssignments, fetchAssignmentNavigation } from '../lib/api.js';
import {
  UNAVAILABLE_TITLE,
  TARGET_STATUS,
  assignmentDisplayCover,
  assignmentDisplayTitle,
  isAssignmentClickable,
  isNavigationUnavailable,
  isTargetUnavailable
} from '../lib/assignmentViewLogic.js';
import styles from './home.module.css';

function kindText(item) {
  if (item.object_type === 'track_collection' || item.object_type === 'knowledge_collection') return '合集';
  if (item.object_type === 'track_part' || item.object_type === 'knowledge_part') return 'P';
  return '单课';
}

function uniqueTextList(assignments, field) {
  return Array.from(new Set(assignments.map((item) => String(item[field] || '').trim()).filter(Boolean)));
}

function textMeta(text) {
  const lines = String(text || '').split('\n').filter((line) => line.trim()).length;
  if (!lines) return '';
  return `${lines} 行`;
}

function resolveViewerRoute(role) {
  if (role === 'teacher') return '/admin/users';
  if (role === 'super_admin') return '/tracks';
  return '/login';
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [status, setStatus] = useState('正在加载今日作业...');
  const [toast, setToast] = useState('');
  const [toastVersion, setToastVersion] = useState(0);

  // 卸载保护 + 加载/点击竞态：只有最后一次加载能回写；同一项点击不可重复请求。
  const mountedRef = useRef(false);
  const loadVersionRef = useRef(0);
  const navigatingIdsRef = useRef(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function notify(message) { setToast(message); setToastVersion((value) => value + 1); }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(timer);
  }, [toast, toastVersion]);

  // 作业加载失败只更新状态文案，绝不伪装成登录失效；旧序号响应直接丢弃。
  const loadTodayAssignments = useCallback(async () => {
    const version = ++loadVersionRef.current;
    try {
      const result = await fetchTodayAssignments();
      if (!mountedRef.current || version !== loadVersionRef.current) return;
      setAssignments(result.data?.assignments || []);
      setStatus('');
    } catch (error) {
      if (!mountedRef.current || version !== loadVersionRef.current) return;
      setStatus(error?.message || '暂时无法加载今日作业，请稍后刷新重试');
    }
  }, []);

  // 登录检查与作业加载分开：作业接口失败不会误踢登录。
  useEffect(() => {
    let cancelled = false;
    async function init() {
      let result;
      try {
        result = await fetchCurrentViewer();
      } catch {
        if (!cancelled) router.replace('/login');
        return;
      }
      if (cancelled) return;
      if (result.data.role !== 'user') {
        router.replace(resolveViewerRoute(result.data.role));
        return;
      }
      setUser(result.data);
      await loadTodayAssignments();
    }
    init();
    return () => { cancelled = true; };
  }, [router, loadTodayAssignments]);

  // 恢复公开由下一次正常查询触发：窗口重新聚焦 / 页面重新可见时重读，不新增轮询。
  useEffect(() => {
    if (!user) return undefined;
    function onFocus() { loadTodayAssignments(); }
    function onVisibility() { if (document.visibilityState === 'visible') loadTodayAssignments(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, loadTodayAssignments]);

  // 已知失效项不会调用此函数（没有 onClick）；此处仅对可用项按作业 ID 复核。
  async function openAssignment(event, item) {
    event.preventDefault();
    if (!isAssignmentClickable(item)) return;
    const id = item.id;
    if (navigatingIdsRef.current.has(id)) return;
    navigatingIdsRef.current.add(id);
    try {
      const result = await fetchAssignmentNavigation(id);
      const data = result.data || {};
      if (data.status === TARGET_STATUS.AVAILABLE) {
        if (mountedRef.current && typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) {
          router.push(data.url);
        }
        return;
      }
      // private / missing / 未知状态：静默把该项变灰，并重读当前真实状态；不跳转、不 Toast。
      if (mountedRef.current) {
        const status = isNavigationUnavailable(data.status) ? data.status : TARGET_STATUS.MISSING;
        setAssignments((current) => current.map((entry) => (entry.id === id ? {
          ...entry,
          target_status: status,
          target_private: true,
          title: UNAVAILABLE_TITLE,
          cover_url: '',
          navigation_url: null
        } : entry)));
        loadTodayAssignments();
      }
    } catch (error) {
      if (mountedRef.current) notify(error?.message || '暂时无法打开作业，请稍后重试');
    } finally {
      navigatingIdsRef.current.delete(id);
    }
  }

  const contentAssignments = assignments.filter((item) => item.object_type && item.object_type !== 'message');
  const practiceRequirement = useMemo(() => uniqueTextList(assignments, 'practice_requirement').join('\n\n'), [assignments]);
  const submitRequirement = useMemo(() => uniqueTextList(assignments, 'submit_requirement').join('\n\n'), [assignments]);
  const hasRequirement = Boolean(practiceRequirement || submitRequirement);

  if (!user) {
    return <p className="empty-text">正在检查学员登录状态...</p>;
  }

  return (
    <>
      {toast ? <div className="dean-toast" role="status" aria-live="polite">{toast}</div> : null}
      <AppNav role="user" accountName={user.nickname || user.username || '学员'} username={user.username} />
      <main className={styles.home}>
        <div className="greet rise">
          <h1>{user.nickname || user.username || '同学'}，今天练琴了吗？</h1>
        </div>

        {!user.isActive ? (
          <div className="stop-banner rise d1" role="alert">
            <span className="ico">!</span>
            <span className="t"><b>你的课程已暂时停用。</b>资源免费开放半年用于自学，如需恢复课程请联系老师。</span>
          </div>
        ) : null}

        <div className="cols rise d2">
          <div className="sec-head requirement-head">
            <h2>作业要求</h2>
          </div>
          <div className="sec-head assignment-head">
            <h2>今天你需要用到的学习资源</h2>
            <span className="meta num">老师布置了 {contentAssignments.length} 项</span>
            <span className="note">点击封面开始学习 · 单 P 直达对应段落</span>
          </div>

          <section className="sec requirement-sec" aria-label="作业要求">
            <div className="req-stack">
              {practiceRequirement ? (
                <article className="req-card">
                  <div className="req-top"><h3 className="req-title">练习要求</h3><span className="req-meta num">{textMeta(practiceRequirement)}</span></div>
                  <div className="req-text">{practiceRequirement}</div>
                </article>
              ) : null}
              {submitRequirement ? (
                <article className="req-card">
                  <div className="req-top"><h3 className="req-title">提交要求</h3><span className="req-meta num">{textMeta(submitRequirement)}</span></div>
                  <div className="req-text">{submitRequirement}</div>
                </article>
              ) : null}
              {!hasRequirement ? (
                <article className="req-card req-empty">
                  <div className="req-top"><h3 className="req-title">暂无作业要求</h3></div>
                  <div className="req-text muted">老师布置练习要求或提交要求后，会显示在这里。</div>
                </article>
              ) : null}
            </div>
          </section>

          <section className="sec assignment-sec" aria-label="今日学习资源">
            <div className="grid">
              {contentAssignments.map((item) => {
                if (isTargetUnavailable(item)) {
                  // 失效项：非 Link 静态卡片，浅灰默认框、精确标题；无图/开始学习/hover/点击行为。
                  return (
                    <article className="hw hw-disabled" aria-disabled="true" key={item.id}>
                      <div className="cover cover-disabled" />
                      <div className="nm">{assignmentDisplayTitle(item)}</div>
                      <div className="from num"><span className="tk">{String(item.teacher_name || '老').slice(0, 1)}</span>{item.teacher_name || '老师'} · 今日作业</div>
                    </article>
                  );
                }
                const coverUrl = assignmentDisplayCover(item);
                return (
                  <Link className="hw" href={item.navigation_url || '#'} onClick={(event) => openAssignment(event, item)} key={item.id}>
                    <div className="cover" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>
                      <span className={`kind-chip${kindText(item) === '合集' ? ' k-set' : ''}`}>{kindText(item)}</span>
                      {kindText(item) === 'P' ? <span className="p-tag num">P</span> : null}
                      <span className="go"><span>开始学习</span></span>
                    </div>
                    <div className="nm">{assignmentDisplayTitle(item)}</div>
                    <div className="from num"><span className="tk">{String(item.teacher_name || '老').slice(0, 1)}</span>{item.teacher_name || '老师'} · 今日作业</div>
                  </Link>
                );
              })}
              {!status && contentAssignments.length === 0 ? <div className="hw-empty"><span className="big">今天还没有作业</span><span>去曲目库和图书馆逛逛，或查看历史作业复习</span></div> : null}
            </div>
            {status ? <p className="empty-text">{status}</p> : null}
          </section>
        </div>
      </main>
    </>
  );
}
