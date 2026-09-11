'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAdminMe } from '../../../lib/api.js';

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
          router.replace('/admin');
          return;
        }

        router.replace(resolveCreateTarget());
      } catch {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router]);

  return (
    <main className="create-entry-page">
      <p>正在打开创建页…</p>
    </main>
  );
}
