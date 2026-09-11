'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginByAccount } from '../../lib/api.js';
import { setGuestMode } from '../../lib/guest.js';

export default function LoginForm() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [showPasswordTip, setShowPasswordTip] = useState(false);
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
      const result = await loginByAccount({ username, password });
      const role = result.data?.role;

      if (role === 'user') {
        router.replace('/');
      } else {
        router.replace('/admin');
      }

      router.refresh();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEnterGuest() {
    setGuestMode(true);
    router.replace('/tracks');
  }

  return (
    <section className="guitar-login-page">
      <main className="guitar-login-card guitar-rise">
        <div className="guitar-postcard-frame" aria-hidden="true"></div>

        <div className="guitar-tab-row">
          <div className="guitar-logo-tab">
            <a className="guitar-logo" href="/tracks">
              <span className="guitar-mark"></span>
              能学慧吉他教室
              <small>NXH GUITAR</small>
            </a>
          </div>
        </div>

        <div className="guitar-login-image guitar-rise"></div>

        <div className="guitar-form-side">
          <div className="guitar-form-head guitar-rise guitar-delay-1">
            <h1><mark>登录教室</mark>，继续练琴</h1>
            <p>输入账号密码，系统会自动识别学员、老师或教导主任身份。</p>
          </div>

          <form className="guitar-login-form guitar-rise guitar-delay-2" autoComplete="off" onSubmit={handleLogin}>
            <div className="guitar-field">
              <label htmlFor="username">账号</label>
              <input id="username" name="username" type="text" autoComplete="username" placeholder="请输入账号" required />
            </div>

            <div className="guitar-field">
              <label htmlFor="password">
                密码
                <span className="guitar-aux">
                  <button type="button" className="guitar-link-button" onClick={() => setShowPasswordTip((value) => !value)}>
                    忘记密码？
                  </button>
                </span>
              </label>
              <input id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入密码" required />
              <div className={`guitar-password-tip${showPasswordTip ? ' show' : ''}`} role="note">请联系你的老师修改密码</div>
            </div>

            <label className="guitar-remember">
              <input type="checkbox" defaultChecked />
              <span className="guitar-cbx">✓</span>
              <span className="guitar-txt">记住我（7 天内免登录）</span>
            </label>

            <button type="submit" className="guitar-main-button" disabled={isSubmitting}>{isSubmitting ? '登录中…' : '登 录'}</button>
            {status ? <p className="guitar-status-text">{status}</p> : null}
          </form>

          <button type="button" className="guitar-guest guitar-rise guitar-delay-3" onClick={handleEnterGuest}>先不登录，使用游客模式访问 →</button>

        </div>
      </main>
    </section>
  );
}
