'use client';

import { FormEvent, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type DashboardSummary = {
  organization: { id: string; name: string; status: string };
  plan: { id: string; name: string; monthlyPriceEgp: number } | null;
  payment: { id: string; status: string; method: string; amountEgp: number; reference?: string | null; proofUrl?: string | null } | null;
};

function getInitialOrganizationId() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('organizationId') || localStorage.getItem('dify_saas_organization_id') || '';
}

export default function PaymentPage(){
  const [organizationId, setOrganizationId] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [status, setStatus] = useState('');
  const [submittedPaymentId, setSubmittedPaymentId] = useState('');
  const [uploadedProof, setUploadedProof] = useState<{ id: string; proofUrl: string; originalName: string } | null>(null);

  useEffect(() => { setOrganizationId(getInitialOrganizationId()); }, []);

  useEffect(() => {
    if (!organizationId) return;
    localStorage.setItem('dify_saas_organization_id', organizationId);
    setStatus('جاري تحميل بيانات الشركة...');
    fetch(`${API_BASE}/organizations/${organizationId}/dashboard`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'تعذر تحميل بيانات الشركة');
        return data as DashboardSummary;
      })
      .then(data => { setSummary(data); setStatus(''); })
      .catch(error => { setSummary(null); setStatus(error instanceof Error ? error.message : 'حصل خطأ'); });
  }, [organizationId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      setStatus('اكتب Organization ID الأول');
      return;
    }

    const form = new FormData(event.currentTarget);
    const proofFile = form.get('proofFile');
    let proofUploadId = uploadedProof?.id || '';
    let proofUrl = uploadedProof?.proofUrl || '';

    if (proofFile instanceof File && proofFile.size > 0 && !proofUploadId) {
      setStatus('جاري رفع ملف إثبات الدفع...');
      const uploadForm = new FormData();
      uploadForm.append('organizationId', organizationId);
      uploadForm.append('file', proofFile);
      const uploadResponse = await fetch(`${API_BASE}/payments/proofs`, { method: 'POST', body: uploadForm });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        setStatus(uploadData.message || 'فشل رفع ملف إثبات الدفع');
        return;
      }
      proofUploadId = uploadData.id;
      proofUrl = uploadData.proofUrl;
      setUploadedProof({ id: uploadData.id, proofUrl: uploadData.proofUrl, originalName: uploadData.originalName });
    }

    const payload = {
      organizationId,
      method: String(form.get('method') || 'instapay') as 'instapay' | 'vodafone_cash' | 'bank_transfer',
      amountEgp: Number(form.get('amountEgp') || summary?.plan?.monthlyPriceEgp || 0),
      reference: String(form.get('reference') || ''),
      proofUploadId: proofUploadId || undefined,
      proofUrl: proofUrl || String(form.get('proofUrl') || '')
    };

    setStatus('جاري تسجيل إثبات الدفع...');
    const response = await fetch(`${API_BASE}/payments/manual-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'حصل خطأ أثناء تسجيل الدفع');
      return;
    }

    setSubmittedPaymentId(data.payment.id);
    setStatus('تم تسجيل إثبات الدفع. الحالة الآن في انتظار مراجعة الأدمن.');
  }

  return <main className="shell form">
    <h1>إثبات الدفع اليدوي</h1>
    <p>سجل بيانات التحويل عشان الأدمن يراجع الدفع ويفعل مساحة AI Studio.</p>

    <div className="item" style={{marginTop: 20}}>
      <strong>Organization ID</strong>
      <input className="input" value={organizationId} onChange={event => setOrganizationId(event.target.value)} placeholder="org_xxxxxxxx" />
      {summary && <p>{summary.organization.name} · {summary.organization.status} · {summary.plan?.name || 'No plan'}</p>}
      {summary?.payment && <p>آخر دفع مسجل: {summary.payment.status} · {summary.payment.amountEgp} EGP</p>}
    </div>

    <form onSubmit={submit} style={{marginTop: 20}}>
      <select name="method" className="input" defaultValue="instapay">
        <option value="instapay">Instapay</option>
        <option value="vodafone_cash">Vodafone Cash</option>
        <option value="bank_transfer">Bank transfer</option>
      </select>
      <input name="amountEgp" type="number" className="input" placeholder="المبلغ بالجنيه" defaultValue={summary?.plan?.monthlyPriceEgp || ''} required />
      <input name="reference" className="input" placeholder="رقم العملية / Reference" required />
      <label className="item" style={{display: 'block'}}>
        <strong>صورة/ملف إثبات الدفع</strong>
        <input name="proofFile" type="file" className="input" accept="image/jpeg,image/png,image/webp,application/pdf" />
        <small>الأنواع المسموحة: JPG, PNG, WEBP, PDF — حد أقصى 5MB.</small>
      </label>
      {uploadedProof && <p>تم رفع الملف: {uploadedProof.originalName}</p>}
      <input name="proofUrl" className="input" placeholder="رابط إثبات دفع خارجي اختياري لو الملف مرفوع مسبقًا" />
      <button className="btn">إرسال إثبات الدفع</button>
    </form>

    {status && <div className="item" style={{marginTop: 20}}><strong>{status}</strong>{submittedPaymentId && <p>Payment ID: <code>{submittedPaymentId}</code></p>}<p><a className="btn secondary" href={`/dashboard?organizationId=${organizationId}`}>ارجع للوحة العميل</a></p></div>}
  </main>
}
