'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../../components/ui/AppNav.js';
import { fetchAssignmentHistory, fetchCurrentViewer } from '../../lib/api.js';
import styles from './my-homework.module.css';

function dayLabel(value) {
  if (!value) return '暂无日期';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '今天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function timeLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function resolveViewerRoute(role) {
  if (role === 'teacher') return '/admin/users';
  if (role === 'super_admin') return '/tracks';
  return '/login';
}

function RequirementLine({ label, text }) {
  const value = String(text || '').trim();
  if (!value) return null;
  return <div className="hw-msg-line"><span className="hw-msg-label">{label}</span><span className="hw-msg-text">{value}</span></div>;
}

function HomeworkItem({ item }) {
  const title = item.title || '已删除内容';
  return <span className="it off">{title}</span>;
}

function operationSearchText(operation) {
  return [
    operation.practice_requirement,
    operation.submit_requirement,
    ...(operation.items || []).map((item) => item.title)
  ].filter(Boolean).join(' ').toLowerCase();
}

export default function MyHomeworkPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [operations, setOperations] = useState([]);
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [status, setStatus] = useState('正在加载历史作业...');
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const result = await fetchCurrentViewer();
        if (result.data.role !== 'user') {
          router.replace(resolveViewerRoute(result.data.role));
          return;
        }
        setUser(result.data);
        const history = await fetchAssignmentHistory();
        setOperations(history.data.operations || []);
        setStatus('');
      } catch {
        router.replace('/login');
      }
    }
    init();
  }, [router]);

  useEffect(() => {
    function onScroll() {
      setShowTop(window.scrollY > 320);
    }
    window.addEventListener('scroll', onScroll);
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const sortedOperations = useMemo(() => [...operations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [operations]);
  const filteredOperations = useMemo(() => {
    const keyword = historyKeyword.trim().toLowerCase();
    if (!keyword) return sortedOperations;
    return sortedOperations.filter((operation) => operationSearchText(operation).includes(keyword));
  }, [historyKeyword, sortedOperations]);

  if (!user) {
    return <p className="empty-text">正在检查学员登录状态...</p>;
  }

  return (
    <>
      <AppNav role="user" accountName={user.nickname || user.username || '学员'} />
      <main className={styles.home}>
        <div className="toolrow rise">
          <h1>我的历史作业</h1>
          <span className="hint num">{operations.length ? `共 ${operations.length} 次推送 · 按时间倒序` : '暂无推送记录'}</span>
          <label className="history-search" aria-label="搜索历史作业">
            <span>搜索</span>
            <input type="text" value={historyKeyword} onChange={(event) => setHistoryKeyword(event.target.value)} placeholder="标题 / 练习要求 / 提交要求" />
            {historyKeyword ? <button type="button" onClick={() => setHistoryKeyword('')}>清除</button> : null}
          </label>
        </div>

        {!user.isActive ? (
          <div className="stop-banner rise d1" role="alert">
            <span className="ico">!</span>
            <span className="t"><b>你的课程已暂时停用。</b>老师之前带你学到了这里，如需恢复课程请联系老师。</span>
          </div>
        ) : null}

        <section className="zone rise d2">
          <div className="rec-list">
            {filteredOperations.map((operation) => (
              <article className={`hw-item${operation.deleted_at ? ' deleted' : ''}`} key={operation.operation_id}>
                <span className="hw-tm num"><span className="tm">{timeLabel(operation.created_at)}</span><span className="lb">{dayLabel(operation.created_at)}</span></span>
                <span className="hw-main">
                  <div className="hw-from"><b>{operation.teacher_name || '老师'}</b>老师 · 布置</div>
                  {(operation.items || []).length ? <div className="hw-items">{(operation.items || []).map((item) => <HomeworkItem item={item} key={item.id} />)}</div> : null}
                  {(operation.practice_requirement || operation.submit_requirement) ? <div className="hw-msg-pair">
                    <RequirementLine label="练习要求" text={operation.practice_requirement} />
                    <RequirementLine label="提交要求" text={operation.submit_requirement} />
                  </div> : null}
                  {operation.deleted_at ? <div className="hw-delnote">该次作业已由老师删除</div> : null}
                </span>
              </article>
            ))}
          </div>
          {!status && filteredOperations.length === 0 ? (
            <div className="rec-empty show"><span className="big">{operations.length ? '没有匹配的历史作业' : <>还没有收到过<mark>作业</mark></>}</span><span>{operations.length ? '换个关键词试试' : '老师布置作业后会出现在这里和首页'}</span></div>
          ) : null}
          {status ? <p className="empty-text">{status}</p> : null}
        </section>

        <button className={`to-top${showTop ? ' show' : ''}`} type="button" aria-label="回到顶部" title="回到顶部" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>
      </main>
    </>
  );
}
