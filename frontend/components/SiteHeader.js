'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchAdminMe, fetchUserMe, logoutAdmin, logoutUser } from '../lib/api.js';
import { clearGuestMode, isGuestMode, setGuestMode } from '../lib/guest.js';

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState('checking');
  const [guest, setGuest] = useState(false);
  const isAdminPage = pathname.startsWith('/admin');
  const isLoginPage = pathname === '/login' || pathname === '/admin/login';

  useEffect(() => {
    let active = true;

    async function checkLogin() {
      // 游客模式只在客户端标记，优先检查。
      if (isGuestMode()) {
        if (active) {
          setGuest(true);
          setIdentity('guest');
        }
        return;
      }

      try {
        await fetchAdminMe();
        if (active) {
          setGuest(false);
          setIdentity('admin');
        }
        return;
      } catch {
        // 没有老师 Cookie 时继续检查学员 Cookie。
      }

      try {
        await fetchUserMe();
        if (active) {
          setGuest(false);
          setIdentity('user');
        }
      } catch {
        if (active) {
          setGuest(false);
          setIdentity('guest');
        }
      }
    }

    setIdentity('checking');
    checkLogin();

    return () => {
      active = false;
    };
  }, [pathname]);

  async function handleLogout() {
    if (identity === 'admin') {
      await logoutAdmin();
      clearGuestMode();
      setGuest(false);
      setIdentity('guest');
      router.replace('/admin/login');
      return;
    }

    if (identity === 'user') {
      await logoutUser();
      clearGuestMode();
      setGuest(false);
      setIdentity('guest');
      router.replace('/login');
    }
  }

  function handleEnterGuest() {
    setGuestMode(true);
    router.replace('/tracks');
  }

  function handleExitGuest() {
    clearGuestMode();
    setGuest(false);
    setIdentity('guest');
    router.replace('/login');
  }

  return isLoginPage ? null : (
    <header className="site-header">
      <a className="logo" href="/">学习播放器</a>
      <nav className="site-nav">
        {identity === 'checking' ? null : isLoginPage ? (
          <button type="button" onClick={handleEnterGuest}>先不登录使用游客模式访问</button>
        ) : identity === 'admin' ? (
          <>
            <a href="/admin">回到首页</a>
            <a href="/tracks">曲目库</a>
            <a href="/knowledge">知识点区</a>
            <button type="button" onClick={handleLogout}>退出</button>
          </>
        ) : identity === 'user' ? (
          <>
            <a href="/">回到首页</a>
            <a href="/tracks">曲目库</a>
            <a href="/knowledge">知识点区</a>
            <button type="button" onClick={handleLogout}>退出</button>
          </>
        ) : guest ? (
          <>
            <a href="/tracks">曲目库</a>
            <button type="button" onClick={handleExitGuest}>去登录</button>
          </>
        ) : isAdminPage ? (
          <a href="/admin/login">老师登录</a>
        ) : (
          <>
            <a href="/login">学员登录</a>
            <a href="/admin/login">老师登录</a>
          </>
        )}
      </nav>
    </header>
  );
}
