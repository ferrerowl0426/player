'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginAdmin, loginUser } from '../../lib/api.js';

const TABS = [
  { key: 'student', label: '学员登录' },
  { key: 'teacher', label: '老师登录' },
  { key: 'super', label: '教导主任登录' }
];

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') === 'teacher' ? 'teacher' : 'student');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');

    if (!username || !password) {
      setStatus('请填写账号和密码');
      return;
    }

    setIsSubmitting(true);
    setStatus('正在登录...');

    try {
      if (tab === 'student') {
        await loginUser({ username, password });
        router.replace('/');
      } else if (tab === 'teacher') {
        // 老师登录选项卡只允许实际角色为 teacher 的账号。
        await loginAdmin({ username, password, expectedRole: 'teacher' });
        router.replace('/admin');
      } else {
        // 教导主任登录选项卡只允许实际角色为 super_admin 的账号。
        await loginAdmin({ username, password, expectedRole: 'super_admin' });
        router.replace('/admin');
      }

      router.refresh();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const descriptions = {
    student: '学员登录后可以浏览视频列表，并查看老师单独推送的今日作业。',
    teacher: '老师登录后可以管理班级学员、上传视频并推送作业。',
    super: '教导主任登录后可以管理班级、老师账号、删除视频并给任意学员推送。'
  };

  return (
    <section className="login-panel">
      <div className="login-tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'active' : ''}
            onClick={() => {
              setTab(item.key);
              setStatus('');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <h1>{TABS.find((item) => item.key === tab).label}</h1>
      <p>{descriptions[tab]}</p>

      <form className="upload-form" onSubmit={handleLogin}>
        <label>
          <span>账号</span>
          <input name="username" type="text" autoComplete="username" placeholder="请输入账号" required />
        </label>

        <label>
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" placeholder="请输入密码" required />
        </label>

        <button type="submit" disabled={isSubmitting}>{isSubmitting ? '登录中...' : '登录'}</button>
        <p className="status-text">{status}</p>
      </form>

      <div className="login-test-note">
        <strong>测试账号备注</strong>
        <p>仅用于测试人员快捷登录，正式版本需要删除。</p>
        <div className="login-test-grid">
          <span>教导主任：admin / 123456</span>
          <span>老师：teacher_a / 123456</span>
          <span>老师：teacher_b / 123456</span>
          <span>学员：student_a1 / 123456</span>
          <span>学员：student_a2 / 123456</span>
          <span>学员：student_a3 / 123456</span>
          <span>学员：student_b1 / 123456</span>
          <span>学员：student_b2 / 123456</span>
          <span>学员：student_b3 / 123456</span>
        </div>
      </div>
    </section>
  );
}
