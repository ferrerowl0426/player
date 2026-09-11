'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
    { href: '/homework', label: '我的历史作业' }
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
  const navLinks = links || NAV_LINKS_BY_ROLE[role] || NAV_LINKS_BY_ROLE.guest;
  const resolvedHomeHref = homeHref || (role === 'user' ? '/' : '/tracks');

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
          {actions}
          <span className="avatar" title={accountName}>{String(accountName || '访客').slice(0, 1)}</span>
        </div>
      </div>
    </header>
  );
}
