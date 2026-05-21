'use client';

import { FormEvent, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type LoginResponse = { token: string; user: { id: string; email: string; role: string; organizationId?: string | null } };

export default function LoginPage(){
  const [status, setStatus] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus('جاري تسجيل الدخول...');
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(form.get('email') || ''), password: String(form.get('password') || '') })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(data.message || 'فشل تسجيل الدخول');
      return;
    }
    const login = data as LoginResponse;
    localStorage.setItem('authToken', login.token);
    if (login.user.organizationId) localStorage.setItem('dify_saas_organization_id', login.user.organizationId);
    setStatus('تم تسجيل الدخول. جاري فتح الصفحة المناسبة...');
    window.location.href = login.user.role === 'admin' ? '/admin' : '/dashboard';
  }

  return <main className="shell form">
    <h1>تسجيل الدخول</h1>
    <p>ادخل بالإيميل والباسورد مرة واحدة، وبعدها الصفحات هتستخدم التوكن تلقائيًا.</p>
    <form onSubmit={submit}>
      <input name="email" type="email" className="input" placeholder="البريد الإلكتروني" required />
      <input name="password" type="password" className="input" placeholder="كلمة المرور" required />
      <button className="btn" type="submit">Login</button>
    </form>
    {status && <div className="item" style={{marginTop: 20}}><strong>{status}</strong></div>}
  </main>;
}
