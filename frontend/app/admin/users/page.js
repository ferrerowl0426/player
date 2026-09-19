'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import styles from './page.module.css';
import {
  createUserAssignment,
  deleteOperation,
  fetchAdminMe,
  fetchClasses,
  fetchKnowledgeLibrary,
  fetchKnowledgePointById,
  fetchManagedUsers,
  fetchTrackById,
  fetchTrackLibrary,
  fetchUserAssignments,
  updateManagedUserMark,
  clearManagedUserMarks
} from '../../../lib/api.js';

const REQUIREMENT_MAX_LENGTH = 1000;
const MAX_ASSIGNMENTS = 5;
const STUDENT_LIST_SCROLL_KEY = 'admin:users:student-list-scroll-top';
const HISTORY_LIST_SCROLL_PREFIX = 'admin:users:history-list-scroll-top:';

function operationSearchText(operation) {
  return [
    operation.practice_requirement,
    operation.submit_requirement,
    ...(operation.videos || []).map((item) => item.title)
  ].filter(Boolean).join(' ').toLowerCase();
}

function formatDate(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleString('zh-CN');
}

function dayLabel(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function timeLabel(dateString) {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function initial(name) {
  return String(name || '学').slice(0, 1);
}

function optionKindLabel(kind) {
  if (kind === 'collection') return '合集';
  if (kind === 'part') return '单 P';
  return '单课';
}

function optionClass(kind) {
  if (kind === 'collection') return 't-col';
  if (kind === 'part') return 't-par';
  return 't-les';
}

function objectKey(item) {
  if (item.kind === 'part' || item.objectType?.endsWith('_part')) {
    return `${item.objectType}:${item.partId || item.objectId}:${item.partId || item.objectId}`;
  }
  return `${item.objectType}:${item.objectId}:0`;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [isClassPickerOpen, setIsClassPickerOpen] = useState(false);
  const [studentKeyword, setStudentKeyword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [operations, setOperations] = useState([]);
  const [practiceRequirement, setPracticeRequirement] = useState('');
  const [submitRequirement, setSubmitRequirement] = useState('');
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [modal, setModal] = useState(null);
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [pushKeyword, setPushKeyword] = useState('');
  const [pushScope, setPushScope] = useState('all');
  const [contentOptions, setContentOptions] = useState([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef(null);
  const classPickerRef = useRef(null);
  const studentListRef = useRef(null);
  const historyListRef = useRef(null);
  const [status, setStatus] = useState('正在检查老师登录状态...');
  const [busy, setBusy] = useState(false);

  const isSuperAdmin = admin?.role === 'super_admin';

  function getUrlParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }

  function readSavedScroll(key) {
    if (typeof window === 'undefined') return 0;
    const value = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function saveScroll(key, top) {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(top || 0))));
  }

  function syncSelectedUserUrl(userId, { replace = false } = {}) {
    if (typeof window === 'undefined') return;
    const params = getUrlParams();
    params.set('user', String(userId));
    const nextUrl = `/admin/users?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method](null, '', nextUrl);
  }

  function selectUser(userId, { replace = false } = {}) {
    if (studentListRef.current) saveScroll(STUDENT_LIST_SCROLL_KEY, studentListRef.current.scrollTop);
    if (historyListRef.current && selectedUserId) saveScroll(`${HISTORY_LIST_SCROLL_PREFIX}${selectedUserId}`, historyListRef.current.scrollTop);
    setSelectedUserId(userId);
    syncSelectedUserUrl(userId, { replace });
  }

  useEffect(() => {
    document.body.classList.add('student-manage-page');
    return () => document.body.classList.remove('student-manage-page');
  }, []);

  async function loadUsers() {
    const result = await fetchManagedUsers();
    setUsers(result.data || []);
  }

  async function loadAssignments(userId) {
    if (!userId) return;
    const result = await fetchUserAssignments(userId);
    setSelectedUser(result.data.user);
    setOperations(result.data.operations || []);
    setPracticeRequirement('');
    setSubmitRequirement('');
    setStatus('');
  }

  async function loadContentOptions() {
    const [trackLibrary, knowledgeLibrary] = await Promise.all([fetchTrackLibrary(''), fetchKnowledgeLibrary('')]);
    const tracks = trackLibrary.data.track_points || [];
    const trackCollections = trackLibrary.data.track_collections || [];
    const knowledgePoints = knowledgeLibrary.data.knowledge_points || knowledgeLibrary.data.points || [];
    const knowledgeCollections = knowledgeLibrary.data.knowledge_collections || [];

    const [trackDetails, knowledgeDetails] = await Promise.all([
      Promise.all(tracks.map((track) => fetchTrackById(track.id).then((result) => result.data).catch(() => ({ ...track, parts: [] })))),
      Promise.all(knowledgePoints.map((point) => fetchKnowledgePointById(point.id).then((result) => result.data).catch(() => ({ ...point, parts: [] }))))
    ]);

    const options = [
      ...trackCollections.map((item) => ({ kind: 'collection', objectType: 'track_collection', objectId: item.id, title: item.name, meta: `曲谱集 · 收录 ${item.track_count || 0} 首` })),
      ...knowledgeCollections.map((item) => ({ kind: 'collection', objectType: 'knowledge_collection', objectId: item.id, title: item.name, meta: `知识点集 · 收录 ${item.point_count || 0} 个` })),
      ...tracks.map((item) => ({ kind: 'lesson', objectType: 'track_point', objectId: item.id, title: item.name, meta: `单曲目 · ${item.part_count || 0} 个 P` })),
      ...knowledgePoints.map((item) => ({ kind: 'lesson', objectType: 'knowledge_point', objectId: item.id, title: item.name, meta: `单知识点 · ${item.part_count || 0} 个 P` })),
      ...trackDetails.flatMap((track) => (track.parts || []).map((part) => ({
        kind: 'part',
        objectType: 'track_part',
        objectId: track.id,
        partId: part.id,
        title: `${track.name}-${part.title}`,
        meta: `所属：${track.name}`
      }))),
      ...knowledgeDetails.flatMap((point) => (point.parts || []).map((part) => ({
        kind: 'part',
        objectType: 'knowledge_part',
        objectId: point.id,
        partId: part.id,
        title: `${point.name}-${part.title}`,
        meta: `所属：${point.name}`
      })))
    ];
    setContentOptions(options);
  }

  useEffect(() => {
    async function initPage() {
      try {
        const me = await fetchAdminMe();
        setAdmin(me.data);
        if (me.data.role === 'teacher' && me.data.status === 'disabled') {
          setStatus('');
          return;
        }
        const [classesResult] = await Promise.all([fetchClasses(), loadUsers(), loadContentOptions()]);
        const classList = classesResult.data || [];
        setClasses(classList);
        setSelectedClassIds(classList.map((item) => item.id));
        setStatus('');
      } catch (error) {
        router.replace('/admin/login');
      }
    }
    initPage();
  }, [router]);

  useEffect(() => {
    if (users.length === 0) return;
    const params = getUrlParams();
    const urlUserId = Number(params.get('user'));
    const fallbackId = users[0].id;
    const nextUserId = users.some((user) => user.id === urlUserId) ? urlUserId : fallbackId;
    setSelectedUserId((current) => current || nextUserId);
    if (String(params.get('user') || '') !== String(nextUserId)) {
      syncSelectedUserUrl(nextUserId, { replace: true });
    }
  }, [users]);

  useEffect(() => {
    if (selectedUserId) {
      loadAssignments(selectedUserId).catch((error) => setStatus(error.message));
      setSelectedObjects([]);
      setHistoryKeyword('');
    }
  }, [selectedUserId]);

  useEffect(() => {
    if (!modal) return undefined;
    function handleEscape(event) {
      if (event.key === 'Escape') setModal(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [modal]);

  useEffect(() => {
    function closePicker(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setIsPickerOpen(false);
      if (classPickerRef.current && !classPickerRef.current.contains(event.target)) setIsClassPickerOpen(false);
    }
    document.addEventListener('mousedown', closePicker);
    return () => document.removeEventListener('mousedown', closePicker);
  }, []);

  const activeClasses = useMemo(() => classes.filter((item) => item.is_active !== false), [classes]);
  const classNameById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);

  const visibleUsers = useMemo(() => {
    const keyword = studentKeyword.trim().toLowerCase();
    return [...users]
      .filter((user) => selectedClassIds.length === 0 || selectedClassIds.includes(user.class_id))
      .filter((user) => !keyword || String(user.nickname || user.username).toLowerCase().includes(keyword) || String(user.username).toLowerCase().includes(keyword))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active));
  }, [selectedClassIds, studentKeyword, users]);

  useEffect(() => {
    if (!studentListRef.current || visibleUsers.length === 0) return;
    const savedTop = readSavedScroll(STUDENT_LIST_SCROLL_KEY);
    if (savedTop > 0) requestAnimationFrame(() => { if (studentListRef.current) studentListRef.current.scrollTop = savedTop; });
  }, [visibleUsers.length]);

  const filteredOptions = useMemo(() => {
    const keyword = pushKeyword.trim().toLowerCase();
    return contentOptions
      .filter((item) => pushScope === 'all' || item.kind === pushScope)
      .filter((item) => !keyword || `${item.title} ${item.meta}`.toLowerCase().includes(keyword))
      .slice(0, 24);
  }, [contentOptions, pushKeyword, pushScope]);

  const filteredOperations = useMemo(() => {
    const keyword = historyKeyword.trim().toLowerCase();
    if (!keyword) return operations;
    return operations.filter((operation) => operationSearchText(operation).includes(keyword));
  }, [historyKeyword, operations]);

  useEffect(() => {
    if (!historyListRef.current || !selectedUserId) return;
    const savedTop = readSavedScroll(`${HISTORY_LIST_SCROLL_PREFIX}${selectedUserId}`);
    requestAnimationFrame(() => { if (historyListRef.current) historyListRef.current.scrollTop = savedTop; });
  }, [filteredOperations.length, selectedUserId]);

  const selectedKeys = useMemo(() => new Set(selectedObjects.map(objectKey)), [selectedObjects]);
  const markedCount = useMemo(() => users.filter((user) => user.is_marked && user.is_active).length, [users]);
  const latestActiveOperationId = useMemo(() => operations.filter((operation) => !operation.is_deleted).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.operation_id, [operations]);
  const isSelectedUserDisabled = selectedUser?.is_active === false;

  function toggleClass(classId) {
    setSelectedClassIds((current) => current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId]);
  }

  function selectAllClasses() {
    setSelectedClassIds(classes.map((item) => item.id));
  }

  function clearAllClasses() {
    setSelectedClassIds([]);
  }

  function toggleObject(item) {
    const key = objectKey(item);
    setSelectedObjects((current) => {
      if (current.some((selected) => objectKey(selected) === key)) {
        return current.filter((selected) => objectKey(selected) !== key);
      }
      if (current.length >= MAX_ASSIGNMENTS) {
        setStatus(`本次最多选择 ${MAX_ASSIGNMENTS} 个作业对象`);
        return current;
      }
      return [...current, item];
    });
  }

  function fillLastAssignment() {
    const last = operations.filter((operation) => !operation.is_deleted).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (!last) {
      setStatus('暂无可回填的作业数据');
      return;
    }
    const matched = [];
    for (const video of last.videos || []) {
      if (matched.length >= MAX_ASSIGNMENTS) break;
      const option = contentOptions.find((item) => item.title === video.title);
      if (!option) continue;
      const key = objectKey(option);
      if (matched.some((item) => objectKey(item) === key)) continue;
      matched.push(option);
    }
    setSelectedObjects(matched);
    setPracticeRequirement(last.practice_requirement || '');
    setSubmitRequirement(last.submit_requirement || '');
    setStatus(`已回填上次作业（${dayLabel(last.created_at)} ${timeLabel(last.created_at)} 布置），可修改后再推送`);
  }

  async function submitAssignment(event) {
    event.preventDefault();
    if (!selectedUserId || busy) return;
    const trimmedPracticeRequirement = practiceRequirement.trim();
    const trimmedSubmitRequirement = submitRequirement.trim();
    if (selectedObjects.length === 0 && !trimmedPracticeRequirement && !trimmedSubmitRequirement) {
      setStatus('请至少填写一项作业内容（视频作业、练习要求或提交要求）');
      return;
    }
    if (trimmedPracticeRequirement.length > REQUIREMENT_MAX_LENGTH || trimmedSubmitRequirement.length > REQUIREMENT_MAX_LENGTH) {
      setStatus(`练习要求和提交要求各最多 ${REQUIREMENT_MAX_LENGTH} 个字`);
      return;
    }
    if (isSelectedUserDisabled) {
      setStatus('停用学员不可布置新作业');
      return;
    }

    setBusy(true);
    try {
      setStatus('正在推送作业...');
      await createUserAssignment({ userId: selectedUserId, objects: selectedObjects, practiceRequirement: trimmedPracticeRequirement, submitRequirement: trimmedSubmitRequirement });
      setSelectedObjects([]);
      setPracticeRequirement('');
      setSubmitRequirement('');
      setIsPickerOpen(false);
      await loadAssignments(selectedUserId);
      setStatus('作业已推送');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOperation(operationId, reason) {
    if (!reason?.trim()) {
      setStatus('请填写删除原因');
      return;
    }
    try {
      setStatus('正在删除历史记录...');
      await deleteOperation({ operationId, reason: reason.trim() });
      setModal(null);
      await loadAssignments(selectedUserId);
    } catch (error) {
      setStatus(error.message);
    }
  }


  async function handleToggleMark(user) {
    if (!isSuperAdmin || !user?.is_active) return;
    try {
      await updateManagedUserMark({ id: user.id, isMarked: !user.is_marked });
      await loadUsers();
      await loadAssignments(user.id);
      setStatus(`${user.is_marked ? '已取消标记' : '已标记'}「${user.nickname || user.username}」`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleClearMarks() {
    try {
      const result = await clearManagedUserMarks();
      setModal(null);
      await loadUsers();
      if (selectedUserId) await loadAssignments(selectedUserId);
      setStatus(`已清除全部标记（${result.data.clearedCount} 位学生）`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!admin) return <p className="empty-text">正在检查老师登录状态...</p>;

  const accountName = admin.nickname || admin.username;
  const isDisabledTeacher = admin.role === 'teacher' && admin.status === 'disabled';
  const noClass = classes.length === 0 && !isSuperAdmin;

  if (isDisabledTeacher) {
    return (
      <>
        <AppNav role={admin.role} accountName={accountName} homeHref="/tracks" actions={<span className="role-tag">老师 · {accountName}</span>} />
        <main className={`${styles.studentManage} home student-manage`}>
          <div className="noclass-mask show" role="alert">
            <div className="disabled-note">
              <h3>此账号已停用</h3>
              <p>请联系教导主任获取工作内容。停用期间无法查看学生记录与布置作业。</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav role={admin.role} accountName={accountName} homeHref="/tracks" actions={<span className="role-tag">{isSuperAdmin ? '教导主任' : '老师'} · {accountName}</span>} />
      <main className={`${styles.studentManage} home student-manage`}>
        <div className="cols rise d1">
          <section className="zone side">
            <div className="zone-head">
              <h2>选择学生</h2>
              <span className="meta num">共 {visibleUsers.length} 人</span>
              {isSuperAdmin && markedCount > 0 ? <button type="button" className="mk-clear" title={`清除全部标记（${markedCount} 人）`} aria-label={`清除全部标记（${markedCount} 人）`} onClick={() => setModal({ type: 'clearMarks' })}><span className="mk-clear-dot">{markedCount}</span><span className="mk-clear-text">清标</span></button> : null}
            </div>
            <div className="filters">
              <div>
                <div className="f-lbl">班级</div>
                <div className={`cls-dd${isClassPickerOpen ? ' open' : ''}`} ref={classPickerRef}>
                  <button type="button" className="cls-dd-btn" aria-haspopup="listbox" aria-expanded={isClassPickerOpen} onClick={() => setIsClassPickerOpen((open) => !open)}>
                    <span className="lb">{selectedClassIds.length === classes.length ? '全部班级' : selectedClassIds.length === 0 ? '未选择班级' : `已选 ${selectedClassIds.length} 个班级`}</span>
                    <ChevronIcon />
                  </button>
                  <div className="cls-dd-panel">
                    <div className="cls-dd-ops">
                      <button type="button" onClick={selectAllClasses} disabled={selectedClassIds.length === classes.length}>全选</button>
                      <button type="button" onClick={clearAllClasses} disabled={selectedClassIds.length === 0}>全不选</button>
                    </div>
                    <div className="cls-dd-list" role="listbox" aria-multiselectable="true">
                      {classes.map((cls) => <button type="button" role="option" aria-selected={selectedClassIds.includes(cls.id)} className={`cls-opt${selectedClassIds.includes(cls.id) ? ' on' : ''}`} onClick={() => toggleClass(cls.id)} key={cls.id}><span className="cbx">{selectedClassIds.includes(cls.id) ? '✓' : ''}</span><span>{cls.name}</span></button>)}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="f-lbl">学生 <span>（支持搜索）</span></div>
                <label className="stu-search" style={{ marginTop: 6 }}>
                  <SearchIcon />
                  <input type="text" value={studentKeyword} onChange={(event) => setStudentKeyword(event.target.value)} placeholder="搜索学生昵称…" />
                </label>
              </div>
            </div>
            <div className="stu-list scroll" ref={studentListRef} onScroll={(event) => saveScroll(STUDENT_LIST_SCROLL_KEY, event.currentTarget.scrollTop)}>
              {visibleUsers.map((user) => (
                <div role="button" tabIndex={0} className={`stu-item${selectedUserId === user.id ? ' on' : ''}${user.is_active ? '' : ' dis'}`} onClick={() => selectUser(user.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectUser(user.id); }} key={user.id}>
                  <span className="ava">{initial(user.nickname || user.username)}</span>
                  <span className="info"><span className="nm">{user.nickname || user.username}</span><span className="cls">{classNameById.get(user.class_id) || '未分班'}</span></span>
                  {!user.is_active ? <span className="st">停用</span> : null}
                  {isSuperAdmin && user.is_active ? <button type="button" className={`mk${user.is_marked ? ' on' : ''}`} title={user.is_marked ? '取消标记' : '标记学生'} aria-label={`${user.is_marked ? '取消标记' : '标记'} ${user.nickname || user.username}`} onClick={(event) => { event.stopPropagation(); handleToggleMark(user); }}><i /></button> : null}
                </div>
              ))}
              {visibleUsers.length === 0 ? <p className="stu-empty">未找到匹配的学生。</p> : null}
            </div>
          </section>

          <section className="main">
            <div className="zone history-zone">
              <div className="zone-head history-head">
                <h2>历史作业</h2>
                <span className="meta num">{operations.length ? `${filteredOperations.length}/${operations.length} 次记录` : '—'}</span>
                <button type="button" className="hist-top" onClick={() => historyListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部</button>
              </div>
              {selectedUser ? (
                <div className="stu-head">
                  <div className="ava">{initial(selectedUser.nickname || selectedUser.username)}</div>
                  <div><div className="nm">{selectedUser.nickname || selectedUser.username}</div><div className="sub num">账号 {selectedUser.username} · 创建于 {formatDate(selectedUser.created_at)}</div></div>
                  {!selectedUser.is_active ? <span className="tag-dis">已停用</span> : null}
                  {isSuperAdmin && selectedUser.is_active ? <button type="button" className={`mk-tag${selectedUser.is_marked ? ' on' : ''}`} onClick={() => handleToggleMark(selectedUser)}>{selectedUser.is_marked ? '取消标记' : '标记学生'}</button> : null}
                  <span className="zone-ops" />
                </div>
              ) : null}
              <label className="hist-search" aria-label="搜索历史作业">
                <SearchIcon />
                <input type="text" value={historyKeyword} onChange={(event) => setHistoryKeyword(event.target.value)} placeholder="搜索推送标题 / 练习要求 / 提交要求" />
                {historyKeyword ? <button type="button" onClick={() => setHistoryKeyword('')}>清除</button> : null}
              </label>
              <div className="rec-list scroll" ref={historyListRef} onScroll={(event) => selectedUserId && saveScroll(`${HISTORY_LIST_SCROLL_PREFIX}${selectedUserId}`, event.currentTarget.scrollTop)}>
                {filteredOperations.map((operation) => (
                  <div className={`hw-item${operation.is_deleted ? ' deleted' : ''}`} key={operation.operation_id}>
                    <div className="hw-tm"><div className="tm">{timeLabel(operation.created_at)}</div><div className="lb">{dayLabel(operation.created_at)}</div></div>
                    <div className="hw-main">
                      <div className="hw-items snapshot">
                        {(operation.videos || []).map((item) => <span className="it" key={item.assignment_id}>{item.title}</span>)}
                      </div>
                      <div className="hw-from">由 <b>{operation.admin_username || '老师'}</b> 布置</div>
                      {(operation.practice_requirement || operation.submit_requirement) ? <div className="hw-msg-pair">
                        {operation.practice_requirement ? <div className="hw-msg-line"><span className="hw-msg-label">练习要求：</span><span className="hw-msg-text">{operation.practice_requirement}</span></div> : null}
                        {operation.submit_requirement ? <div className="hw-msg-line"><span className="hw-msg-label">提交要求：</span><span className="hw-msg-text">{operation.submit_requirement}</span></div> : null}
                      </div> : null}
                      {operation.is_deleted ? <div className="hw-delnote"><b>已删除：</b>{operation.delete_reason || '记录已删除'}</div> : null}
                    </div>
                    <span className="hw-action">{!operation.is_deleted ? <button type="button" className={`hw-del${latestActiveOperationId === operation.operation_id ? ' latest' : ''}`} disabled={latestActiveOperationId === operation.operation_id} title={latestActiveOperationId === operation.operation_id ? '最新作业不能删除，请先布置一条新的作业' : '删除这条记录'} onClick={() => latestActiveOperationId !== operation.operation_id && setModal({ type: 'deleteOperation', operation })}>删除</button> : null}</span>
                  </div>
                ))}
                {filteredOperations.length === 0 ? <p className="rec-empty">{selectedUser ? (operations.length ? '没有匹配的历史作业。' : '还没有历史作业。') : '在左侧选择一位学生，查看 TA 的历史作业'}</p> : null}
              </div>
            </div>
          </section>

          <section className="aside">
            <div className="zone">
              <div className="zone-head"><h2>布置作业</h2></div>
              <form className="push-body" onSubmit={submitAssignment}>
                {isSelectedUserDisabled ? <div className="push-notice show"><b>该学员账号已停用</b> · {isSuperAdmin ? '请先恢复账号后再布置作业' : '请联系教导主任启用账号'}</div> : null}
                <div className={`hw-picker${isSelectedUserDisabled ? ' disabled' : ''}`} ref={pickerRef}>
                  <div className="stu-search">
                    <SearchIcon />
                    <input type="text" disabled={isSelectedUserDisabled} value={pushKeyword} onFocus={() => setIsPickerOpen(true)} onChange={(event) => { setPushKeyword(event.target.value); setIsPickerOpen(true); }} placeholder="搜索合集 / 单课 / 单 P 名称…" />
                    <select disabled={isSelectedUserDisabled} className="hw-scope" value={pushScope} onChange={(event) => setPushScope(event.target.value)} aria-label="搜索范围">
                      <option value="all">范围：不限</option>
                      <option value="collection">合集</option>
                      <option value="lesson">单课</option>
                      <option value="part">单 P</option>
                    </select>
                  </div>
                  <div className={`hw-drop${isPickerOpen ? ' open' : ''}`} aria-hidden={!isPickerOpen}>
                    {filteredOptions.map((item) => {
                      const key = objectKey(item);
                      const selected = selectedKeys.has(key);
                      return (
                        <button type="button" disabled={isSelectedUserDisabled} className={`hw-item${selected ? ' off' : ''}`} onClick={() => { toggleObject(item); setIsPickerOpen(false); }} key={key}>
                          <span className={`ptag ${optionClass(item.kind)}`}>{optionKindLabel(item.kind)}</span>
                          <span className="hnm">{item.title}</span>
                          <span className="hmeta">{selected ? '已选择' : item.meta}</span>
                        </button>
                      );
                    })}
                    {filteredOptions.length === 0 ? <div className="pick-empty show">未找到匹配的内容，换个关键词试试</div> : null}
                  </div>
                </div>
                <div className="picked-box show">
                  <div className="picked-lbl">已选作业 <b className="num">{selectedObjects.length}/{MAX_ASSIGNMENTS}</b> · 点击 × 可移除</div>
                  <div className="picked-list">
                    {selectedObjects.length === 0 ? <div className="picked-empty">还没有选择作业内容，用上方搜索添加（最多 {MAX_ASSIGNMENTS} 项）</div> : null}
                    {selectedObjects.map((item) => (
                      <div className="picked-item" key={objectKey(item)}>
                        <span className="pk-kind">{optionKindLabel(item.kind)}</span>
                        <span className="pn">{item.title}</span>
                        <button type="button" className="pk-del" disabled={isSelectedUserDisabled} onClick={() => toggleObject(item)}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="msg-pair">
                  <textarea className="msg-box" disabled={isSelectedUserDisabled} maxLength={REQUIREMENT_MAX_LENGTH} value={practiceRequirement} onChange={(event) => setPracticeRequirement(event.target.value)} placeholder="练习要求（选填）…" aria-label="练习要求" />
                  <textarea className="msg-box" disabled={isSelectedUserDisabled} maxLength={REQUIREMENT_MAX_LENGTH} value={submitRequirement} onChange={(event) => setSubmitRequirement(event.target.value)} placeholder="视频提交要求（选填）…" aria-label="视频提交要求" />
                </div>
                <div className="push-foot">
                  <button type="button" className="btn-shortcut" disabled={busy || isSelectedUserDisabled || !selectedUser} onClick={fillLastAssignment}>上次作业</button>
                  <button className="btn-main" type="submit" disabled={busy || noClass || !selectedUserId || isSelectedUserDisabled}>{busy ? '推送作业中' : '推送作业'}</button>
                  {status ? <span className="tip">{status}</span> : null}
                </div>
              </form>
            </div>
          </section>
        </div>

        {noClass ? (
          <div className="noclass-mask show" role="alert"><div className="disabled-note"><h3>暂无带班班级</h3><p>请联系教导主任获取工作内容</p></div></div>
        ) : null}

        {modal ? (
          <div className="manage-modal-mask" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
            <div className="manage-modal">
              {modal.type === 'deleteOperation' ? (
                <>
                  <h3>删除历史作业</h3>
                  <p>删除后仅保留记录和删除原因，不会物理清除数据。</p>
                  <label>删除原因<textarea autoFocus value={modal.reason || ''} onChange={(event) => setModal({ ...modal, reason: event.target.value })} placeholder="如：手滑布置错了" maxLength={200} /></label>
                  <div className="manage-modal-ops"><button type="button" className="mbtn" onClick={() => setModal(null)}>取消</button><button type="button" className="mbtn danger" onClick={() => handleDeleteOperation(modal.operation.operation_id, modal.reason)}>确认删除</button></div>
                </>
              ) : null}
              {modal.type === 'clearMarks' ? (
                <>
                  <h3>清除全部标记</h3>
                  <p>将清除全部 active 学员的标记，不受当前班级和搜索筛选影响。</p>
                  <div className="manage-modal-ops"><button type="button" className="mbtn" onClick={() => setModal(null)}>取消</button><button type="button" className="mbtn mark" onClick={handleClearMarks}>确认清除</button></div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
