'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAdminMe } from '../../lib/api.js';
import styles from './redirect.module.css';

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    async function redirectByRole() {
      try {
        const result = await fetchAdminMe();
        router.replace(result.data.role === 'teacher' ? '/admin/users' : '/tracks');
      } catch {
        router.replace('/login');
      }
    }

    redirectByRole();
  }, [router]);
  return <main className={styles.redirectPage}>正在进入对应页面...</main>;
}
