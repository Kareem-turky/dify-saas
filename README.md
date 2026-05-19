# Dify SaaS Platform

منصة SaaS خارجية مستقلة مبنية حول Dify حسب ملف `docs/Dify_SaaS_Full_Integration_Architecture_AR.md`.

## الهدف الحالي

تنفيذ Phase 1 + بداية Phase 2 بدون تعديل نسخة Dify الحالية:

- Landing/Pricing/Signup.
- Organizations + plans + subscriptions.
- Manual payments: InstaPay/Vodafone Cash/bank transfer proof upload metadata.
- Admin approvals.
- Provisioning job framework لإنشاء Dify workspace لاحقًا بعد الموافقة.
- صفحات أساسية للعميل والأدمن والتكاملات.

## التشغيل

```bash
pnpm install
pnpm --filter @dify-saas/api test
pnpm --filter @dify-saas/api start:dev
pnpm --filter @dify-saas/web dev
```

## ملاحظات معمارية

- هذا المشروع منفصل عن `/Users/mac/dify` حتى لا نكسر نسخة Dify الحالية.
- Dify سيظل AI Studio مدمج/white-label، والمنصة هنا مسؤولة عن التسجيل، الدفع، الموافقات، Meta channels، والـ provisioning.
- الـ provisioning jobs حالياً queue داخلية قابلة للاستبدال بـ BullMQ/Redis في المرحلة القادمة.
