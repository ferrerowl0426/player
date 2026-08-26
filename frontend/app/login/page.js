import { Suspense } from 'react';
import LoginForm from './LoginForm.js';

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="empty-text">正在加载登录页...</p>}>
      <LoginForm />
    </Suspense>
  );
}
