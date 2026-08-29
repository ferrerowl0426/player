'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminUploadForm from '../../../components/AdminUploadForm.js';
import { fetchAdminMe } from '../../../lib/api.js';

export default function AdminUploadPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function initPage() {
      try {
        const response = await fetchAdminMe();

        if (response.data.role !== 'teacher' && response.data.role !== 'super_admin') {
          router.replace('/admin');
          return;
        }

        setReady(true);
      } catch {
        router.replace('/admin/login');
      }
    }

    initPage();
  }, [router]);

  if (!ready) {
    return <p className="empty-text">正在检查登录状态...</p>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>上传视频</h1>
          <p>老师和教导主任都可以在这里上传视频，并在右侧实时查看封面、标题和简介预览。</p>
        </div>
        <a className="hero-button" href="/admin">返回后台</a>
      </section>

      <AdminUploadForm
        compact
        onUploaded={() => {
          router.replace('/admin');
        }}
      />
    </>
  );
}
