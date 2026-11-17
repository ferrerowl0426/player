'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logoutAdmin, logoutUser, changeOwnPassword } from '../../lib/api.js';
import { shouldShowSelfReset, validateSelfChangePassword } from '../../lib/passwordResetLogic.js';
import styles from './AppNav.module.css';

const NAV_LINKS_BY_ROLE = {
  guest: [
    { href: '/tracks', label: '曲目区' },
    { href: '/knowledge', label: '知识点区' },
    { href: '/library', label: '图书馆' }
  ],
  user: [
    { href: '/', label: '首页' },
    { href: '/tracks', label: '曲目区' },
    { href: '/knowledge', label: '知识点区' },
    { href: '/library', label: '图书馆' },
    { href: '/my-homework', label: '我的历史作业' }
  ],
  teacher: [
    { href: '/tracks', label: '曲目区' },
    { href: '/knowledge', label: '知识点区' },
    { href: '/library', label: '图书馆' },
    { href: '/admin/users', label: '学生管理' }
  ],
  super_admin: [
    { href: '/tracks', label: '曲目区' },
    { href: '/knowledge', label: '知识点区' },
    { href: '/library', label: '图书馆' },
    { href: '/admin/users', label: '学生管理' },
    { href: '/admin/classes', label: '班级管理' }
  ]
};

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function EyeOn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10.5 6 10.5 6a17 17 0 0 1-3.3 3.9M6.2 7.8A17 17 0 0 0 1.5 12S5 18 12 18a9.4 9.4 0 0 0 4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 13, height: 13 }}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8" />
      <path d="M16 16l2-2" />
      <path d="M19 19l2-2" />
    </svg>
  );
}

export default function AppNav({ links, role = 'guest', accountName = '访客', nickname = '', username = '', actions = null, homeHref }) {
  const pathname = usePathname();
  const router = useRouter();
  const navLinks = links || NAV_LINKS_BY_ROLE[role] || NAV_LINKS_BY_ROLE.guest;
  const resolvedHomeHref = homeHref || (role === 'user' ? '/' : '/tracks');
  const isGuest = role === 'guest';
  const roleLabel = role === 'super_admin' ? '教导主任' : role === 'teacher' ? '老师' : role === 'user' ? '学员' : '游客';
  const displayName = accountName || nickname || username || '访客';
  const avatarInitial = String(nickname || accountName || username || '访客').trim().slice(0, 1) || '访';
  const showSelfReset = shouldShowSelfReset({ username, role });

  const [showReset, setShowReset] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState(false);
  const oldInputRef = useRef(null);
  const resetBtnRef = useRef(null);
  const successTimer = useRef(null);

  // 卸载时清理定时器，避免遗留跳转。
  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  // 弹窗打开时聚焦首个输入框；Esc 关闭并清空。
  useEffect(() => {
    if (!showReset) return undefined;
    oldInputRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeReset();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showReset, submitting, success]);

  async function handleLogout() {
    if (isGuest) {
      router.push('/login');
      return;
    }

    try {
      if (role === 'user') {
        await logoutUser();
      } else {
        await logoutAdmin();
      }
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  function openReset() {
    setShowReset(true);
  }

  function closeReset() {
    if (submitting || success) return;
    setShowReset(false);
    setOldPassword('');
    setNewPassword('');
    setShowOld(false);
    setShowNew(false);
    setFormError('');
    setSuccess(false);
    setSubmitting(false);
    resetBtnRef.current?.focus();
  }

  function scheduleLogoutAndRedirect() {
    if (successTimer.current) clearTimeout(successTimer.current);
    // 后端已在改密成功时清除会话 Cookie；前端不再发敏感请求，仅清理本地并跳转登录。
    successTimer.current = setTimeout(() => {
      successTimer.current = null;
      router.replace('/login');
      router.refresh();
    }, 1000);
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    if (submitting) return; // 防重复提交
    const { ok, error } = validateSelfChangePassword({ oldPassword, newPassword });
    if (!ok) {
      setFormError(error);
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      await changeOwnPassword({ oldPassword, newPassword, role });
      setOldPassword('');
      setNewPassword('');
      setShowOld(false);
      setShowNew(false);
      setSuccess(true);
      scheduleLogoutAndRedirect();
    } catch (err) {
      const code = err && err.code;
      if (code === 'OLD_PASSWORD_INCORRECT') {
        // 旧密错：行内提示、清空旧密码、聚焦旧密码，不登出。
        setOldPassword('');
        setFormError('当前密码错误，请输入正确的当前密码');
        oldInputRef.current?.focus();
      } else if (code === 'INVALID_PASSWORD') {
        setFormError('新密码不符合要求（需 5-30 个字符）');
      } else if (code === 'INVALID_PASSWORD_INPUT') {
        setFormError('密码输入不合法，请重新输入');
      } else if (err && err.status === 429) {
        setFormError('操作过于频繁，请稍后再试');
      } else if (err && (err.status === 0 || err.status == null)) {
        setFormError('操作结果未确认，请尝试重新登录或重试');
      } else {
        setFormError(err && err.message ? err.message : '修改密码失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link className="logo" href={resolvedHomeHref}>
          <span className="mark" />
          <span>能学慧吉他教室</span>
          <small>NXH GUITAR</small>
        </Link>
        <nav className="nav-links" aria-label="主导航">
          {navLinks.map((link) => (
            <Link className={isActive(pathname, link.href) ? 'active' : ''} href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="nav-right">
          {actions || (isGuest ? <Link className="role-tag" href="/login">登录</Link> : null)}
          <div className="avatar-wrap">
            <button className="avatar" type="button" aria-haspopup="menu" aria-label={`账号菜单：${displayName}`}>{avatarInitial}</button>
            {!isGuest ? (
              <div className="profile-card" role="menu">
                <div className="profile-head">
                  <strong>{displayName || '账号'}</strong>
                  <small>{roleLabel}</small>
                </div>
                {showSelfReset ? (
                  <button className="profile-row" type="button" onClick={openReset} ref={resetBtnRef} role="menuitem">
                    <span className="profile-row-icon" aria-hidden="true"><KeyIcon /></span>
                    <span>重置密码</span>
                    <span className="profile-row-arrow" aria-hidden="true">›</span>
                  </button>
                ) : null}
                <button className="profile-row" type="button" onClick={handleLogout} role="menuitem">
                  <span className="profile-row-icon" aria-hidden="true">↩</span>
                  <span>退出登录</span>
                  <span className="profile-row-arrow" aria-hidden="true">›</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showReset ? (
        <div
          className={styles.mask}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-pwd-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeReset();
          }}
        >
          <form className={styles.panel} onSubmit={handleChangePassword}>
            <h3 className={styles.title} id="reset-pwd-title">重置密码</h3>
            {success ? (
              <div className={styles.success} role="status">密码修改成功，请重新登录</div>
            ) : (
              <>
                <p className={styles.subtitle}>请输入当前密码与新密码（5-30 个字符，新密码不可与当前密码相同）。</p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-old">当前密码</label>
                  <div className={styles.inputWrap}>
                    <input
                      id="reset-old"
                      ref={oldInputRef}
                      className={styles.input}
                      type={showOld ? 'text' : 'password'}
                      value={oldPassword}
                      autoComplete="current-password"
                      onChange={(event) => setOldPassword(event.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className={styles.eye}
                      onClick={() => setShowOld((value) => !value)}
                      aria-label={showOld ? '隐藏当前密码' : '显示当前密码'}
                      aria-pressed={showOld}
                    >
                      {showOld ? <EyeOff /> : <EyeOn />}
                    </button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-new">新密码</label>
                  <div className={styles.inputWrap}>
                    <input
                      id="reset-new"
                      className={styles.input}
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      autoComplete="new-password"
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      className={styles.eye}
                      onClick={() => setShowNew((value) => !value)}
                      aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                      aria-pressed={showNew}
                    >
                      {showNew ? <EyeOff /> : <EyeOn />}
                    </button>
                  </div>
                </div>
                <div className={styles.error} aria-live="polite">{formError}</div>
                <div className={styles.ops}>
                  <button type="button" className={styles.btn} onClick={closeReset} disabled={submitting}>取消</button>
                  <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={submitting}>
                    {submitting ? '提交中…' : '确认修改'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      ) : null}
    </header>
  );
}
