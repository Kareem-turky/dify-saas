type DataDeletionPageProps = {
  searchParams?: Promise<{ confirmation_code?: string }> | { confirmation_code?: string };
};

export default async function DataDeletionPage({ searchParams }: DataDeletionPageProps) {
  const resolvedSearchParams = await searchParams;
  const confirmationCode = resolvedSearchParams?.confirmation_code;

  return (
    <main className="shell">
      <section className="hero glass">
        <span className="eyebrow">Meta compliance</span>
        <h1>Data Deletion / حذف البيانات</h1>
        <p className="muted">
          This page explains how customers and Meta users can request deletion of data processed by the Dify SaaS Platform.
          تعرض هذه الصفحة طريقة طلب حذف بيانات المستخدمين المرتبطة بتكامل Meta وWhatsApp/Messenger.
        </p>
      </section>

      <section className="grid two-cols">
        <div className="card">
          <h2>For Meta App Review</h2>
          <p>
            Configure the Meta Data Deletion Callback URL to point to the API endpoint below. The endpoint validates Meta
            <code> signed_request </code> using the app secret and returns a non-sensitive confirmation_code tracking link.
          </p>
          <pre className="code-block">POST /meta/data-deletion</pre>
          {confirmationCode ? (
            <p className="status-pill success">confirmation_code: {confirmationCode}</p>
          ) : (
            <p className="status-pill warning">No confirmation_code was provided in the current URL.</p>
          )}
        </div>

        <div className="card" dir="rtl">
          <h2>طلب حذف البيانات</h2>
          <p>
            لو كنت عميل أو مستخدم نهائي وتريد حذف بياناتك، أرسل طلب حذف من بريدك المسجل مع اسم الشركة ورقم التأكيد إن وجد.
            سيتم حذف أو إخفاء بيانات التكامل والرسائل طبقًا للمتطلبات القانونية والتشغيلية.
          </p>
          <ul className="checklist">
            <li>اسم الشركة أو الصفحة المرتبطة</li>
            <li>البريد أو رقم الهاتف المستخدم في التسجيل</li>
            <li>confirmation_code لو الطلب صادر من Meta</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
