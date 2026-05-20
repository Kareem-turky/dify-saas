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

## Dify provisioning configuration

الـ default آمن ومقصود يكون dry-run لحد ما Dify Admin API الحقيقي يتحدد ويتراجع:

```bash
# default
DIFY_WORKSPACE_MODE=dry-run
```

في وضع `dry-run` لا تحتاج أي credentials، والـ provisioning يولد IDs محلية:

```text
dry_tenant_<organizationId>
dry_account_<ownerUserId>
```

وضع `live` يستخدم Dify Inner API لإنشاء workspace:

```bash
DIFY_WORKSPACE_MODE=live
DIFY_BASE_URL=https://your-dify.example.com
DIFY_ADMIN_TOKEN=<Dify INNER_API_KEY>
```

`DIFY_ADMIN_TOKEN` هنا هو قيمة Dify `INNER_API_KEY`، ولازم نسخة Dify تكون مفعّلة فيها:

```bash
INNER_API=true
INNER_API_KEY=<same token>
```

الـ endpoint المستخدم:

```text
POST /inner/api/enterprise/workspace
Header: X-Inner-Api-Key: <DIFY_ADMIN_TOKEN>
Body: { "name": "Workspace name", "owner_email": "owner@example.com" }
```

تقدر تشوف وضع الربط من:

```text
GET /provisioning/dify/status
```

مهم: endpoint الحالي في Dify يحتاج owner account موجود ومفعّل مسبقًا بنفس البريد. لو الحساب غير موجود، provisioning job هيفشل برسالة واضحة للأدمن تطلب إنشاء/تفعيل الحساب داخل Dify ثم retry.

## AI Studio URL configuration

زر `Open AI Studio` في customer dashboard يظهر فقط عندما تكون الشركة `active` ومعها `difyTenantId`.

الـ default المحلي:

```text
https://studio.local/tenants/<tenantId>
```

لضبط رابط white-label حقيقي:

```bash
DIFY_CONSOLE_BASE_URL=https://studio.your-domain.com
```

سيبني الرابط:

```text
https://studio.your-domain.com/tenants/<tenantId>
```

ولو محتاج شكل مخصص بالكامل استخدم template:

```bash
DIFY_WORKSPACE_URL_TEMPLATE="https://studio.your-domain.com/console?tenant={tenantId}&org={organizationId}"
```

القيم المدعومة في template:

```text
{tenantId}
{organizationId}
{accountId}
```

## ملاحظات معمارية

- هذا المشروع منفصل عن `/Users/mac/dify` حتى لا نكسر نسخة Dify الحالية.
- Dify سيظل AI Studio مدمج/white-label، والمنصة هنا مسؤولة عن التسجيل، الدفع، الموافقات، Meta channels، والـ provisioning.
- الـ provisioning jobs حالياً queue داخلية قابلة للاستبدال بـ BullMQ/Redis في المرحلة القادمة.
