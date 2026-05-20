'use client';

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type ApprovalRow = {
  approval: { id: string; status: string; paymentId: string };
  payment?: { id: string; method: string; amountEgp: number; status: string; reference?: string };
  organization?: { id: string; name: string; status: string };
};

type ProvisioningJobRow = {
  id: string;
  organizationId: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  lastError?: string | null;
  payload?: Record<string, unknown>;
  organization?: { id: string; name: string; status: string; difyTenantId?: string | null; difyAccountId?: string | null };
};

type DifyStatus = {
  mode: 'dry-run' | 'live';
  ready: boolean;
  baseUrl?: string;
  workspaceEndpoint?: string;
  tokenConfigured: boolean;
  requiresExistingDifyOwnerAccount: boolean;
};

export default function AdminPage(){
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [jobs, setJobs] = useState<ProvisioningJobRow[]>([]);
  const [difyStatus, setDifyStatus] = useState<DifyStatus | null>(null);
  const [message, setMessage] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');

  async function loadApprovals(){
    const response = await fetch(`${API_BASE}/admin/approvals`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error('تعذر تحميل طلبات الموافقة. تأكد إن API شغال على port 4000.');
    setRows(await response.json());
  }

  async function loadJobs(){
    const response = await fetch(`${API_BASE}/provisioning/jobs`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error('تعذر تحميل provisioning jobs.');
    setJobs(await response.json());
  }

  async function loadDifyStatus(){
    const response = await fetch(`${API_BASE}/provisioning/dify/status`);
    if (!response.ok) throw new Error('تعذر تحميل حالة Dify gateway.');
    setDifyStatus(await response.json());
  }

  async function refreshAll(){
    if (!adminToken) {
      setMessage('سجل دخول الأدمن الأول.');
      return;
    }
    setMessage('جاري تحميل لوحة الأدمن...');
    try {
      await Promise.all([loadApprovals(), loadJobs(), loadDifyStatus()]);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'حصل خطأ أثناء تحميل لوحة الأدمن');
    }
  }

  async function loginAdmin(){
    setMessage('جاري تسجيل دخول الأدمن...');
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.user?.role !== 'admin') {
      setMessage(data.message || 'بيانات دخول الأدمن غير صحيحة');
      return;
    }
    localStorage.setItem('dify_saas_admin_token', data.token);
    setAdminToken(data.token);
    setMessage('تم تسجيل دخول الأدمن.');
  }

  async function approve(paymentId: string){
    setMessage('جاري اعتماد الدفع وإنشاء provisioning job...');
    const response = await fetch(`${API_BASE}/admin/approvals/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ notes: 'Approved from admin UI' })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.message || 'فشل الاعتماد');
      return;
    }
    setMessage('تم الاعتماد وإنشاء provisioning job.');
    await refreshAll();
  }

  async function runJob(jobId: string){
    setMessage('جاري تشغيل provisioning job...');
    const response = await fetch(`${API_BASE}/provisioning/jobs/${jobId}/run`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message || 'فشل تشغيل provisioning job');
      await refreshAll();
      return;
    }
    setMessage('تم تشغيل provisioning job وتحديث حالة الشركة.');
    await refreshAll();
  }

  async function runDueJobs(){
    setMessage('جاري تشغيل كل provisioning jobs الجاهزة...');
    const response = await fetch(`${API_BASE}/provisioning/jobs/run-due`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message || 'فشل تشغيل jobs الجاهزة');
      await refreshAll();
      return;
    }
    setMessage(`تم تشغيل ${data.processed || 0} job: ${data.completed || 0} نجح، ${data.failed || 0} فشل.`);
    await refreshAll();
  }

  useEffect(() => {
    const savedToken = localStorage.getItem('dify_saas_admin_token');
    if (savedToken) setAdminToken(savedToken);
  }, []);

  useEffect(() => { if (adminToken) void refreshAll(); }, [adminToken]);

  const openApprovals = rows.filter(row => row.approval.status === 'open');
  const runnableJobs = jobs.filter(job => job.status === 'queued' || job.status === 'failed');

  return <main className="shell">
    <h1>Internal Admin</h1>
    <p>مراجعة المدفوعات اليدوية وتشغيل Dify provisioning حسب ملف الخطة.</p>
    <div className="item" style={{marginTop: 20}}>
      <h2>Admin login</h2>
      <input className="input" type="email" value={adminEmail} onChange={event => setAdminEmail(event.target.value)} placeholder="Admin email" />
      <input className="input" type="password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} placeholder="Admin password" />
      <div className="cta">
        <button className="btn" onClick={loginAdmin}>Login</button>
        <button className="btn secondary" onClick={refreshAll} disabled={!adminToken}>Refresh</button>
      </div>
      {adminToken && <p>Admin session active.</p>}
    </div>
    {message && <p>{message}</p>}

    <div className="grid">
      <div className="item"><h3>Open approvals</h3><p>{openApprovals.length} طلب محتاج مراجعة.</p></div>
      <div className="item"><h3>Runnable jobs</h3><p>{runnableJobs.length} job جاهز للتشغيل أو retry.</p></div>
      <div className="item"><h3>Total provisioning</h3><p>{jobs.length} job في النظام.</p></div>
    </div>

    <section style={{marginTop: 32}}>
      <h2>Dify gateway</h2>
      <div className="item">
        {!difyStatus && <p>جاري تحميل حالة Dify...</p>}
        {difyStatus && <>
          <p>Mode: <strong>{difyStatus.mode}</strong> · Ready: {difyStatus.ready ? 'yes' : 'no'} · Token: {difyStatus.tokenConfigured ? 'configured' : 'not required'}</p>
          {difyStatus.baseUrl && <p>Base URL: {difyStatus.baseUrl}</p>}
          {difyStatus.workspaceEndpoint && <p>Workspace endpoint: {difyStatus.workspaceEndpoint}</p>}
          {difyStatus.requiresExistingDifyOwnerAccount && <p>Important: owner email must already exist and be activated inside Dify before running live provisioning.</p>}
        </>}
      </div>
    </section>

    <section style={{marginTop: 32}}>
      <div className="cta" style={{justifyContent: 'space-between', alignItems: 'center'}}>
        <h2>Manual payment approvals</h2>
        <button className="btn secondary" onClick={refreshAll}>Refresh</button>
      </div>
      {openApprovals.length === 0 && <p>لا توجد طلبات موافقة مفتوحة حالياً.</p>}
      {rows.map(row => <div className="item" key={row.approval.id} style={{marginBottom: 12}}>
        <strong>{row.organization?.name || row.approval.id}</strong>
        <p>Payment: {row.payment?.method} — {row.payment?.amountEgp} EGP — {row.payment?.status}</p>
        <p>Reference: {row.payment?.reference || 'No reference'} · Organization status: {row.organization?.status}</p>
        {row.approval.status === 'open' && row.payment && <button className="btn" onClick={() => approve(row.payment!.id)}>Approve payment</button>}
      </div>)}
    </section>

    <section style={{marginTop: 32}}>
      <div className="cta" style={{justifyContent: 'space-between', alignItems: 'center'}}>
        <h2>Provisioning jobs</h2>
        <button className="btn secondary" onClick={runDueJobs} disabled={!adminToken || runnableJobs.length === 0}>Run all ready jobs</button>
      </div>
      {jobs.length === 0 && <p>لا توجد provisioning jobs حتى الآن.</p>}
      {jobs.map(job => <div className="item" key={job.id} style={{marginBottom: 12}}>
        <strong>{job.organization?.name || job.organizationId}</strong>
        <p>Status: {job.status} · Type: {job.type} · Attempts: {job.attempts}</p>
        <p>Organization: {job.organization?.status || 'unknown'} · Tenant: {job.organization?.difyTenantId || 'not mapped yet'}</p>
        {job.lastError && <p>Last error: {job.lastError}</p>}
        {(job.status === 'queued' || job.status === 'failed') && <button className="btn" onClick={() => runJob(job.id)}>{job.status === 'failed' ? 'Retry job' : 'Run job'}</button>}
      </div>)}
    </section>
  </main>
}
