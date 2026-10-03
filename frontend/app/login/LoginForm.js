'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchCurrentViewer, loginByAccount } from '../../lib/api.js';
import { clearGuestMode, setGuestMode } from '../../lib/guest.js';
import styles from './login.module.css';

export default function LoginForm() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [showPasswordTip, setShowPasswordTip] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function redirectByRole(role) {
    if (role === 'user') {
      router.replace('/');
    } else if (role === 'teacher') {
      router.replace('/admin/users');
    } else if (role === 'super_admin') {
      router.replace('/tracks');
    } else {
      router.replace('/tracks');
    }
  }

  useEffect(() => {
    let ignored = false;

    async function checkExistingSession() {
      const result = await fetchCurrentViewer();
      const role = result.data?.role;

      if (!ignored && role && role !== 'guest') {
        redirectByRole(role);
      }
    }

    checkExistingSession();

    return () => {
      ignored = true;
    };
  }, [router]);

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
      clearGuestMode();
      redirectByRole(result.data?.role);
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
    <section className={styles.page}>
      <div className={styles.loginShell}>
        <main className={`${styles.card} ${styles.rise}`}>
          <div className={styles.frame} aria-hidden="true"></div>

          <div className={styles.tabRow}>
            <div className={styles.logoTab}>
              <a className={styles.logo} href="/tracks">
                <span className={styles.mark}></span>
                能学慧吉他教室
                <small>NXH GUITAR</small>
              </a>
            </div>
          </div>

          <div className={`${styles.image} ${styles.rise}`}></div>

          <div className={styles.formSide}>
          <div className={`${styles.formHead} ${styles.rise} ${styles.delay1}`}>
            <h1><mark>登录教室</mark>，继续练琴</h1>
          </div>

          <form className={`${styles.form} ${styles.rise} ${styles.delay2}`} autoComplete="off" onSubmit={handleLogin}>
            <div className={styles.field}>
              <label htmlFor="username">账号（手机号）</label>
              <input id="username" name="username" type="text" autoComplete="username" placeholder="请输入手机号" required />
            </div>

            <div className={styles.field}>
              <label htmlFor="password">
                密码
                <span className={styles.aux}>
                  <button type="button" className={styles.linkButton} onClick={() => setShowPasswordTip((value) => !value)}>
                    忘记密码？
                  </button>
                </span>
              </label>
              <div className={styles.passwordBox}>
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="请输入密码" required />
                <button type="button" className={styles.eyeButton} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                    <path d="M2.7 12s3.4-5.8 9.3-5.8 9.3 5.8 9.3 5.8-3.4 5.8-9.3 5.8S2.7 12 2.7 12Z" />
                    <circle cx="12" cy="12" r="2.7" />
                    {showPassword ? null : <path className={styles.eyeSlash} d="M4.5 4.8 19.5 19.2" />}
                  </svg>
                </button>
              </div>
              <div className={`${styles.passwordTip}${showPasswordTip ? ` ${styles.show}` : ''}`} role="note">请联系你的老师修改密码</div>
            </div>

            <label className={styles.remember}>
              <input type="checkbox" defaultChecked />
              <span className={styles.cbx}>✓</span>
              <span className={styles.txt}>记住我（7 天内免登录）</span>
            </label>

            <button type="submit" className={styles.mainButton} disabled={isSubmitting}>{isSubmitting ? '登录中…' : '登 录'}</button>
            {status ? <p className={styles.statusText}>{status}</p> : null}
          </form>

          <button type="button" className={`${styles.guest} ${styles.rise} ${styles.delay3}`} onClick={handleEnterGuest}>先不登录，使用游客模式访问 →</button>
          </div>
        </main>
      </div>
    </section>
  );
}
