'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../redirect.module.css';

export default function AdminLoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return <main className={styles.redirectPage}>正在跳转到登录页...</main>;
}
