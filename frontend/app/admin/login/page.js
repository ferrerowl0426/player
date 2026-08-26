'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login?tab=teacher');
  }, [router]);

  return <p className="empty-text">正在跳转到登录页...</p>;
}
