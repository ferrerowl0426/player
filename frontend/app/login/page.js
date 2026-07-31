'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginUser } from '../../lib/api.js';

export default function UserLoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');

    if (!username || !password) {
      setStatus('请填写用户账号和密码');
      return;
    }

    setIsSubmitting(true);
    setStatus('正在登录...');

    try {
      await loginUser({ username, password });
      router.replace('/');
      router.refresh();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="login-panel">
      <h1>用户登录</h1>
      <p>普通用户登录后可以浏览视频列表，并查看管理员单独推送的今日作业。</p>

      <form className="upload-form" onSubmit={handleLogin}>
        <label>
          <span>账号</span>
          <input name="username" type="text" autoComplete="username" placeholder="demo" required />
        </label>

        <label>
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" placeholder="123456" required />
        </label>

        <button type="submit" disabled={isSubmitting}>{isSubmitting ? '登录中...' : '登录'}</button>
        <p className="status-text">{status}</p>
      </form>
    </section>
  );
}
