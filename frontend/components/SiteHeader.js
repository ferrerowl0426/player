'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchAdminMe, fetchUserMe, logoutAdmin, logoutUser } from '../lib/api.js';

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState('checking');
  const isAdminPage = pathname.startsWith('/admin');

  useEffect(() => {
    let active = true;

    async function checkLogin() {
      try {
        await fetchAdminMe();
        if (active) {
          setIdentity('admin');
        }
        return;
      } catch {
        // 没有老师 Cookie 时继续检查学员 Cookie。
      }

      try {
        await fetchUserMe();
        if (active) {
          setIdentity('user');
        }
      } catch {
        if (active) {
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
      setIdentity('guest');
      router.replace('/admin/login');
      return;
    }

    if (identity === 'user') {
      await logoutUser();
      setIdentity('guest');
      router.replace('/login');
    }
  }

  return (
    <header className="site-header">
      <a className="logo" href={isAdminPage ? '/admin' : '/'}>学习播放器</a>
      <nav className="site-nav">
        {identity === 'checking' ? null : isAdminPage ? (
          identity === 'admin' ? (
            <>
              <a href="/admin">老师首页</a>
              <button type="button" onClick={handleLogout}>退出登录</button>
            </>
          ) : (
            <a href="/admin/login">老师登录</a>
          )
        ) : (
          identity === 'user' || identity === 'admin' ? (
            <>
              <a href="/">首页</a>
              <button type="button" onClick={handleLogout}>退出登录</button>
            </>
          ) : (
            <>
              <a href="/login">学员登录</a>
              <a href="/admin/login">老师入口</a>
            </>
          )
        )}
      </nav>
    </header>
  );
}
