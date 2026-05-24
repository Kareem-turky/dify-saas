'use client';

import { useEffect, useState } from 'react';
import { useAuth, RequireAuth } from '../auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

// ─── Types ───────────────────────────────────────────────────
type Plan = {
  id: string; name: string; monthlyPriceEgp: number; messageLimit: number;
  channelLimit: number; seatLimit: number; requiresManualApproval: boolean;
};

type UserRow = {
  id: string; name: string; email: string; phone?: string; role: string; status: string;
  preferredLanguage: string; organization?: { id: string; name: string; status: string } | null;
  createdAt: string;
};

type ContentBlock = {
  id: string; key: string; value: string; type: string; updatedAt: string;
};

type ApprovalRow = {
  approval: { id: string; status: string; paymentId: string };
  payment?: { id: string; method: string; amountEgp: number; status: string; reference?: string };
  organization?: { id: string; name: string; status: string };
};

type ProvisioningJobRow = {
  id: string; organizationId: string; type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'dead';
  attempts: number; maxAttempts?: number; nextRunAt?: string | null; lastError?: string | null;
  organization?: { id: string; name: string; status: string; difyTenantId?: string | null };
};

type DifyStatus = {
  mode: 'dry-run' | 'live'; ready: boolean; baseUrl?: string; tokenConfigured: boolean;
};

type AuditLogRow = {
  id: string; actorUserId?: string | null; organizationId?: string | null;
  action: string; targetType?: string | null; targetId?: string | null;
  metadata?: Record<string, unknown> | null; createdAt: string;
  actorUser?: { id: string; email: string; name: string } | null;
  organization?: { id: string; name: string } | null;
};

type MessageEventSummary = {
  totals: Record<string, number>; byChannel: Record<string, Record<string, number>>;
  retryableFailed: number; deadLettered: number; oldestFailedAt?: string | null;
};

type Tab = 'overview' | 'plans' | 'users' | 'content' | 'approvals' | 'jobs' | 'logs';

// ─── Component ───────────────────────────────────────────────
export default function AdminPage() {
  return <RequireAuth><AdminDashboard /></RequireAuth>;
}

function AdminDashboard() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [message, setMessage] = useState('');

  // Data states
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [jobs, setJobs] = useState<ProvisioningJobRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [difyStatus, setDifyStatus] = useState<DifyStatus | null>(null);
  const [messageSummary, setMessageSummary] = useState<MessageEventSummary | null>(null);

  // Form states
  const [planForm, setPlanForm] = useState<Partial<Plan>>({ name: '', monthlyPriceEgp: 0, messageLimit: 1000, channelLimit: 1, seatLimit: 1, requiresManualApproval: false });
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [contentForm, setContentForm] = useState({ key: '', value: '' });
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');

  // ─── API helpers ─────────────────────────────────────────────
  const authHeaders = { Authorization: `Bearer ${token}` };
  const api = {
    get: (url: string) => fetch(`${API_BASE}${url}`, { headers: authHeaders }),
    post: (url: string, body: unknown) => fetch(`${API_BASE}${url}`, { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    put: (url: string, body: unknown) => fetch(`${API_BASE}${url}`, { method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    del: (url: string) => fetch(`${API_BASE}${url}`, { method: 'DELETE', headers: authHeaders }),
  };

  // ─── Loaders ─────────────────────────────────────────────────
  async function loadPlans() { const r = await api.get('/plans'); if (r.ok) setPlans(await r.json()); }
  async function loadUsers() { const r = await api.get('/admin/users'); if (r.ok) setUsers(await r.json()); }
  async function loadContent() { const r = await api.get('/admin/content'); if (r.ok) setContentBlocks(await r.json()); }
  async function loadApprovals() { const r = await api.get('/admin/approvals'); if (r.ok) setApprovals(await r.json()); }
  async function loadJobs() { const r = await api.get('/provisioning/jobs'); if (r.ok) setJobs(await r.json()); }
  async function loadAuditLogs() { const r = await api.get('/admin/audit-logs'); if (r.ok) setAuditLogs(await r.json()); }
  async function loadDifyStatus() { const r = await api.get('/provisioning/dify/status'); if (r.ok) setDifyStatus(await r.json()); }
  async function loadMessageSummary() { const r = await api.get('/admin/message-events/summary'); if (r.ok) setMessageSummary(await r.json()); }

  async function refreshAll() {
    if (!token) return;
    setMessage('');
    try {
      await Promise.all([loadPlans(), loadUsers(), loadContent(), loadApprovals(), loadJobs(), loadAuditLogs(), loadDifyStatus(), loadMessageSummary()]);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'خطأ في تحميل البيانات'); }
  }



  // ─── Plan actions ────────────────────────────────────────────
  async function savePlan() {
    if (!planForm.name || !planForm.monthlyPriceEgp) { setMessage('املأ كل الحقول المطلوبة'); return; }
    const payload = { name: planForm.name, monthlyPriceEgp: Number(planForm.monthlyPriceEgp), messageLimit: Number(planForm.messageLimit), channelLimit: Number(planForm.channelLimit), seatLimit: Number(planForm.seatLimit), requiresManualApproval: !!planForm.requiresManualApproval };
    if (editingPlan) {
      await api.put(`/admin/plans/${editingPlan}`, payload);
    } else {
      await api.post('/admin/plans', payload);
    }
    setPlanForm({ name: '', monthlyPriceEgp: 0, messageLimit: 1000, channelLimit: 1, seatLimit: 1, requiresManualApproval: false });
    setEditingPlan(null);
    await loadPlans();
  }

  async function deletePlan(id: string) {
    if (!confirm('متأكد إنك عايز تحذف الخطة دي؟')) return;
    const r = await api.del(`/admin/plans/${id}`);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMessage(d.message || 'فشل الحذف'); }
    await loadPlans();
  }

  function startEditPlan(plan: Plan) {
    setEditingPlan(plan.id);
    setPlanForm({ ...plan });
  }

  // ─── User actions ────────────────────────────────────────────
  async function updateUser(userId: string, updates: { role?: string; status?: string }) {
    await api.put(`/admin/users/${userId}`, updates);
    await loadUsers();
  }

  // ─── Content actions ─────────────────────────────────────────
  async function saveContent() {
    if (!contentForm.key || !contentForm.value) { setMessage('املأ المفتاح والقيمة'); return; }
    await api.put(`/admin/content/${contentForm.key}`, { value: contentForm.value });
    setContentForm({ key: '', value: '' });
    setEditingContent(null);
    await loadContent();
  }

  async function deleteContent(key: string) {
    if (!confirm('متأكد إنك عايز تحذف المحتوى ده؟')) return;
    await api.del(`/admin/content/${key}`);
    await loadContent();
  }

  function startEditContent(block: ContentBlock) {
    setEditingContent(block.key);
    setContentForm({ key: block.key, value: block.value });
  }

  // ─── Ops actions ─────────────────────────────────────────────
  async function approve(paymentId: string) {
    await api.post(`/admin/approvals/${paymentId}/approve`, { notes: 'Approved from admin UI' });
    await refreshAll();
  }

  async function runJob(jobId: string) {
    await api.post(`/provisioning/jobs/${jobId}/run`, {});
    await loadJobs();
  }

  async function retryFailedMessages() {
    const r = await api.post('/admin/message-events/retry-failed', { limit: 10 });
    const d = await r.json().catch(() => ({}));
    setMessage(`تمت محاولة ${d.attempted || 0} رسالة`);
    await loadMessageSummary();
  }

  // ─── Init ────────────────────────────────────────────────────
  useEffect(() => { if (token) void refreshAll(); }, [token]);

  const openApprovals = approvals.filter(r => r.approval.status === 'open');
  const failedJobs = jobs.filter(j => j.status === 'failed' || j.status === 'dead');
  const filteredUsers = userFilter
    ? users.filter(u => u.name.includes(userFilter) || u.email.includes(userFilter) || u.organization?.name?.includes(userFilter))
    : users;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: '📊' },
    { key: 'plans', label: 'خطط التسعير', icon: '💰' },
    { key: 'users', label: 'المستخدمين', icon: '👥' },
    { key: 'content', label: 'إدارة المحتوى', icon: '📝' },
    { key: 'approvals', label: 'الموافقات', icon: '✅' },
    { key: 'jobs', label: 'Provisioning', icon: '⚙️' },
    { key: 'logs', label: 'سجل الأحداث', icon: '📋' },
  ];

  // ─── Render ──────────────────────────────────────────────────
  return <main className="shell admin-shell">
    {/* Header */}
    <div className="section-title">
      <span>لوحة تحكم الإدارة</span>
      <span className="status-pill good">نظام التشغيل</span>
    </div>


    {message && <p style={{ color: 'var(--warn)', margin: '12px 0' }}>{message}</p>}

    <>
      {/* Tab Navigation */}
      <nav className="admin-tabs">
        {tabs.map(t => (
          <button key={t.key} className={`admin-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span>{t.icon}</span> {t.label}
            {t.key === 'approvals' && openApprovals.length > 0 && <span className="badge-count">{openApprovals.length}</span>}
          </button>
        ))}
        <button className="admin-tab" onClick={refreshAll} style={{ marginRight: 'auto' }}>🔄 تحديث</button>
      </nav>

      {/* ── Overview Tab ─────────────────────────────────── */}
      {tab === 'overview' && <>
        <div className="grid admin-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="item metric">
            <h3>المستخدمين</h3>
            <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)' }}>{users.length}</p>
            <p>{users.filter(u => u.role === 'customer').length} عميل · {users.filter(u => u.role === 'admin').length} أدمن</p>
          </div>
          <div className="item metric">
            <h3>الموافقات المفتوحة</h3>
            <p style={{ fontSize: 28, fontWeight: 900, color: openApprovals.length > 0 ? 'var(--warn)' : 'var(--good)' }}>{openApprovals.length}</p>
            <p>طلبات محتاجة مراجعة</p>
          </div>
          <div className="item metric">
            <h3>الخطط النشطة</h3>
            <p style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)' }}>{plans.length}</p>
            <p>خطة تسعير متاحة</p>
          </div>
          <div className="item metric">
            <h3>رسائل فاشلة</h3>
            <p style={{ fontSize: 28, fontWeight: 900, color: (messageSummary?.retryableFailed ?? 0) > 0 ? 'var(--bad)' : 'var(--good)' }}>{messageSummary?.retryableFailed ?? 0}</p>
            <button className="btn secondary" onClick={retryFailedMessages} style={{ marginTop: 8, fontSize: 13 }}>إعادة المحاولة</button>
          </div>
          <div className="item metric">
            <h3>Provisioning</h3>
            <p style={{ fontSize: 28, fontWeight: 900, color: failedJobs.length > 0 ? 'var(--bad)' : 'var(--good)' }}>{failedJobs.length} فشل</p>
            <p>Jobs: {jobs.length} · فاشلة: {failedJobs.length}</p>
          </div>
          <div className="item metric">
            <h3>Dify Gateway</h3>
            <p style={{ fontSize: 16 }}>{difyStatus ? `${difyStatus.mode} · ${difyStatus.ready ? '✅ جاهز' : '❌ مش جاهز'}` : '—'}</p>
            <p>Token: {difyStatus?.tokenConfigured ? '✅' : '❌'}</p>
          </div>
        </div>

        <div className="item" style={{ marginTop: 24 }}>
          <h3>محتوى الموقع</h3>
          <p>{contentBlocks.length} بلوك محتوى متخزن</p>
          {contentBlocks.slice(0, 5).map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--brand2)' }}>{b.key}</span>
              <span style={{ color: 'var(--muted)', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.value}</span>
            </div>
          ))}
        </div>
      </>}

      {/* ── Plans Tab ────────────────────────────────────── */}
      {tab === 'plans' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>خطط التسعير</span></div>

        {/* Plan Form */}
        <div className="item" style={{ marginBottom: 20 }}>
          <h3>{editingPlan ? 'تعديل خطة' : 'إضافة خطة جديدة'}</h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>اسم الخطة</label>
              <input className="input" value={planForm.name || ''} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} placeholder="مثلاً: Enterprise" />
            </div>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>السعر الشهري (جنيه)</label>
              <input className="input" type="number" value={planForm.monthlyPriceEgp || ''} onChange={e => setPlanForm({ ...planForm, monthlyPriceEgp: Number(e.target.value) })} />
            </div>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>حد الرسائل الشهري</label>
              <input className="input" type="number" value={planForm.messageLimit || ''} onChange={e => setPlanForm({ ...planForm, messageLimit: Number(e.target.value) })} />
            </div>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>حد القنوات</label>
              <input className="input" type="number" value={planForm.channelLimit || ''} onChange={e => setPlanForm({ ...planForm, channelLimit: Number(e.target.value) })} />
            </div>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>حد المستخدمين</label>
              <input className="input" type="number" value={planForm.seatLimit || ''} onChange={e => setPlanForm({ ...planForm, seatLimit: Number(e.target.value) })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'end', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 14 }}>
                <input type="checkbox" checked={!!planForm.requiresManualApproval} onChange={e => setPlanForm({ ...planForm, requiresManualApproval: e.target.checked })} />
                موافقة يدوية
              </label>
            </div>
          </div>
          <div className="cta">
            <button className="btn" onClick={savePlan}>{editingPlan ? 'حفظ التعديلات' : 'إضافة الخطة'}</button>
            {editingPlan && <button className="btn secondary" onClick={() => { setEditingPlan(null); setPlanForm({ name: '', monthlyPriceEgp: 0, messageLimit: 1000, channelLimit: 1, seatLimit: 1, requiresManualApproval: false }); }}>إلغاء</button>}
          </div>
        </div>

        {/* Plans Table */}
        <div className="item">
          <table className="admin-table">
            <thead>
              <tr><th>الخطة</th><th>السعر</th><th>الرسائل</th><th>القنوات</th><th>المستخدمين</th><th>موافقة</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{p.id}</span></td>
                  <td>{p.monthlyPriceEgp.toLocaleString()} ج.م</td>
                  <td>{p.messageLimit.toLocaleString()}</td>
                  <td>{p.channelLimit}</td>
                  <td>{p.seatLimit}</td>
                  <td>{p.requiresManualApproval ? '✅' : '❌'}</td>
                  <td>
                    <button className="btn secondary" onClick={() => startEditPlan(p)} style={{ fontSize: 12, padding: '6px 12px' }}>تعديل</button>
                    <button className="btn secondary" onClick={() => deletePlan(p.id)} style={{ fontSize: 12, padding: '6px 12px', marginRight: 6, borderColor: 'var(--bad)', color: '#fca5a5' }}>حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {plans.length === 0 && <p style={{ textAlign: 'center', padding: 32 }}>لا توجد خطط تسعير</p>}
        </div>
      </section>}

      {/* ── Users Tab ────────────────────────────────────── */}
      {tab === 'users' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>إدارة المستخدمين</span><span className="status-pill good">{users.length} مستخدم</span></div>

        <input className="input" placeholder="بحث بالاسم أو البريد أو الشركة..." value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ marginBottom: 16 }} />

        <div className="item">
          <table className="admin-table">
            <thead>
              <tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>الشركة</th><th>التسجيل</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id} style={{ opacity: u.status === 'suspended' ? 0.5 : 1 }}>
                  <td><strong>{u.name}</strong></td>
                  <td style={{ fontSize: 13 }}>{u.email}</td>
                  <td>
                    <span className={`status-pill ${u.role === 'admin' ? 'good' : ''}`} style={{ fontSize: 11, padding: '4px 10px' }}>
                      {u.role === 'admin' ? 'أدمن' : u.role === 'support' ? 'دعم' : 'عميل'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill ${u.status === 'active' ? 'good' : u.status === 'suspended' ? 'bad' : ''}`} style={{ fontSize: 11, padding: '4px 10px' }}>
                      {u.status === 'active' ? 'نشط' : u.status === 'suspended' ? 'معلق' : u.status}
                    </span>
                  </td>
                  <td>{u.organization?.name || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(u.createdAt).toLocaleDateString('ar-EG')}</td>
                  <td>
                    {u.role !== 'admin' && <>
                      {u.status === 'active'
                        ? <button className="btn secondary" onClick={() => updateUser(u.id, { status: 'suspended' })} style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--bad)', color: '#fca5a5' }}>تعليق</button>
                        : <button className="btn secondary" onClick={() => updateUser(u.id, { status: 'active' })} style={{ fontSize: 11, padding: '4px 10px' }}>تفعيل</button>
                      }
                      {u.role === 'customer' && <button className="btn secondary" onClick={() => updateUser(u.id, { role: 'support' })} style={{ fontSize: 11, padding: '4px 10px', marginRight: 4 }}>دعم</button>}
                      {u.role === 'support' && <button className="btn secondary" onClick={() => updateUser(u.id, { role: 'customer' })} style={{ fontSize: 11, padding: '4px 10px', marginRight: 4 }}>عميل</button>}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredUsers.length === 0 && <p style={{ textAlign: 'center', padding: 32 }}>لا توجد نتائج</p>}
        </div>
      </section>}

      {/* ── Content Tab ──────────────────────────────────── */}
      {tab === 'content' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>إدارة المحتوى</span><span className="status-pill good">{contentBlocks.length} بلوك</span></div>

        {/* Content Form */}
        <div className="item" style={{ marginBottom: 20 }}>
          <h3>{editingContent ? 'تعديل محتوى' : 'إضافة محتوى جديد'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 12 }}>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>المفتاح (key)</label>
              <input className="input" value={contentForm.key} onChange={e => setContentForm({ ...contentForm, key: e.target.value })} placeholder="مثلاً: hero_title" disabled={!!editingContent} />
            </div>
            <div>
              <label style={{ color: 'var(--muted)', fontSize: 13 }}>القيمة</label>
              <textarea className="input" rows={3} value={contentForm.value} onChange={e => setContentForm({ ...contentForm, value: e.target.value })} placeholder="النص أو المحتوى..." style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="cta">
            <button className="btn" onClick={saveContent}>{editingContent ? 'حفظ' : 'إضافة'}</button>
            {editingContent && <button className="btn secondary" onClick={() => { setEditingContent(null); setContentForm({ key: '', value: '' }); }}>إلغاء</button>}
          </div>
        </div>

        {/* Content List */}
        {contentBlocks.map(b => (
          <div className="item" key={b.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <strong style={{ color: 'var(--brand2)' }}>{b.key}</strong>
                <span style={{ color: 'var(--muted)', fontSize: 12, marginRight: 12 }}>{b.type} · آخر تحديث: {new Date(b.updatedAt).toLocaleDateString('ar-EG')}</span>
                <p style={{ marginTop: 6 }}>{b.value}</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn secondary" onClick={() => startEditContent(b)} style={{ fontSize: 12, padding: '6px 12px' }}>تعديل</button>
                <button className="btn secondary" onClick={() => deleteContent(b.key)} style={{ fontSize: 12, padding: '6px 12px', borderColor: 'var(--bad)', color: '#fca5a5' }}>حذف</button>
              </div>
            </div>
          </div>
        ))}
        {contentBlocks.length === 0 && <div className="item"><p style={{ textAlign: 'center', padding: 32 }}>لا يوجد محتوى بعد. أضف بلوكات زي hero_title و hero_subtitle و footer_text</p></div>}
      </section>}

      {/* ── Approvals Tab ────────────────────────────────── */}
      {tab === 'approvals' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>طلبات الموافقة</span><span className={`status-pill ${openApprovals.length > 0 ? 'warn' : 'good'}`}>{openApprovals.length} مفتوحة</span></div>
        {approvals.length === 0 && <div className="item"><p>لا توجد طلبات موافقة</p></div>}
        {approvals.map(row => <div className="item" key={row.approval.id} style={{ marginBottom: 12 }}>
          <strong>{row.organization?.name || row.approval.id}</strong>
          <p>الدفع: {row.payment?.method} — {row.payment?.amountEgp?.toLocaleString()} ج.م — {row.payment?.status}</p>
          <p>المرجع: {row.payment?.reference || 'بدون'} · حالة الشركة: {row.organization?.status}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <span className={`status-pill ${row.approval.status === 'open' ? 'warn' : 'good'}`} style={{ fontSize: 11, padding: '4px 10px' }}>
              {row.approval.status === 'open' ? 'مفتوحة' : 'تمت المراجعة'}
            </span>
            {row.approval.status === 'open' && row.payment && <button className="btn" onClick={() => approve(row.payment!.id)} style={{ fontSize: 12 }}>اعتماد الدفع</button>}
          </div>
        </div>)}
      </section>}

      {/* ── Jobs Tab ─────────────────────────────────────── */}
      {tab === 'jobs' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>مهام التجهيز</span><span className={`status-pill ${failedJobs.length > 0 ? 'bad' : 'good'}`}>{jobs.length} مهمة · {failedJobs.length} فاشل</span></div>
        {jobs.length === 0 && <div className="item"><p>لا توجد provisioning jobs</p></div>}
        {jobs.map(job => <div className="item" key={job.id} style={{ marginBottom: 12 }}>
          <strong>{job.organization?.name || job.organizationId}</strong>
          <p>الحالة: <span className={`status-pill ${job.status === 'completed' ? 'good' : job.status === 'failed' ? 'bad' : 'warn'}`} style={{ fontSize: 11, padding: '2px 8px' }}>{job.status}</span> · النوع: {job.type} · المحاولات: {job.attempts}/{job.maxAttempts || 3}</p>
          <p>الشركة: {job.organization?.status} · Tenant: {job.organization?.difyTenantId || 'لم يُنشأ بعد'}</p>
          {job.lastError && <p style={{ color: 'var(--bad)', fontSize: 13 }}>خطأ: {job.lastError}</p>}
          {(job.status === 'queued' || job.status === 'failed') && <button className="btn" onClick={() => runJob(job.id)} style={{ fontSize: 12, marginTop: 8 }}>{job.status === 'failed' ? 'إعادة المحاولة' : 'تشغيل'}</button>}
        </div>)}
      </section>}

      {/* ── Audit Logs Tab ───────────────────────────────── */}
      {tab === 'logs' && <section style={{ marginTop: 24 }}>
        <div className="section-title"><span>سجل الأحداث</span><span className="status-pill good">{auditLogs.length} حدث</span></div>
        {auditLogs.length === 0 && <div className="item"><p>لا توجد أحداث مسجلة</p></div>}
        {auditLogs.slice(0, 50).map(log => <div className="item" key={log.id} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{log.action}</strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(log.createdAt).toLocaleString('ar-EG')}</span>
          </div>
          <p style={{ fontSize: 13 }}>بواسطة: {log.actorUser?.email || 'system'} · الشركة: {log.organization?.name || '—'} · الهدف: {log.targetType || '—'} / {log.targetId || '—'}</p>
        </div>)}
      </section>}
    </>
  </main>;
}
