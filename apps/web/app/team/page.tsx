'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth, RequireAuth } from '../auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type TeamMember = { id: string; name: string; email: string; role: string; preferredLanguage: string; createdAt: string };
type TeamSummary = { seatLimit: number; seatsUsed: number; seatsRemaining: number; members: TeamMember[] };

export default function TeamPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/team/members`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'تعذر تحميل أعضاء الفريق');
        setSummary(data as TeamSummary);
      })
      .catch(e => setMessage(e instanceof Error ? e.message : 'حصل خطأ'));
  }, [token]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const formData = new FormData(event.currentTarget);
    setMessage('جاري إضافة عضو...');
    const response = await fetch(`${API_BASE}/team/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: String(formData.get('name') || ''),
        email: String(formData.get('email') || ''),
        role: String(formData.get('role') || 'member'),
        preferredLanguage: String(formData.get('preferredLanguage') || 'ar')
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.message || 'فشل إضافة العضو'); return; }
    (event.target as HTMLFormElement).reset();
    setMessage('تمت إضافة عضو الفريق.');
    // Reload
    const refreshed = await fetch(`${API_BASE}/team/members`, { headers: { Authorization: `Bearer ${token}` } });
    if (refreshed.ok) setSummary(await refreshed.json());
  }

  return <RequireAuth>
    <main className="shell">
      <h1>إدارة الفريق</h1>
      <p>إدارة أعضاء فريقك مع تطبيق حد المقاعد حسب الباقة.</p>
      {message && <p>{message}</p>}

      {summary && <>
        <div className="card" style={{ marginTop: 24 }}>
          <span className="badge">{summary.seatsUsed}/{summary.seatLimit} seats</span>
          <h2>مقاعد الفريق</h2>
          <p>المستخدم حاليًا: {summary.seatsUsed} · المتبقي: {summary.seatsRemaining}</p>
        </div>

        <form className="card" onSubmit={addMember} style={{ marginTop: 16 }}>
          <h2>إضافة عضو</h2>
          <input name="name" className="input" placeholder="الاسم" required />
          <input name="email" className="input" type="email" placeholder="البريد الإلكتروني" required />
          <select name="role" className="input" defaultValue="member">
            <option value="member">Member</option>
            <option value="manager">Manager</option>
          </select>
          <select name="preferredLanguage" className="input" defaultValue="ar">
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
          <button className="btn" type="submit" disabled={summary.seatsRemaining <= 0}>إضافة عضو</button>
          {summary.seatsRemaining <= 0 && <p style={{ color: 'var(--warn)' }}>وصلت لحد المقاعد في الباقة.</p>}
        </form>

        <div className="grid">
          {summary.members.map(member => <div className="item" key={member.id}>
            <strong>{member.name}</strong>
            <p>{member.email}</p>
            <p>{member.role} · {member.preferredLanguage}</p>
          </div>)}
        </div>
      </>}
    </main>
  </RequireAuth>;
}
