'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNav from '../../../components/ui/AppNav.js';
import {
  createClass,
  createManagedAdmin,
  createManagedUser,
  deleteClass,
  deleteManagedAdmin,
  deleteManagedUser,
  fetchAdminMe,
  fetchClasses,
  fetchManagedAdmins,
  fetchManagedUsers,
  resetManagedAdminPassword,
  resetManagedUserPassword,
  transferUserClass,
  updateClass,
  updateClassStatus,
  updateManagedAdmin,
  updateManagedAdminStatus,
  updateManagedUser,
  updateManagedUserStatus
} from '../../../lib/api.js';
import styles from './page.module.css';

function initial(name) {
  return String(name || '账').slice(0, 1);
}

function statusClass(status, isActive = true) {
  return status === 'disabled' || isActive === false ? 'off' : 'ok';
}

function statusText(status, isActive = true) {
  return status === 'disabled' || isActive === false ? '停用' : '正常';
}

const UNASSIGNED_CLASS_ID = 'unassigned';

function makePassword() {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz';
  let value = '';
  for (let index = 0; index < 8; index += 1) value += chars[Math.floor(Math.random() * chars.length)];
  return value;
}

const roleOptions = [
  { value: 'super_admin', label: '教导主任' },
  { value: 'teacher', label: '老师' },
  { value: 'student', label: '学员' }
];

export default function ClassesPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [studentKeyword, setStudentKeyword] = useState('');
  const [toast, setToast] = useState('正在加载班级管理...');
  const [createAccount, setCreateAccount] = useState(null);
  const [classForm, setClassForm] = useState(null);
  const [classAssign, setClassAssign] = useState(null);
  const [editAccount, setEditAccount] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(''), 2600);
  }

  function getUrlParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }

  function parseClassParam(classList) {
    const value = getUrlParams().get('class');
    if (value === UNASSIGNED_CLASS_ID) return UNASSIGNED_CLASS_ID;
    const numeric = Number(value);
    return classList.some((item) => item.id === numeric) ? numeric : null;
  }

  function selectClass(classId, { replace = false } = {}) {
    setSelectedClassId(classId);
    const params = getUrlParams();
    params.set('class', String(classId));
    const nextUrl = `/admin/classes?${params.toString()}`;
    if (replace) {
      router.replace(nextUrl, { scroll: false });
    } else {
      router.push(nextUrl, { scroll: false });
    }
  }

  async function copyText(value, successText) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(successText);
    } catch (error) {
      showToast(`请手动复制：${value}`);
    }
  }

  async function reload() {
    const [classesResult, adminsResult, usersResult] = await Promise.all([fetchClasses(), fetchManagedAdmins(), fetchManagedUsers()]);
    const classList = classesResult.data || [];
    setClasses(classList);
    setAdmins(adminsResult.data || []);
    setUsers(usersResult.data || []);
    setSelectedClassId((current) => {
      const urlClassId = parseClassParam(classList);
      if (urlClassId) return urlClassId;
      return classList.some((item) => item.id === current) || current === UNASSIGNED_CLASS_ID
        ? current
        : classList[0]?.id || UNASSIGNED_CLASS_ID;
    });
    return classList;
  }

  useEffect(() => {
    async function init() {
      try {
        const me = await fetchAdminMe();
        if (me.data.role !== 'super_admin') {
          router.replace('/admin/users');
          return;
        }
        setAdmin(me.data);
        await reload();
        setToast('');
      } catch (error) {
        router.replace('/admin/login');
      }
    }
    init();
  }, [router]);

  useEffect(() => {
    if (!selectedClassId) return;
    const params = getUrlParams();
    const current = params.get('class');
    if (String(current || '') === String(selectedClassId)) return;
    params.set('class', String(selectedClassId));
    router.replace(`/admin/classes?${params.toString()}`, { scroll: false });
  }, [router, selectedClassId]);

  useEffect(() => {
    function closeByEscape(event) {
      if (event.key !== 'Escape') return;
      setCreateAccount(null);
      setClassForm(null);
      setClassAssign(null);
      setEditAccount(null);
      setConfirmAction(null);
    }
    document.addEventListener('keydown', closeByEscape);
    return () => document.removeEventListener('keydown', closeByEscape);
  }, []);

  const deans = useMemo(() => admins.filter((item) => item.role === 'super_admin'), [admins]);
  const teachers = useMemo(() => admins.filter((item) => item.role === 'teacher'), [admins]);
  const activeClasses = useMemo(() => classes.filter((item) => item.is_active !== false), [classes]);
  const selectedClass = classes.find((item) => item.id === selectedClassId) || null;
  const selectedClassForCreate = selectedClass?.is_active === false ? null : selectedClass;
  const unassignedClass = useMemo(() => ({ id: UNASSIGNED_CLASS_ID, name: '未分班学员', is_system: true, is_active: true, students: users.filter((user) => user.class_id == null) }), [users]);
  const selectedDisplayClass = selectedClass || (selectedClassId === UNASSIGNED_CLASS_ID ? unassignedClass : null);
  const classRows = useMemo(() => [
    ...[...classes].sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false)),
    unassignedClass
  ], [classes, unassignedClass]);
  const selectedStudents = selectedDisplayClass?.students || [];
  const classCountLabel = classes.length ? `${classes.length} 个班级` : '暂无班级';

  const filteredStudents = useMemo(() => filterAccounts(selectedStudents, studentKeyword).sort((a, b) => Number(b.is_active) - Number(a.is_active)), [selectedStudents, studentKeyword]);
  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);
  const canManageDeans = admin?.username === 'admin' || admin?.account === 'admin';

  function openCreateAccount(role = 'student') {
    setCreateAccount({ role, username: '', nickname: '', classId: selectedClassForCreate?.id || activeClasses[0]?.id || '', password: makePassword() });
  }

  async function submitCreateAccount() {
    if (!createAccount) return;
    const username = createAccount.username.trim();
    const nickname = createAccount.nickname.trim();
    if (!/^\d+$/.test(username)) {
      showToast('账号只能填写数字');
      return;
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{1,10}$/.test(nickname)) {
      showToast('昵称需为 1-10 位中文、字母、数字或下划线');
      return;
    }
    if (createAccount.password.length < 5 || createAccount.password.length > 30) {
      showToast('密码长度必须是 5 到 30 个字符');
      return;
    }
    try {
      if (createAccount.role === 'super_admin' && !canManageDeans) {
        showToast('只有超级管理员可以新建教导主任');
        return;
      }
      if (createAccount.role === 'student') {
        if (!createAccount.classId) {
          showToast('请选择初始班级');
          return;
        }
        await createManagedUser({ username, nickname, password: createAccount.password, classId: Number(createAccount.classId) });
      } else {
        await createManagedAdmin({ username, nickname, password: createAccount.password, role: createAccount.role });
      }
      setCreateAccount(null);
      await reload();
      showToast(`已创建${roleOptions.find((item) => item.value === createAccount.role)?.label || '账号'}「${nickname}」`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function openCreateClass() {
    setClassForm({ id: null, name: '', teacherId: '' });
  }

  function openEditClass(cls) {
    setClassForm({ id: cls.id, name: cls.name, teacherId: cls.teacher_id || '' });
  }

  async function submitCreateClass() {
    if (!classForm) return;
    const name = classForm.name.trim();
    if (!name) {
      showToast('请填写班级名称');
      return;
    }
    try {
      const result = classForm.id
        ? await updateClass({ id: classForm.id, name, teacherId: classForm.teacherId ? Number(classForm.teacherId) : null })
        : await createClass({ name, teacherId: classForm.teacherId ? Number(classForm.teacherId) : null });
      await reload();
      selectClass(result.data?.id || classForm.id || UNASSIGNED_CLASS_ID, { replace: true });
      setClassForm(null);
      showToast(classForm.id ? '班级已保存' : '班级已创建');
    } catch (error) {
      showToast(error.message);
    }
  }

  function openAssignClasses(item) {
    const picked = item.role === 'teacher'
      ? classes.filter((cls) => cls.teacher_id === item.id).map((cls) => cls.id)
      : [item.class_id || selectedDisplayClass?.id || UNASSIGNED_CLASS_ID];
    setClassAssign({ item, role: item.role === 'teacher' ? 'teacher' : 'student', picked });
  }

  async function submitAssignClasses() {
    if (!classAssign) return;
    const picked = classAssign.picked.filter((value) => value === UNASSIGNED_CLASS_ID || Number(value) > 0);
    if (classAssign.role === 'student' && picked.length === 0) {
      showToast('请选择目标班级');
      return;
    }
    try {
      if (classAssign.role === 'student') {
        const targetClassId = picked[0] === UNASSIGNED_CLASS_ID ? null : Number(picked[0]);
        await transferUserClass({ id: classAssign.item.id, classId: targetClassId });
        showToast('学员已转班');
      } else {
        const currentIds = classes.filter((cls) => cls.teacher_id === classAssign.item.id).map((cls) => cls.id);
        const toDetach = currentIds.filter((classId) => !picked.includes(classId));
        await Promise.all([
          ...picked.map((classId) => {
            const cls = classes.find((item) => item.id === classId);
            return updateClass({ id: classId, name: cls?.name, teacherId: classAssign.item.id });
          }),
          ...toDetach.map((classId) => {
            const cls = classes.find((item) => item.id === classId);
            return updateClass({ id: classId, name: cls?.name, teacherId: null });
          })
        ]);
        showToast('老师带班已保存');
      }
      setClassAssign(null);
      await reload();
    } catch (error) {
      showToast(error.message);
    }
  }

  function openEditAccount(target, type) {
    if (type === 'admin' && target.role === 'super_admin' && !canManageDeans) {
      showToast('只有超级管理员可以操作教导主任账号');
      return;
    }
    const owned = type === 'admin' && target.role === 'teacher'
      ? classes.filter((cls) => cls.teacher_id === target.id)
      : [];
    setEditAccount({
      target,
      type,
      nickname: target.nickname || '',
      classId: type === 'user' ? (target.class_id || UNASSIGNED_CLASS_ID) : '',
      resetPassword: false,
      password: makePassword(),
      ownedClasses: owned
    });
  }

  async function submitEditAccount() {
    if (!editAccount) return;
    const nickname = editAccount.nickname.trim();
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{1,10}$/.test(nickname)) {
      showToast('昵称需为 1-10 位中文、字母、数字或下划线');
      return;
    }
    if (editAccount.resetPassword && (editAccount.password.length < 5 || editAccount.password.length > 30)) {
      showToast('密码长度必须是 5 到 30 个字符');
      return;
    }
    try {
      if (editAccount.type === 'admin') {
        if (editAccount.target.role === 'super_admin' && !canManageDeans) {
          showToast('只有超级管理员可以编辑教导主任');
          return;
        }
        await updateManagedAdmin({ id: editAccount.target.id, nickname });
        if (editAccount.resetPassword) await resetManagedAdminPassword({ id: editAccount.target.id, password: editAccount.password });
      } else {
        await updateManagedUser({ id: editAccount.target.id, nickname });
        const targetClassId = editAccount.classId === UNASSIGNED_CLASS_ID ? null : Number(editAccount.classId);
        if ((editAccount.target.class_id || null) !== targetClassId) {
          await transferUserClass({ id: editAccount.target.id, classId: targetClassId });
        }
        if (editAccount.resetPassword) await resetManagedUserPassword({ id: editAccount.target.id, password: editAccount.password });
      }
      setEditAccount(null);
      await reload();
      showToast('账号资料已保存');
    } catch (error) {
      showToast(error.message);
    }
  }

  function askConfirm(config) {
    setConfirmAction(config);
  }

  async function runConfirm() {
    if (!confirmAction) return;
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
      await reload();
      showToast(confirmAction.successText);
    } catch (error) {
      showToast(error.message);
    }
  }

  if (!admin) return <p className="empty-text">正在加载班级管理...</p>;

  const accountName = admin.nickname || admin.username;

  return (
    <>
      <AppNav role="super_admin" accountName={accountName} homeHref="/tracks" actions={<span className="role-tag">教导主任 · {accountName}</span>} />
      <main className={`${styles.page} home class-manage`}>
        <div className="grid4 rise d1">
          <AccountZone title="教导主任" meta={`共 ${deans.length} 人`} action={canManageDeans ? <button type="button" className="zbtn mini" onClick={() => openCreateAccount('super_admin')}>＋ 新建教导主任</button> : <span className="meta readonly">仅超级管理员可操作</span>}>
            {deans.map((item) => <AdminRow key={item.id} item={item} currentAdminId={admin.id} readonly={!canManageDeans} onEdit={(target) => openEditAccount(target, 'admin')} onToggle={(target) => askConfirm({ title: target.status === 'disabled' ? '恢 复 账 号' : '停 用 账 号', text: `确定${target.status === 'disabled' ? '恢复' : '停用'}账号「${target.nickname || target.username}」吗？`, successText: '账号状态已更新', onConfirm: () => updateManagedAdminStatus({ id: target.id, status: target.status === 'disabled' ? 'active' : 'disabled' }) })} onDelete={(target) => askConfirm({ title: '删 除 账 号', text: `确定删除账号「${target.nickname || target.username}」吗？`, successText: '账号已删除', onConfirm: () => deleteManagedAdmin(target.id) })} />)}
            {deans.length === 0 ? <div className="list-empty">暂无教导主任账号</div> : null}
          </AccountZone>

          <AccountZone title="老师" meta={`共 ${teachers.length} 人`} action={<button type="button" className="zbtn mini" onClick={() => openCreateAccount('teacher')}>＋ 新建老师</button>}>
            {teachers.map((item) => (
              <AdminRow key={item.id} item={item} onEdit={(target) => openEditAccount(target, 'admin')} onToggle={(target) => askConfirm({ title: target.status === 'disabled' ? '恢 复 账 号' : '停 用 账 号', text: `确定${target.status === 'disabled' ? '恢复' : '停用'}老师「${target.nickname || target.username}」吗？`, successText: '账号状态已更新', onConfirm: () => updateManagedAdminStatus({ id: target.id, status: target.status === 'disabled' ? 'active' : 'disabled' }) })} onDelete={(target) => askConfirm({ title: '删 除 账 号', text: `确定删除老师「${target.nickname || target.username}」吗？`, successText: '账号已删除', onConfirm: () => deleteManagedAdmin(target.id) })} />
            ))}
            {teachers.length === 0 ? <div className="list-empty">暂无老师账号</div> : null}
          </AccountZone>

          <section className="zone wide">
            <div className="zone-head">
              <h2>班级 / 学员</h2>
              <div className="zone-ops">
                <button type="button" className="zbtn mini" onClick={openCreateClass}>＋ 新建班级</button>
                <button type="button" className="zbtn mini" onClick={() => openCreateAccount('student')}>＋ 新建学员</button>
              </div>
            </div>
            <div className="split">
              <div className="split-l">
                <div className="sub-head"><span>班级</span><span className="meta num">{classCountLabel}</span></div>
                <div className="rows scroll">
                  {classRows.map((cls) => {
                    const teacher = teacherById.get(cls.teacher_id);
                    const isSystemClass = cls.id === UNASSIGNED_CLASS_ID;
                    const isActive = cls.is_active !== false;
                    return (
                      <div className={`cls-row${selectedDisplayClass?.id === cls.id ? ' on' : ''}${!isActive ? ' off' : ''}`} key={cls.id} role="button" tabIndex={0} onClick={() => selectClass(cls.id)} onKeyDown={(event) => { if (event.key === 'Enter') selectClass(cls.id); }}>
                        <span className="nm">{cls.name}</span>
                        {!isActive ? <span className="st-chip off">停用</span> : null}
                        <span className="cnt">{isSystemClass ? '待分配' : (teacher?.nickname || cls.teacher_name || '未分配')} · {cls.students?.length || 0} 人</span>
                        {!isSystemClass ? <span className="row-ops" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="rbtn" onClick={() => openEditClass(cls)}>编辑</button>
                          <button type="button" className="rbtn acc" onClick={() => askConfirm({ title: isActive ? '停 用 班 级' : '恢 复 班 级', text: `确定${isActive ? '停用' : '恢复'}班级「${cls.name}」吗？${isActive ? '停用后不能作为新学员和转班目标。' : '恢复后可重新作为目标班级。'}`, successText: `班级已${isActive ? '停用' : '恢复'}`, onConfirm: () => updateClassStatus({ id: cls.id, isActive: !isActive }) })}>{isActive ? '停用' : '恢复'}</button>
                          <button type="button" className="rbtn danger" onClick={() => askConfirm({ title: '删 除 班 级', text: `确定删除班级「${cls.name}」吗？只有空班级可以删除；如仍有学员，请先转移到其他班级或未分班学员。`, successText: '班级已删除', onConfirm: () => deleteClass(cls.id) })}>删除</button>
                        </span> : null}
                      </div>
                    );
                  })}
                  {classRows.length === 1 ? <div className="list-empty">暂无班级，请先创建班级</div> : null}
                </div>
              </div>
              <div className="split-r">
                <div className="sub-head"><span>学员</span><span className="meta">{selectedDisplayClass ? `${selectedDisplayClass.name} · ${selectedStudents.length} 人` : '未选择班级'}</span></div>
                <label className="list-search minisearch wide">
                  <SearchIcon />
                  <input value={studentKeyword} onChange={(event) => setStudentKeyword(event.target.value)} placeholder="搜索本班学员…" aria-label="搜索本班学员" />
                </label>
                <div className="rows scroll">
                  {filteredStudents.map((user) => <StudentRow key={user.id} user={user} onEdit={(target) => openEditAccount({ ...target, role: 'student', class_id: selectedDisplayClass?.id === UNASSIGNED_CLASS_ID ? null : selectedDisplayClass?.id }, 'user')} onToggle={(target) => askConfirm({ title: target.is_active ? '停 用 学 员' : '恢 复 学 员', text: `确定${target.is_active ? '停用' : '恢复'}学员「${target.nickname || target.username}」吗？`, successText: '学员状态已更新', onConfirm: () => updateManagedUserStatus({ id: target.id, isActive: !target.is_active }) })} onDelete={(target) => askConfirm({ title: '删 除 学 员', text: `确定删除学员「${target.nickname || target.username}」吗？`, successText: '学员已删除', onConfirm: () => deleteManagedUser(target.id) })} onTransfer={(target) => openAssignClasses({ ...target, role: 'student', class_id: selectedDisplayClass?.id === UNASSIGNED_CLASS_ID ? null : selectedDisplayClass?.id })} />)}
                  {filteredStudents.length === 0 ? <div className="list-empty">{studentKeyword.trim() ? '未找到相关学员' : '该班级暂无学员'}</div> : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <CreateAccountModal data={createAccount} classes={classes} onChange={setCreateAccount} onClose={() => setCreateAccount(null)} onSubmit={submitCreateAccount} onCopy={copyText} scopeClass={styles.page} />
      <ClassFormModal data={classForm} teachers={teachers} onChange={setClassForm} onClose={() => setClassForm(null)} onSubmit={submitCreateClass} scopeClass={styles.page} />
      <AssignClassModal data={classAssign} classes={classes} onChange={setClassAssign} onClose={() => setClassAssign(null)} onSubmit={submitAssignClasses} scopeClass={styles.page} />
      <EditAccountModal data={editAccount} classes={classes} onChange={setEditAccount} onClose={() => setEditAccount(null)} onSubmit={submitEditAccount} onCopy={copyText} scopeClass={styles.page} />
      <ConfirmModal data={confirmAction} onClose={() => setConfirmAction(null)} onSubmit={runConfirm} scopeClass={styles.page} />
      <div className={`${styles.page} dean-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}

function filterAccounts(items, keyword) {
  const value = keyword.trim().toLowerCase();
  if (!value) return items;
  return items.filter((item) => `${item.username || ''} ${item.nickname || ''}`.toLowerCase().includes(value));
}

function AccountZone({ title, meta, action, children }) {
  return (
    <section className="zone">
      <div className="zone-head">
        <h2>{title}</h2>
        <span className="meta num">{meta}</span>
        <div className="zone-ops">{action}</div>
      </div>
      <div className="rows scroll">{children}</div>
    </section>
  );
}

function AdminRow({ item, currentAdminId, readonly = false, onToggle, onDelete, onEdit }) {
  const displayName = item.nickname || item.username;
  const disabled = item.status === 'disabled';
  const protectedSelf = currentAdminId === item.id;
  const operationsDisabled = readonly || protectedSelf;
  return (
    <div className={`row${disabled ? ' off' : ''}`}>
      <div className="r-top">
        <span className="ava">{initial(displayName)}</span>
        <span className="txt"><span className="nm">{displayName}</span><span className="acct num">{item.account || item.username}</span></span>
        <span className={`st-chip ${statusClass(item.status)}`}>{statusText(item.status)}</span>
      </div>
      <div className="r-bot">
        <div className="cls-chips"><span className="cls-mini none">{item.role === 'teacher' ? '老师账号' : '权限：内容与账号管理'}</span></div>
        {readonly ? <span className="cls-mini none">只读</span> : (
          <div className="row-ops">
            <button type="button" className="rbtn" disabled={operationsDisabled} onClick={() => onEdit(item)}>编辑</button>
            <button type="button" className="rbtn acc" disabled={operationsDisabled} onClick={() => onToggle(item)}>{disabled ? '恢复' : '停用'}</button>
            <button type="button" className="rbtn danger" disabled={operationsDisabled} onClick={() => onDelete(item)}>删除</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StudentRow({ user, onToggle, onDelete, onTransfer, onEdit }) {
  const displayName = user.nickname || user.username;
  return (
    <div className={`row${user.is_active ? '' : ' off'}`}>
      <div className="r-top">
        <span className="ava">{initial(displayName)}</span>
        <span className="txt"><span className="nm">{displayName}</span><span className="acct num">{user.username}</span></span>
        <span className={`st-chip ${statusClass(user.status, user.is_active)}`}>{statusText(user.status, user.is_active)}</span>
      </div>
      <div className="r-bot">
        <div className="cls-chips"><span className="cls-mini">学员账号</span></div>
        <div className="row-ops">
          <button type="button" className="rbtn" onClick={() => onEdit(user)}>编辑</button>
          <button type="button" className="rbtn" onClick={() => onTransfer(user)}>转班</button>
          <button type="button" className="rbtn acc" onClick={() => onToggle(user)}>{user.is_active ? '停用' : '恢复'}</button>
          <button type="button" className="rbtn danger" onClick={() => onDelete(user)}>删除</button>
        </div>
      </div>
    </div>
  );
}

function Modal({ show, wide = false, title, children, onClose, scopeClass }) {
  return (
    <div className={`${scopeClass} modal-mask${show ? ' show' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function CreateAccountModal({ data, classes, onChange, onClose, onSubmit, onCopy, scopeClass }) {
  if (!data) return null;
  const selectedRole = roleOptions.find((item) => item.value === data.role);
  return (
    <Modal show scopeClass={scopeClass} title="新 建 账 号" onClose={onClose}>
      <div className="f-row">
        <label>角色</label>
        <input type="text" value={selectedRole?.label || '账号'} readOnly />
        <div className="f-tip">角色由新建入口决定，不能在弹层内切换。</div>
      </div>
      <div className="f-row">
        <label>账号（纯数字）</label>
        <input type="text" value={data.username} onChange={(event) => onChange({ ...data, username: event.target.value })} placeholder="如 13800001234 · 全局唯一" />
      </div>
      <div className="f-row">
        <label>昵称</label>
        <input type="text" value={data.nickname} onChange={(event) => onChange({ ...data, nickname: event.target.value })} placeholder="1-10 位中文、字母、数字或下划线" maxLength={10} />
      </div>
      {data.role === 'student' ? (
        <div className="f-row">
          <label>初始班级</label>
          <select value={data.classId} onChange={(event) => onChange({ ...data, classId: event.target.value })} aria-label="选择初始班级">
            <option value="">请选择班级</option>
            {classes.filter((cls) => cls.is_active !== false).map((cls) => <option value={cls.id} key={cls.id}>{cls.name}</option>)}
          </select>
          <div className="f-tip">学员只能属于一个班级，可创建后再调整。</div>
        </div>
      ) : null}
      <div className="f-row">
        <label>初始密码</label>
        <div className="pwd-row">
          <input type="text" value={data.password} onChange={(event) => onChange({ ...data, password: event.target.value })} />
          <button type="button" className="mbtn" onClick={() => onChange({ ...data, password: makePassword() })}>随机生成</button>
          <button type="button" className="mbtn" onClick={() => onCopy(data.password, '初始密码已复制')}>复制</button>
        </div>
        <div className="f-tip">可手动输入 5-30 位密码，也可随机生成；请线下告知本人。</div>
      </div>
      <div className="modal-ops">
        <button type="button" className="mbtn" onClick={onClose}>取 消</button>
        <button type="button" className="mbtn primary" onClick={onSubmit}>创建{selectedRole?.label || '账号'}</button>
      </div>
    </Modal>
  );
}

function ClassFormModal({ data, teachers, onChange, onClose, onSubmit, scopeClass }) {
  if (!data) return null;
  const editing = Boolean(data.id);
  return (
    <Modal show scopeClass={scopeClass} title={editing ? '编 辑 班 级' : '新 建 班 级'} onClose={onClose}>
      <div className="f-row">
        <label>班级名称</label>
        <input type="text" value={data.name} onChange={(event) => onChange({ ...data, name: event.target.value })} placeholder="如 进阶二班" maxLength={12} />
      </div>
      <div className="f-row">
        <label>负责老师</label>
        <select value={data.teacherId || ''} onChange={(event) => onChange({ ...data, teacherId: event.target.value })} aria-label="选择负责老师">
          <option value="">暂不分配</option>
          {teachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.nickname || teacher.username}</option>)}
        </select>
      </div>
      <div className="f-tip">负责老师可稍后在班级编辑中分配或取消。</div>
      <div className="modal-ops">
        <button type="button" className="mbtn" onClick={onClose}>取 消</button>
        <button type="button" className="mbtn primary" onClick={onSubmit}>{editing ? '保 存' : '新 建 班 级'}</button>
      </div>
    </Modal>
  );
}

function AssignClassModal({ data, classes, onChange, onClose, onSubmit, scopeClass }) {
  if (!data) return null;
  const displayName = data.item.nickname || data.item.username;
  const options = data.role === 'teacher' ? classes : [{ id: UNASSIGNED_CLASS_ID, name: '未分班学员', is_system: true }, ...classes.filter((cls) => cls.is_active !== false)];
  return (
    <Modal show scopeClass={scopeClass} title={data.role === 'teacher' ? '设 置 班 级' : '分 班 / 转 班'} onClose={onClose}>
      <p>为「<b className="hl">{displayName}</b>」{data.role === 'teacher' ? '设置所带班级：' : '选择目标班级：'}</p>
      <div className="cls-check">
        {options.map((cls) => {
          const checked = data.picked.includes(cls.id);
          return (
            <label key={cls.id}>
              <input type={data.role === 'teacher' ? 'checkbox' : 'radio'} name="assignClass" checked={checked} onChange={(event) => {
                if (data.role === 'teacher') {
                  onChange({ ...data, picked: event.target.checked ? [...data.picked, cls.id] : data.picked.filter((id) => id !== cls.id) });
                  return;
                }
                onChange({ ...data, picked: [cls.id] });
              }} />
              <span className="cbx">✓</span>
              {cls.name}
              <span className="mini-cls">{cls.students?.length || 0} 人</span>
            </label>
          );
        })}
        {options.length === 0 ? <div className="list-empty">暂无可选班级</div> : null}
      </div>
      <div className="f-note">学员只能属于一个班级；老师可同时勾选多个班级。</div>
      <div className="modal-ops">
        <button type="button" className="mbtn" onClick={onClose}>取 消</button>
        <button type="button" className="mbtn primary" onClick={onSubmit}>保 存</button>
      </div>
    </Modal>
  );
}

function EditAccountModal({ data, classes, onChange, onClose, onSubmit, onCopy, scopeClass }) {
  if (!data) return null;
  const target = data.target;
  const displayName = target.nickname || target.username;
  const activeClasses = classes.filter((cls) => cls.is_active !== false || cls.id === target.class_id);
  return (
    <Modal show scopeClass={scopeClass} title="编 辑 资 料" onClose={onClose}>
      <div className="f-row">
        <label>账号</label>
        <input type="text" value={target.account || target.username} readOnly />
        <div className="f-tip">账号不可修改。</div>
      </div>
      <div className="f-row">
        <label>昵称</label>
        <input type="text" value={data.nickname} onChange={(event) => onChange({ ...data, nickname: event.target.value })} placeholder="1-10 位中文、字母、数字或下划线" maxLength={10} />
      </div>
      {data.type === 'admin' && target.role === 'teacher' ? (
        <div className="f-row">
          <label>所带班级</label>
          <div className="chip-wrap">
            {data.ownedClasses.length ? data.ownedClasses.map((cls) => <span className="cls-chip" key={cls.id}>{cls.name}</span>) : <span className="cls-mini none">未带班</span>}
          </div>
          <div className="f-tip">班级归属请在「班级」列表中编辑对应班级；一个班级只能有一位负责老师。</div>
        </div>
      ) : null}
      {data.type === 'user' ? (
        <div className="f-row">
          <label>所属班级</label>
          <select value={data.classId} onChange={(event) => onChange({ ...data, classId: event.target.value })} aria-label="选择所属班级">
            <option value={UNASSIGNED_CLASS_ID}>未分班学员</option>
            {activeClasses.map((cls) => <option value={cls.id} key={cls.id}>{cls.name}</option>)}
          </select>
          <div className="f-tip">学员只能属于一个班级，也可转入未分班学员。</div>
        </div>
      ) : null}
      <div className="f-row">
        <label>密码</label>
        {!data.resetPassword ? (
          <div className="pwd-row"><input type="text" value="已设置 · 不保存明文" readOnly /><button type="button" className="mbtn" onClick={() => onChange({ ...data, resetPassword: true, password: makePassword() })}>重置密码</button></div>
        ) : (
          <div className="pwd-row">
            <input type="text" value={data.password} onChange={(event) => onChange({ ...data, password: event.target.value })} />
            <button type="button" className="mbtn" onClick={() => onChange({ ...data, password: makePassword() })}>随机生成</button>
            <button type="button" className="mbtn" onClick={() => onCopy(data.password, '新密码已复制')}>复制</button>
          </div>
        )}
        <div className="f-tip">密码不会显示明文；如需更换，请重置后线下告知本人。</div>
      </div>
      <div className="modal-ops">
        <button type="button" className="mbtn" onClick={onClose}>取 消</button>
        <button type="button" className="mbtn primary" onClick={onSubmit}>保 存</button>
      </div>
    </Modal>
  );
}

function ConfirmModal({ data, onClose, onSubmit, scopeClass }) {
  if (!data) return null;
  return (
    <Modal show scopeClass={scopeClass} title={data.title || '确 认'} onClose={onClose}>
      <p>{data.text}</p>
      <div className="modal-ops">
        <button type="button" className="mbtn" onClick={onClose}>取 消</button>
        <button type="button" className="mbtn danger" onClick={onSubmit}>确 认</button>
      </div>
    </Modal>
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
