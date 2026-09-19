'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAdminMe } from '../../../lib/api.js';
import styles from '../redirect.module.css';

function resolveCreateTarget() {
  const params = new URLSearchParams(window.location.search);
  const zone = params.get('zone') === 'knowledge' ? 'knowledge' : 'track';
  const type = params.get('type') === 'collection' ? 'collection' : 'lesson';

  if (zone === 'knowledge') {
    return '/admin/knowledge';
  }

  return type === 'collection' ? '/admin/tracks/collections' : '/admin/tracks';
}

export default function AdminUploadPage() {
  const router = useRouter();

  useEffect(() => {
    async function initPage() {
      try {
        const response = await fetchAdminMe();

        if (response.data.role !== 'super_admin') {
          router.replace('/tracks');
          return;
        }

        router.replace(resolveCreateTarget());
      } catch {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router]);

  return <main className={styles.redirectPage}>正在打开创建页…</main>;
}
