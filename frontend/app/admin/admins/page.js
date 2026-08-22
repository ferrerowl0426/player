'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createManagedAdmin,
  deleteManagedAdmin,
  fetchAdminMe,
  fetchManagedAdmins,
  resetManagedAdminPassword
} from '../../../lib/api.js';

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('zh-CN');
}

function readAccountForm(form) {
  const formData = new FormData(form);

  return {
    username: String(formData.get('username') || '').trim(),
    password: String(formData.get('password') || ''),
    role: String(formData.get('role') || 'teacher')
  };
}

export default function AdminAdminsPage() {
  const router = useRouter();
  const [admins, setAdmins] = useState([]);
  const [status, setStatus] = useState('正在检查管理员登录状态...');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadAdmins() {
    const result = await fetchManagedAdmins();
    setAdmins(result.data);
    setStatus(result.data.length === 0 ? '还没有管理员。' : '');
  }

  useEffect(() => {
    async function initPage() {
      try {
        const me = await fetchAdminMe();

        if (me.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }

        await loadAdmins();
      } catch (error) {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router]);

  async function handleCreateAdmin(event) {
    event.preventDefault();

    const account = readAccountForm(event.currentTarget);

    if (!account.username || !account.password) {
      setStatus('请填写管理员账号和密码');
      return;
    }

    setIsSubmitting(true);
    setStatus('正在创建管理员...');

    try {
      await createManagedAdmin(account);
      event.currentTarget.reset();
      await loadAdmins();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(admin) {
    const password = window.prompt(`请输入 ${admin.username} 的新密码`);

    if (password === null) {
      return;
    }

    try {
      await resetManagedAdminPassword({ id: admin.id, password });
      setStatus(`已重置 ${admin.username} 的密码。`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function handleDeleteAdmin(admin) {
    const confirmed = window.confirm(`确定删除管理员 ${admin.username} 吗？系统至少会保留一个管理员。`);

    if (!confirmed) {
      return;
    }

    try {
      await deleteManagedAdmin(admin.id);
      await loadAdmins();
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>管理员账号管理</h1>
          <p>超级管理员可以创建老师或超级管理员账号，也可以重置密码；系统会阻止删除最后一个管理员。</p>
        </div>
        <a className="hero-button" href="/admin">返回后台</a>
      </section>

      <section className="upload-panel">
        <h2>创建管理员</h2>
        <form className="upload-form" onSubmit={handleCreateAdmin}>
          <label>
            <span>账号</span>
            <input name="username" type="text" placeholder="例如 teacher_01" minLength="3" maxLength="50" required />
            <small>账号只能包含英文、数字和下划线，长度 3 到 50。</small>
          </label>

          <label>
            <span>初始密码</span>
            <input name="password" type="password" placeholder="至少 6 位" minLength="6" maxLength="72" required />
            <small>数据库只保存 bcrypt 哈希，不保存明文密码。</small>
          </label>

          <label>
            <span>角色</span>
            <select name="role" required>
              <option value="teacher">老师</option>
              <option value="super_admin">超级管理员</option>
            </select>
            <small>老师只能管理自己班级；超级管理员可以管理所有班级和视频删除。</small>
          </label>

          <button type="submit" disabled={isSubmitting}>{isSubmitting ? '创建中...' : '创建管理员'}</button>
        </form>
      </section>

      <section className="video-section">
        <div className="section-title">
          <h2>管理员列表</h2>
          <button type="button" onClick={loadAdmins}>刷新</button>
        </div>

        <div className="admin-table">
          {admins.map((admin) => (
            <article className="admin-row" key={admin.id}>
              <div>
                <strong>{admin.username}</strong>
                <span>{admin.role === 'super_admin' ? '超级管理员' : '老师'} · 创建于 {formatDate(admin.created_at)}</span>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => handleResetPassword(admin)}>重置密码</button>
                <button type="button" onClick={() => handleDeleteAdmin(admin)}>删除</button>
              </div>
            </article>
          ))}
        </div>

        <p className={status.includes('失败') || status.includes('错误') ? 'error-text' : 'status-text'}>{status}</p>
      </section>
    </>
  );
}
