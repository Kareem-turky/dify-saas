'use client';

import { FormEvent, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function SignupPage(){
  const [status, setStatus] = useState<string>('');
  const [organizationId, setOrganizationId] = useState<string>('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('جاري إنشاء الحساب...');
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') || ''),
      email: String(form.get('email') || ''),
      phone: String(form.get('phone') || ''),
      companyName: String(form.get('companyName') || ''),
      industry: String(form.get('industry') || ''),
      preferredLanguage: 'ar',
      planId: String(form.get('planId') || 'starter')
    };

    const response = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'حصل خطأ أثناء التسجيل');
      return;
    }
    setOrganizationId(data.organization.id);
    setStatus('تم إنشاء الحساب. الخطوة التالية: تسجيل إثبات الدفع اليدوي.');
  }

  return <main className="shell form"><h1>إنشاء حساب شركة</h1><p>Phase 1: نجمع بيانات العميل والشركة والباقه قبل الدفع والموافقة.</p><form onSubmit={submit}><input name="name" className="input" placeholder="الاسم" required/><input name="email" type="email" className="input" placeholder="البريد الإلكتروني" required/><input name="phone" className="input" placeholder="رقم الهاتف"/><input name="companyName" className="input" placeholder="اسم الشركة" required/><input name="industry" className="input" placeholder="المجال"/><select name="planId" className="input"><option value="starter">Starter</option><option value="growth">Growth</option><option value="business">Business</option></select><button className="btn">متابعة للدفع</button></form>{status && <div className="item" style={{marginTop: 20}}><strong>{status}</strong>{organizationId && <p>Organization ID: <code>{organizationId}</code></p>}</div>}</main>
}
