'use client';

import { FormEvent, useState, useEffect, Suspense } from 'react';
import { useAuth, RedirectIfAuth } from '../auth';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginContent() {
  const { login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      const redirect = searchParams.get('redirect') || (user.role === 'admin' ? '/admin' : '/dashboard');
      router.replace(redirect);
    }
  }, [user, router, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('جاري تسجيل الدخول...');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const u = await login(String(form.get('email') || ''), String(form.get('password') || ''));
      const redirect = searchParams.get('redirect') || (u.role === 'admin' ? '/admin' : '/dashboard');
      router.push(redirect);
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : 'فشل تسجيل الدخول');
    }
  }

  return <RedirectIfAuth>
    <main className="shell" style={{ maxWidth: 480, marginTop: 80 }}>
      <div className="card glass">
        <h1 style={{ textAlign: 'center' }}>تسجيل الدخول</h1>
        <p style={{ textAlign: 'center' }}>ادخل بالإيميل والباسورد عشان تدخل لوحة التحكم</p>
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <input name="email" type="email" className="input" placeholder="البريد الإلكتروني" required />
          <input name="password" type="password" className="input" placeholder="كلمة المرور" required />
          <button className="btn" type="submit" style={{ width: '100%', marginTop: 8 }}>تسجيل الدخول</button>
        </form>
        {status && <p style={{ color: 'var(--brand2)', textAlign: 'center', marginTop: 12 }}>{status}</p>}
        {error && <div className="item" style={{ marginTop: 12, borderColor: 'var(--bad)' }}><strong style={{ color: 'var(--bad)' }}>{error}</strong></div>}
        <p style={{ textAlign: 'center', marginTop: 16 }}>معندكش حساب؟ <a href="/signup" style={{ color: 'var(--brand)' }}>سجل حساب جديد</a></p>
      </div>
    </main>
  </RedirectIfAuth>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="shell"><p>جاري التحميل...</p></main>}><LoginContent /></Suspense>;
}
