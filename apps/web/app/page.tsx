import Link from 'next/link';

const metrics = [
  ['Customer portal', 'Signup, login, payment proof, dashboard, team, integrations'],
  ['Admin ops', 'Approvals, provisioning jobs, readiness, audit logs'],
  ['AI Studio handoff', 'White-labeled Dify workspace per approved customer']
];

export default function HomePage(){
  return <main className="shell">
    <nav className="nav">
      <div className="brand">Fulfly AI</div>
      <div className="links"><Link href="/signup">ابدأ الآن</Link><Link href="/login">Login</Link><Link href="/dashboard">Dashboard</Link><Link href="/admin">Admin</Link></div>
    </nav>

    <section className="hero">
      <div>
        <span className="badge">Production-ready MVP · Powered by Dify AI Studio</span>
        <h1>منصة AI SaaS جاهزة للعرض والتشغيل التجريبي</h1>
        <p>بوابة عربية/إنجليزية لإدارة العملاء، الباقات، الدفع اليدوي، موافقات الأدمن، provisioning لمساحات Dify، وربط WhatsApp/Messenger من مكان واحد.</p>
        <div className="cta"><Link className="btn" href="/signup">جرّب رحلة العميل</Link><Link className="btn secondary" href="/admin">افتح لوحة الأدمن</Link></div>
      </div>
      <div className="card glass">
        <span className="status-pill good">MVP flow live</span>
        <h2>Customer → Payment → Approval → AI Studio</h2>
        <p>كل شريحة أساسية متوصلة: auth، dashboard، invoices، readiness، backups، background provisioning worker.</p>
      </div>
    </section>

    <section className="grid">
      {metrics.map(([title, body]) => <div className="item metric" key={title}><h3>{title}</h3><p>{body}</p></div>)}
    </section>

    <section className="card" style={{marginTop: 32}}>
      <div className="section-title"><span>What is ready now</span><span className="status-pill good">demoable</span></div>
      <div className="grid">
        <div className="item"><strong>Billing</strong><p>Manual proof review plus invoices and receipt endpoint.</p></div>
        <div className="item"><strong>Reliability</strong><p>Redis-ready rate limits, retries, worker, health/readiness, backup scripts.</p></div>
        <div className="item"><strong>Operations</strong><p>Admin command center for approvals, jobs, audit logs, and queue health.</p></div>
      </div>
    </section>
  </main>
}
