'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type ApprovalRow = {
  approval: { id: string; status: string; paymentId: string };
  payment?: { id: string; method: string; amountEgp: number; status: string; reference?: string };
  organization?: { id: string; name: string; status: string };
};

export default function AdminPage(){
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [message, setMessage] = useState('');

  async function loadApprovals(){
    setMessage('جاري تحميل طلبات الموافقة...');
    const response = await fetch(`${API_BASE}/admin/approvals`);
    if (!response.ok) {
      setMessage('تعذر تحميل طلبات الموافقة. تأكد إن API شغال على port 4000.');
      return;
    }
    setRows(await response.json());
    setMessage('');
  }

  async function approve(paymentId: string){
    setMessage('جاري اعتماد الدفع وتشغيل provisioning job...');
    const response = await fetch(`${API_BASE}/admin/approvals/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Approved from admin UI' })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.message || 'فشل الاعتماد');
      return;
    }
    setMessage('تم الاعتماد وإنشاء provisioning job.');
    await loadApprovals();
  }

  useEffect(() => { void loadApprovals(); }, []);

  return <main className="shell"><h1>Internal Admin</h1><p>مراجعة المدفوعات اليدوية والموافقات حسب Phase 1.</p>{message && <p>{message}</p>}<div className="grid"><div className="item"><h3>Manual payment approvals</h3><p>Review proof, approve/reject, trigger provisioning.</p></div><div className="item"><h3>Provisioning jobs</h3><p>Retry jobs and inspect Dify mapping errors.</p></div><div className="item"><h3>Meta channels</h3><p>Token status, webhook health, last event.</p></div></div><section style={{marginTop: 32}}><h2>Open approvals</h2>{rows.length === 0 && <p>لا توجد طلبات موافقة مفتوحة حالياً.</p>}{rows.map(row => <div className="item" key={row.approval.id} style={{marginBottom: 12}}><strong>{row.organization?.name || row.approval.id}</strong><p>Payment: {row.payment?.method} — {row.payment?.amountEgp} EGP — {row.payment?.status}</p><p>Organization status: {row.organization?.status}</p>{row.approval.status === 'open' && row.payment && <button className="btn" onClick={() => approve(row.payment!.id)}>Approve payment</button>}</div>)}</section></main>
}
