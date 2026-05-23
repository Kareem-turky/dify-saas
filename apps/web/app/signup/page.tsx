'use client';

import { FormEvent, useState, useEffect } from 'react';
import { useAuth, RedirectIfAuth } from '../auth';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const { signup, user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      router.replace(user.role === 'admin' ? '/admin' : '/payment');
    }
  }, [user, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('جاري إنشاء الحساب...');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await signup({
        name: String(form.get('name') || ''),
        email: String(form.get('email') || ''),
        password: String(form.get('password') || ''),
        phone: String(form.get('phone') || ''),
        companyName: String(form.get('companyName') || ''),
        industry: String(form.get('industry') || ''),
        planId: String(form.get('planId') || 'starter'),
      });
      setStatus('تم إنشاء الحساب بنجاح! جاري التحويل لتسجيل الدفع...');
      router.push(`/payment?organizationId=${result.organizationId}`);
    } catch (e) {
      setStatus('');
      setError(e instanceof Error ? e.message : 'حصل خطأ أثناء التسجيل');
    }
  }

  return <RedirectIfAuth>
    <main className="shell" style={{ maxWidth: 560, marginTop: 60 }}>
      <div className="card glass">
        <h1 style={{ textAlign: 'center' }}>إنشاء حساب شركة</h1>
        <p style={{ textAlign: 'center' }}>سجل بياناتك واختار الباقة المناسبة</p>
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <input name="name" className="input" placeholder="الاسم" required />
          <input name="email" type="email" className="input" placeholder="البريد الإلكتروني" required />
          <input name="password" type="password" className="input" placeholder="كلمة المرور" required minLength={8} />
          <input name="phone" className="input" placeholder="رقم الهاتف" />
          <input name="companyName" className="input" placeholder="اسم الشركة" required />
          <input name="industry" className="input" placeholder="المجال (اختياري)" />
          <select name="planId" className="input">
            <option value="starter">Starter — 1,500 ج.م/شهر</option>
            <option value="growth">Growth — 3,500 ج.م/شهر</option>
            <option value="business">Business — 7,500 ج.م/شهر</option>
          </select>
          <button className="btn" type="submit" style={{ width: '100%', marginTop: 8 }}>متابعة للدفع</button>
        </form>
        {status && <p style={{ color: 'var(--brand2)', textAlign: 'center', marginTop: 12 }}>{status}</p>}
        {error && <div className="item" style={{ marginTop: 12, borderColor: 'var(--bad)' }}><strong style={{ color: 'var(--bad)' }}>{error}</strong></div>}
        <p style={{ textAlign: 'center', marginTop: 16 }}>عندك حساب؟ <a href="/login" style={{ color: 'var(--brand)' }}>سجل دخول</a></p>
      </div>
    </main>
  </RedirectIfAuth>;
}
