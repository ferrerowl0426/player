'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../components/ui/AppNav.js';
import { fetchCurrentViewer, fetchTodayAssignments } from '../lib/api.js';
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

  async function loadTodayAssignments() {
    const result = await fetchTodayAssignments();
    setAssignments(result.data.assignments || []);
    setStatus('');
  }

  useEffect(() => {
    async function init() {
      try {
        const result = await fetchCurrentViewer();
        if (result.data.role !== 'user') {
          router.replace(resolveViewerRoute(result.data.role));
          return;
        }
        setUser(result.data);
        await loadTodayAssignments();
      } catch {
        router.replace('/login');
      }
    }
    init();
  }, [router]);

  const contentAssignments = assignments.filter((item) => item.object_type && item.object_type !== 'message' && item.navigation_url);
  const practiceRequirement = useMemo(() => uniqueTextList(assignments, 'practice_requirement').join('\n\n'), [assignments]);
  const submitRequirement = useMemo(() => uniqueTextList(assignments, 'submit_requirement').join('\n\n'), [assignments]);
  const hasRequirement = Boolean(practiceRequirement || submitRequirement);

  if (!user) {
    return <p className="empty-text">正在检查学员登录状态...</p>;
  }

  return (
    <>
      <AppNav role="user" accountName={user.nickname || user.username || '学员'} />
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
              {contentAssignments.map((item) => (
                <Link className="hw" href={item.navigation_url} key={item.id}>
                  <div className="cover" style={item.cover_url ? { backgroundImage: `url(${item.cover_url})` } : undefined}>
                    <span className={`kind-chip${kindText(item) === '合集' ? ' k-set' : ''}`}>{kindText(item)}</span>
                    {kindText(item) === 'P' ? <span className="p-tag num">P</span> : null}
                    <span className="go"><span>开始学习</span></span>
                  </div>
                  <div className="nm">{item.title || '推荐内容'}</div>
                  <div className="from num"><span className="tk">{String(item.teacher_name || '老').slice(0, 1)}</span>{item.teacher_name || '老师'} · 今日作业</div>
                </Link>
              ))}
              {!status && contentAssignments.length === 0 ? <div className="hw-empty"><span className="big">今天还没有作业</span><span>去曲目库和图书馆逛逛，或查看历史作业复习</span></div> : null}
            </div>
            {status ? <p className="empty-text">{status}</p> : null}
          </section>
        </div>
      </main>
    </>
  );
}
