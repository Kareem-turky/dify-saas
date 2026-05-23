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
  status: 'queued' | 'running' | 'completed' | 'failed' | 'dead';
  attempts: number;
  maxAttempts?: number;
  nextRunAt?: string | null;
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

type MessageEventSummary = {
  totals: Record<string, number>;
  byChannel: Record<string, Record<string, number>>;
  retryableFailed: number;
  deadLettered: number;
  oldestFailedAt?: string | null;
};

type ReadinessStatus = {
  ok: boolean;
  checkedAt: string;
  checks: {
    database: { ok: boolean; latencyMs: number };
    adminUser: { ok: boolean; configured: boolean };
    authTokenSecret: { ok: boolean; configured: boolean };
    paymentProofStorage: { ok: boolean; pathConfigured: boolean };
    difyGateway: { ok: boolean; mode: string; tokenConfigured: boolean };
    provisioningWorker: { enabled?: boolean; running?: boolean; lastError?: string | null };
  };
};

type AuditLogRow = {
  id: string;
  actorUserId?: string | null;
  organizationId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  actorUser?: { id: string; email: string; name: string } | null;
  organization?: { id: string; name: string } | null;
};

export default function AdminPage(){
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [jobs, setJobs] = useState<ProvisioningJobRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [messageSummary, setMessageSummary] = useState<MessageEventSummary | null>(null);
  const [difyStatus, setDifyStatus] = useState<DifyStatus | null>(null);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [message, setMessage] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'open' | 'approved' | 'blocked'>('all');

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

  async function loadAuditLogs(){
    const response = await fetch(`${API_BASE}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error('تعذر تحميل audit logs.');
    setAuditLogs(await response.json());
  }

  async function loadMessageSummary(){
    const response = await fetch(`${API_BASE}/admin/message-events/summary`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error('تعذر تحميل message queue summary.');
    setMessageSummary(await response.json());
  }

  async function loadReadiness(){
    const response = await fetch(`${API_BASE}/admin/readiness`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error('تعذر تحميل readiness checks.');
    setReadiness(await response.json());
  }

  async function refreshAll(){
    if (!adminToken) {
      setMessage('سجل دخول الأدمن الأول.');
      return;
    }
    setMessage('جاري تحميل لوحة الأدمن...');
    try {
      await Promise.all([loadApprovals(), loadJobs(), loadDifyStatus(), loadAuditLogs(), loadMessageSummary(), loadReadiness()]);
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

  async function retryFailedMessages(){
    setMessage('جاري إعادة محاولة رسائل WhatsApp/Dify الفاشلة...');
    const response = await fetch(`${API_BASE}/admin/message-events/retry-failed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ limit: 10 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message || 'فشل retry للرسائل الفاشلة');
      await refreshAll();
      return;
    }
    setMessage(`تمت محاولة ${data.attempted || 0} رسالة: ${data.retried || 0} نجحت، ${data.failed || 0} فشلت، ${data.skippedNotDue || 0} مؤجلة، ${data.deadLettered || 0} dead-letter.`);
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
  const reviewedApprovals = rows.filter(row => row.approval.status !== 'open');
  const failedJobs = jobs.filter(job => job.status === 'failed' || job.status === 'dead');
  const runnableJobs = jobs.filter(job => job.status === 'queued' || job.status === 'failed');
  const filteredApprovals = rows.filter(row => {
    if (reviewFilter === 'all') return true;
    if (reviewFilter === 'open') return row.approval.status === 'open';
    if (reviewFilter === 'approved') return row.approval.status !== 'open';
    return row.payment?.status === 'rejected' || row.organization?.status === 'suspended';
  });
  const liveRiskCount = failedJobs.length + (messageSummary?.retryableFailed ?? 0) + (readiness?.ok === false ? 1 : 0);
  const provisioningSlaLabel = failedJobs.length === 0 ? 'On track' : `${failedJobs.length} تحتاج تدخل`;

  return <main className="shell admin-shell">
    <div className="section-title"><span>Ops command center</span><span className="status-pill good">admin console</span></div>
    <section className="item glass admin-hero">
      <div>
        <span className="status-pill good">Admin cockpit</span>
        <h1>لوحة تحكم الأدمن</h1>
        <p>مراجعة المدفوعات اليدوية، تشغيل Dify provisioning، متابعة readiness، audit logs، وmessage retries من شاشة واحدة.</p>
      </div>
      <div className="ops-checklist">
        <strong>Today operator checklist</strong>
        <span>1. راجع المدفوعات المفتوحة</span>
        <span>2. شغّل jobs الجاهزة</span>
        <span>3. راقب live risks قبل العرض</span>
      </div>
    </section>
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

    <div className="grid admin-dashboard-grid">
      <div className="item metric"><h3>Open approvals</h3><p>{openApprovals.length} طلب محتاج مراجعة.</p></div>
      <div className="item metric"><h3>Revenue reviewed</h3><p>{reviewedApprovals.length} دفعة اتراجعت.</p></div>
      <div className="item metric"><h3>Provisioning SLA</h3><p>{provisioningSlaLabel} · {runnableJobs.length} job جاهز.</p></div>
      <div className="item metric"><h3>Live risk monitor</h3><p>{liveRiskCount} risk signal · {messageSummary?.deadLettered ?? 0} dead-letter.</p><button className="btn secondary" onClick={retryFailedMessages} disabled={!adminToken}>Retry failed messages</button></div>
    </div>

    <section style={{marginTop: 32}}>
      <div className="section-title"><span>Production readiness</span><span className={readiness?.ok ? 'status-pill good' : 'status-pill warn'}>{readiness?.ok ? 'ready' : 'needs review'}</span></div>
      <div className="grid">
        <div className="item metric"><strong>Overall</strong><p>{readiness ? (readiness.ok ? 'Ready' : 'Needs attention') : 'Not loaded'}</p></div>
        <div className="item metric"><strong>Database</strong><p>{readiness ? `${readiness.checks.database.ok ? 'OK' : 'Fail'} · ${readiness.checks.database.latencyMs}ms` : 'Not loaded'}</p></div>
        <div className="item metric"><strong>Admin/Auth</strong><p>{readiness ? `admin ${readiness.checks.adminUser.ok ? 'OK' : 'missing'} · secret ${readiness.checks.authTokenSecret.configured ? 'configured' : 'missing'}` : 'Not loaded'}</p></div>
        <div className="item metric"><strong>Storage/Worker</strong><p>{readiness ? `proof storage ${readiness.checks.paymentProofStorage.ok ? 'OK' : 'fail'} · worker ${readiness.checks.provisioningWorker.enabled ? 'enabled' : 'disabled'}${readiness.checks.provisioningWorker.running ? ' · running' : ''}` : 'Not loaded'}</p></div>
      </div>
    </section>

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
      <div className="cta" style={{marginBottom: 12}}>
        <button className={reviewFilter === 'all' ? 'btn' : 'btn secondary'} onClick={() => setReviewFilter('all')}>All reviews</button>
        <button className={reviewFilter === 'open' ? 'btn' : 'btn secondary'} onClick={() => setReviewFilter('open')}>Open only</button>
        <button className={reviewFilter === 'approved' ? 'btn' : 'btn secondary'} onClick={() => setReviewFilter('approved')}>Reviewed</button>
        <button className={reviewFilter === 'blocked' ? 'btn' : 'btn secondary'} onClick={() => setReviewFilter('blocked')}>Blocked</button>
      </div>
      {openApprovals.length === 0 && <p>لا توجد طلبات موافقة مفتوحة حالياً.</p>}
      {filteredApprovals.map(row => <div className="item" key={row.approval.id} style={{marginBottom: 12}}>
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
        <p>Status: {job.status} · Type: {job.type} · Attempts: {job.attempts}/{job.maxAttempts || 3}</p>
        <p>Organization: {job.organization?.status || 'unknown'} · Tenant: {job.organization?.difyTenantId || 'not mapped yet'}</p>
        {job.nextRunAt && <p>Next retry: {new Date(job.nextRunAt).toLocaleString()}</p>}
        {job.lastError && <p>Last error: {job.lastError}</p>}
        {(job.status === 'queued' || job.status === 'failed') && <button className="btn" onClick={() => runJob(job.id)}>{job.status === 'failed' ? 'Retry job' : 'Run job'}</button>}
      </div>)}
    </section>

    <section style={{marginTop: 32}}>
      <h2>Channel message queue monitoring</h2>
      <div className="item">
        <p>يراقب failed/retryable/dead-letter inbound events لقنوات WhatsApp وMessenger قبل hardening الإنتاج.</p>
        <p>Retryable failed: <strong>{messageSummary?.retryableFailed ?? 0}</strong> · Dead-letter: <strong>{messageSummary?.deadLettered ?? 0}</strong></p>
        {messageSummary?.oldestFailedAt && <p>Oldest failed: {new Date(messageSummary.oldestFailedAt).toLocaleString()}</p>}
        <p>WhatsApp: {JSON.stringify(messageSummary?.byChannel?.whatsapp || {})}</p>
        <p>Messenger: {JSON.stringify(messageSummary?.byChannel?.messenger || {})}</p>
        <button className="btn" onClick={retryFailedMessages} disabled={!adminToken}>Retry due failed messages</button>
      </div>
    </section>

    <section style={{marginTop: 32}}>
      <h2>Audit logs</h2>
      {auditLogs.length === 0 && <p>لا توجد audit logs حتى الآن.</p>}
      {auditLogs.slice(0, 20).map(log => <div className="item" key={log.id} style={{marginBottom: 12}}>
        <strong>{log.action}</strong>
        <p>{new Date(log.createdAt).toLocaleString()} · Actor: {log.actorUser?.email || log.actorUserId || 'system'} · Org: {log.organization?.name || log.organizationId || 'n/a'}</p>
        <p>Target: {log.targetType || 'n/a'} · {log.targetId || 'n/a'}</p>
      </div>)}
    </section>
  </main>
}
