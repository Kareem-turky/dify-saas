'use client';

import { FormEvent, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type TeamMember = { id: string; name: string; email: string; role: string; preferredLanguage: string; createdAt: string };
type TeamSummary = { seatLimit: number; seatsUsed: number; seatsRemaining: number; members: TeamMember[] };

export default function TeamPage(){
  const [token, setToken] = useState('');
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken') || '';
    setToken(storedToken);
    if (storedToken) void loadTeam(storedToken);
    else setMessage('سجل دخولك الأول من صفحة signup/login حتى تدير الفريق.');
  }, []);

  async function loadTeam(authToken = token) {
    if (!authToken) return;
    setMessage('جاري تحميل الفريق...');
    const response = await fetch(`${API_BASE}/team/members`, { headers: { Authorization: `Bearer ${authToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSummary(null);
      setMessage(data.message || 'تعذر تحميل أعضاء الفريق.');
      return;
    }
    setSummary(data as TeamSummary);
    setMessage('');
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setMessage('سجل دخولك الأول قبل إضافة عضو.');
      return;
    }
    const form = event.currentTarget;
    const formData = new FormData(form);
    setMessage('جاري إضافة عضو الفريق...');
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
    if (!response.ok) {
      setMessage(data.message || 'فشل إضافة العضو.');
      return;
    }
    form.reset();
    setSummary(previous => previous ? { ...previous, seatLimit: data.seatLimit, seatsUsed: data.seatsUsed, seatsRemaining: data.seatsRemaining, members: [...previous.members, data.member] } : null);
    setMessage('تمت إضافة عضو الفريق.');
    await loadTeam();
  }

  return <main className="shell">
    <h1>Team Management</h1>
    <p>إدارة أعضاء فريق العميل مع تطبيق حد المقاعد حسب الباقة الحالية.</p>

    <div className="item" style={{marginTop: 20}}>
      <strong>Auth Token</strong>
      <input className="input" value={token} onChange={event => setToken(event.target.value)} placeholder="Bearer token من signup/login" />
      <div className="cta"><button className="btn" onClick={() => { localStorage.setItem('authToken', token); void loadTeam(token); }}>Load team</button></div>
      {message && <p>{message}</p>}
    </div>

    {summary && <>
      <div className="card" style={{marginTop: 24}}>
        <span className="badge">{summary.seatsUsed}/{summary.seatLimit} seats</span>
        <h2>مقاعد الفريق</h2>
        <p>المستخدم حاليًا: {summary.seatsUsed} · المتبقي: {summary.seatsRemaining}</p>
      </div>

      <form className="card" onSubmit={addMember} style={{marginTop: 16}}>
        <h2>إضافة عضو</h2>
        <label>الاسم<input name="name" className="input" placeholder="Agent name" /></label>
        <label>الإيميل<input name="email" className="input" type="email" placeholder="agent@example.com" /></label>
        <label>الدور<select name="role" className="input" defaultValue="member"><option value="member">Member</option><option value="manager">Manager</option></select></label>
        <label>اللغة<select name="preferredLanguage" className="input" defaultValue="ar"><option value="ar">Arabic</option><option value="en">English</option></select></label>
        <button className="btn" type="submit" disabled={summary.seatsRemaining <= 0}>Add member</button>
        {summary.seatsRemaining <= 0 && <p>وصلت لحد المقاعد في الباقة الحالية. اعمل Upgrade لإضافة أعضاء أكثر.</p>}
      </form>

      <div className="grid">
        {summary.members.map(member => <div className="item" key={member.id}>
          <strong>{member.name}</strong>
          <p>{member.email}</p>
          <p>{member.role} · {member.preferredLanguage}</p>
        </div>)}
      </div>
    </>}
  </main>;
}
