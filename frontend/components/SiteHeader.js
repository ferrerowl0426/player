'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { fetchAdminMe, fetchUserMe, logoutAdmin, logoutUser } from '../lib/api.js';

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState('checking');

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
        // 没有管理员 Cookie 时继续检查普通用户 Cookie。
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
      <a className="logo" href="/">学习播放器</a>
      <nav className="site-nav">
        {identity === 'checking' ? null : identity === 'admin' ? (
          <>
            <a href="/admin">管理员首页</a>
            <button type="button" onClick={handleLogout}>管理员退出</button>
          </>
        ) : identity === 'user' ? (
          <>
            <a href="/">用户首页</a>
            <button type="button" onClick={handleLogout}>用户退出</button>
          </>
        ) : (
          <>
            <a href="/login">用户登录</a>
            <a href="/admin/login">管理员登录</a>
            <a href="/">首页</a>
          </>
        )}
      </nav>
    </header>
  );
}
