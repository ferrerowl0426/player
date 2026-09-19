'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchCurrentViewer, loginByAccount } from '../../lib/api.js';
import { clearGuestMode, setGuestMode } from '../../lib/guest.js';
import styles from './login.module.css';

// TODO: 测试账号提示框仅用于开发/验收演示，上线或交付前请整段删除。
const TEMP_TEST_ACCOUNTS = [
  { role: '超管', name: '初始超级管理员', account: 'admin', password: 'demo123', source: '系统初始存在' },
  { role: '普通管理员', name: '教务雨涵老师', account: '13900000002', password: 'demo123', source: '测试数据注入' },
  { role: '老师', name: '鲁祥老师', account: '13900000011', password: 'demo123', source: '测试数据注入' },
  { role: '老师', name: '缘缘老师', account: '13900000012', password: 'demo123', source: '测试数据注入' },
  { role: '学生', name: '林知夏', account: '13800001001', password: 'demo123', source: '测试数据注入' },
  { role: '学生', name: '周予安', account: '13800001002', password: 'demo123', source: '测试数据注入' }
];

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
        {/* TODO: 测试账号提示框仅用于开发/验收演示，上线或交付前请整块删除。 */}
        <aside className={`${styles.testAccounts} ${styles.rise} ${styles.delay2}`} aria-label="测试账号提示">
          <div className={styles.testHead}>
            <strong>测试账号</strong>
            <span>临时提示 · 后续删除</span>
          </div>
          <div className={styles.testList}>
            {TEMP_TEST_ACCOUNTS.map((item) => (
              <div className={styles.testRow} key={`${item.role}-${item.account}`}>
                <span className={styles.testRole}>{item.role}</span>
                <span className={styles.testName}>{item.name}</span>
                <span className={styles.testCredential}>用户名/账号 {item.account}</span>
                <span className={styles.testCredential}>密码 {item.password}</span>
              </div>
            ))}
          </div>
          <p>说明：超管为系统初始账号；其余账号由测试数据注入。当前密码暂定均为 demo123。</p>
        </aside>

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
