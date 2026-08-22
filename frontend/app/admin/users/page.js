'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createManagedUser,
  fetchAdminMe,
  fetchClasses,
  fetchManagedUsers,
  resetManagedUserPassword,
  updateManagedUserStatus
} from '../../../lib/api.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

function readAccountForm(form) {
  const formData = new FormData(form);

  return {
    username: String(formData.get('username') || '').trim(),
    password: String(formData.get('password') || ''),
    classId: String(formData.get('classId') || '')
  };
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [status, setStatus] = useState('正在检查管理员登录状态...');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadUsers() {
    const result = await fetchManagedUsers();
    setUsers(result.data);
    setStatus(result.data.length === 0 ? '还没有普通用户。' : '');
  }

  useEffect(() => {
    async function initPage() {
      try {
        const me = await fetchAdminMe();
        setAdmin(me.data);
        await loadUsers();

        if (me.data.role === 'super_admin') {
          const classesResult = await fetchClasses();
          setClasses(classesResult.data);
        }
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router]);

  async function handleCreateUser(event) {
    event.preventDefault();

    const account = readAccountForm(event.currentTarget);

    if (!account.username || !account.password) {
      setStatus('请填写普通用户账号和密码');
      return;
    }

    setIsSubmitting(true);
    setStatus('正在创建普通用户...');

    try {
      const result = await createManagedUser(account);
      event.currentTarget.reset();
      setUsers((current) => [result.data, ...current.filter((item) => item.id !== result.data.id)]);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(user) {
    const password = window.prompt(`请输入 ${user.username} 的新密码`);

    if (password === null) {
      return;
    }

    try {
      await resetManagedUserPassword({ id: user.id, password });
      setStatus(`已重置 ${user.username} 的密码，请线下告知用户。`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleToggleStatus(user) {
    try {
      await updateManagedUserStatus({ id: user.id, isActive: !user.is_active });
      await loadUsers();
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!admin) {
    return <p className="empty-text">正在检查管理员登录状态...</p>;
  }

  const isSuperAdmin = admin.role === 'super_admin';

  return (
    <>
      <section className="hero">
        <div>
          <h1>{isSuperAdmin ? '用户管理' : '班级学生'}</h1>
          <p>
            {isSuperAdmin
              ? '超级管理员可以创建学生并分配到任意班级。'
              : '老师只能查看和管理自己班级的学生。'}
          </p>
        </div>
        <a className="hero-button" href="/admin">返回后台</a>
      </section>

      <section className="upload-panel">
        <h2>创建普通用户</h2>
        <form className="upload-form" onSubmit={handleCreateUser}>
          <label>
            <span>账号</span>
            <input name="username" type="text" placeholder="例如 student_01" minLength="3" maxLength="50" required />
            <small>账号只能包含英文、数字和下划线，长度 3 到 50。</small>
          </label>

          <label>
            <span>初始密码</span>
            <input name="password" type="password" placeholder="至少 6 位" minLength="6" maxLength="72" required />
            <small>密码只在创建或重置时填写，数据库保存的是 bcrypt 哈希。</small>
          </label>

          {isSuperAdmin && (
            <label>
              <span>所属班级</span>
              <select name="classId" required>
                <option value="">选择班级</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
              <small>超级管理员创建学生时必须选择班级。</small>
            </label>
          )}

          <button type="submit" disabled={isSubmitting}>{isSubmitting ? '创建中...' : '创建用户'}</button>
        </form>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>{isSuperAdmin ? '普通用户列表' : '班级学生列表'}</h2>
          <button type="button" onClick={loadUsers}>刷新</button>
        </div>

        <div className="admin-table">
          {users.map((user) => (
            <article className="admin-row" key={user.id}>
              <div>
                <strong>{user.username}</strong>
                <span>{user.is_active ? '已启用' : '已禁用'} · 创建于 {formatDate(user.created_at)}</span>
              </div>
              <div className="row-actions">
                <a href={`/admin/users/${user.id}/assignments`}>推送/留言</a>
                <button type="button" onClick={() => handleResetPassword(user)}>重置密码</button>
                <button type="button" onClick={() => handleToggleStatus(user)}>{user.is_active ? '禁用' : '启用'}</button>
              </div>
            </article>
          ))}
        </div>

        <p className={status.includes('失败') || status.includes('错误') ? 'error-text' : 'status-text'}>{status}</p>
      </section>
    </>
  );
}
