'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logoutAdmin, logoutUser } from '../../lib/api.js';

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

export default function AppNav({ links, role = 'guest', accountName = '访客', actions = null, homeHref }) {
  const pathname = usePathname();
  const router = useRouter();
  const navLinks = links || NAV_LINKS_BY_ROLE[role] || NAV_LINKS_BY_ROLE.guest;
  const resolvedHomeHref = homeHref || (role === 'user' ? '/' : '/tracks');
  const isGuest = role === 'guest';
  const roleLabel = role === 'super_admin' ? '教导主任' : role === 'teacher' ? '老师' : role === 'user' ? '学员' : '游客';

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
            <button className="avatar" type="button" aria-haspopup="menu" aria-label={`账号菜单：${accountName || '访客'}`}>{String(accountName || '访客').slice(0, 1)}</button>
            {!isGuest ? (
              <div className="profile-card" role="menu">
                <div className="profile-head">
                  <strong>{accountName || '账号'}</strong>
                  <small>{roleLabel}</small>
                </div>
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
    </header>
  );
}
