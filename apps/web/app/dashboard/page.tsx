'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type DashboardSummary = {
  organization: { id: string; name: string; status: string; difyTenantId?: string | null; difyAccountId?: string | null };
  subscription: { id: string; status: string; planId: string } | null;
  plan: { id: string; name: string; monthlyPriceEgp: number; messageLimit: number; channelLimit: number; seatLimit: number } | null;
  payment: { id: string; status: string; method: string; amountEgp: number; reference?: string | null } | null;
  latestInvoice: { id: string; invoiceNumber: string; amountEgp: number; currency: string; status: string; receiptUrl?: string | null; issuedAt: string } | null;
  approval: { id: string; status: string; notes?: string | null } | null;
  provisioningJob: { id: string; status: string; attempts: number; lastError?: string | null } | null;
  currentStep: 'submit_payment' | 'wait_for_admin_review' | 'wait_for_ai_studio' | 'open_ai_studio' | 'contact_support';
  aiStudioUrl: string | null;
  usage?: { messagesUsed: number; messageLimit: number; messagesRemaining: number; limitReached: boolean; windowStart: string; windowEnd: string; channelsUsed: number; channelLimit: number; channelsRemaining: number; channelLimitReached: boolean; upgradeRecommendation?: { reason: 'message_limit' | 'channel_limit'; currentPlanId: string; recommendedPlanId: string; recommendedPlanName: string; monthlyPriceEgp: number } };
  pendingUpgrade: { subscription: { id: string; status: string; planId: string }; plan: { id: string; name: string; monthlyPriceEgp: number }; payment: { id: string; status: string; amountEgp: number; reference?: string | null } | null; approval: { id: string; status: string; notes?: string | null } | null } | null;
};

const stepCopy: Record<DashboardSummary['currentStep'], { title: string; body: string }> = {
  submit_payment: { title: 'مطلوب إثبات الدفع', body: 'الحساب اتعمل. ابعت إثبات الدفع عشان يدخل مراجعة الأدمن.' },
  wait_for_admin_review: { title: 'في انتظار مراجعة الدفع', body: 'الفريق هيراجع الدفع ويفعل الاشتراك.' },
  wait_for_ai_studio: { title: 'جاري تجهيز AI Studio', body: 'تم قبول الدفع، وجاري تجهيز مساحة Dify الخاصة بالشركة.' },
  open_ai_studio: { title: 'AI Studio جاهز', body: 'تقدر تبدأ تبني الـ chatflows والـ knowledge bases.' },
  contact_support: { title: 'مطلوب دعم', body: 'في حالة غير معتادة. كلم الدعم لمراجعة الحساب.' }
};

function getInitialOrganizationId() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('organizationId') || localStorage.getItem('dify_saas_organization_id') || '';
}

export default function DashboardPage(){
  const [organizationId, setOrganizationId] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => { setOrganizationId(getInitialOrganizationId()); }, []);

  useEffect(() => {
    if (!organizationId) return;
    localStorage.setItem('dify_saas_organization_id', organizationId);
    setStatus('جاري تحميل حالة الحساب...');
    fetch(`${API_BASE}/organizations/${organizationId}/dashboard`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'تعذر تحميل لوحة العميل');
        return data as DashboardSummary;
      })
      .then(data => { setSummary(data); setStatus(''); })
      .catch(error => { setSummary(null); setStatus(error instanceof Error ? error.message : 'حصل خطأ'); });
  }, [organizationId]);

  const current = summary ? stepCopy[summary.currentStep] : null;
  const steps = [
    { key: 'pending_payment', title: 'إثبات الدفع', done: Boolean(summary?.payment) },
    { key: 'pending_approval', title: 'مراجعة الأدمن', done: summary?.approval?.status === 'approved' },
    { key: 'provisioning', title: 'تجهيز AI Studio', done: summary?.provisioningJob?.status === 'completed' },
    { key: 'active', title: 'فتح AI Studio', done: summary?.organization.status === 'active' }
  ];

  return <main className="shell">
    <h1>Customer Dashboard</h1>
    <p>تابع حالة الشركة من الدفع للموافقة ثم تجهيز مساحة Dify الخاصة بالعميل.</p>

    <div className="item" style={{marginTop: 20}}>
      <strong>Organization ID</strong>
      <input className="input" value={organizationId} onChange={event => setOrganizationId(event.target.value)} placeholder="org_xxxxxxxx" />
      {status && <p>{status}</p>}
    </div>

    {summary && current && <>
      <div className="card" style={{marginTop: 24}}>
        <span className="badge">{summary.organization.status}</span>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <p><strong>{summary.organization.name}</strong> · {summary.plan?.name || 'No plan'} · {summary.subscription?.status || 'No subscription'}</p>
        <div className="cta">
          {summary.currentStep === 'submit_payment' && <a className="btn" href={`/payment?organizationId=${summary.organization.id}`}>سجل إثبات الدفع</a>}
          {summary.aiStudioUrl && <a className="btn" href={summary.aiStudioUrl} target="_blank">Open AI Studio</a>}
          <a className="btn secondary" href="/team">Manage team</a>
        </div>
      </div>



      {summary.pendingUpgrade && <div className="card" style={{marginTop: 16}}>
        <span className="badge">upgrade pending</span>
        <h2>طلب الترقية قيد المراجعة</h2>
        <p>باقتك الحالية مازالت فعالة: <strong>{summary.plan?.name}</strong>. طلب الترقية إلى <strong>{summary.pendingUpgrade.plan.name}</strong> في انتظار مراجعة الأدمن.</p>
        <p>Payment: {summary.pendingUpgrade.payment ? `${summary.pendingUpgrade.payment.status} · ${summary.pendingUpgrade.payment.amountEgp} EGP` : 'لم يتم تسجيل دفع للترقية'} · Approval: {summary.pendingUpgrade.approval?.status || 'open'}</p>
      </div>}

      <div className="grid">
        {steps.map((step, index) => <div className="item" key={step.key}>
          <strong>{index + 1}. {step.title}</strong>
          <p>{step.done ? 'Completed' : 'Pending'}</p>
        </div>)}
      </div>

      <div className="grid">
        <div className="item"><strong>Payment</strong><p>{summary.payment ? `${summary.payment.status} · ${summary.payment.amountEgp} EGP` : 'لم يتم تسجيل دفع بعد'}</p></div>
        <div className="item"><strong>Latest receipt</strong><p>{summary.latestInvoice ? `${summary.latestInvoice.invoiceNumber} · ${summary.latestInvoice.amountEgp} ${summary.latestInvoice.currency} · ${summary.latestInvoice.status}` : 'لم تصدر فاتورة بعد'}</p>{summary.latestInvoice && <a className="btn secondary" href={`${API_BASE}/billing/invoices/${summary.latestInvoice.id}/receipt`} target="_blank">View receipt</a>}</div>
        <div className="item"><strong>Approval</strong><p>{summary.approval?.status || 'لا يوجد طلب مراجعة بعد'}</p></div>
        <div className="item"><strong>Provisioning</strong><p>{summary.provisioningJob ? `${summary.provisioningJob.status} · attempts ${summary.provisioningJob.attempts}` : 'لم يبدأ بعد'}</p></div>
        <div className="item"><strong>Message usage</strong><p>{summary.usage ? `${summary.usage.messagesUsed}/${summary.usage.messageLimit} messages · remaining ${summary.usage.messagesRemaining}` : 'Usage not loaded yet'}</p>{summary.usage?.limitReached && <p>تم الوصول لحد الرسائل الشهري. الرسائل الجديدة لن تُرسل إلى Dify قبل تجديد/ترقية الباقة.</p>}</div>
        <div className="item"><strong>Channel usage</strong><p>{summary.usage ? `${summary.usage.channelsUsed}/${summary.usage.channelLimit} channels · remaining ${summary.usage.channelsRemaining}` : 'Usage not loaded yet'}</p>{summary.usage?.channelLimitReached && <p>تم الوصول لحد القنوات في الباقة. ترقية الباقة مطلوبة لإضافة WhatsApp أو Messenger جديد.</p>}</div>
        {summary.usage?.upgradeRecommendation && <div className="item"><strong>Recommended upgrade</strong><p>رشّحنا باقة {summary.usage.upgradeRecommendation.recommendedPlanName} بسعر {summary.usage.upgradeRecommendation.monthlyPriceEgp} EGP/شهر بسبب {summary.usage.upgradeRecommendation.reason === 'message_limit' ? 'حد الرسائل' : 'حد القنوات'}.</p><a className="btn" href={`/payment?organizationId=${summary.organization.id}&upgradePlanId=${summary.usage.upgradeRecommendation.recommendedPlanId}`}>Upgrade plan</a></div>}
      </div>
    </>}
  </main>
}
