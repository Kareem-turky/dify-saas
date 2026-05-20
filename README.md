# Dify SaaS Platform

منصة SaaS خارجية مستقلة مبنية حول Dify حسب ملف `docs/Dify_SaaS_Full_Integration_Architecture_AR.md`.

## الهدف الحالي

تنفيذ Phase 1 + بداية Phase 2 بدون تعديل نسخة Dify الحالية:

- Landing/Pricing/Signup.
- Organizations + plans + subscriptions.
- Manual payments: InstaPay/Vodafone Cash/bank transfer proof file upload + metadata.
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

## Authentication & RBAC

الـ API يدعم الآن login مبدئي بتوكن Bearer محلي:

```text
POST /auth/login
GET /auth/me
```

صفحة `/signup` تحفظ password hash للعميل، وصفحة `/admin` تطلب تسجيل دخول أدمن قبل تحميل طلبات الموافقة أو تشغيل provisioning jobs.

لإنشاء أول أدمن في بيئة التطوير/التشغيل اضبط:

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
AUTH_TOKEN_SECRET=change-this-local-secret
```

عند تشغيل الـ API يتم عمل upsert للأدمن من القيم دي. Endpoints الأدمن والـ provisioning التشغيلية محمية الآن وتتطلب:

```text
Authorization: Bearer <token>
```

## Payment proof uploads

تم إضافة endpoint آمن كبداية لرفع إثبات الدفع قبل إنشاء payment review:

```text
POST /payments/proofs
Content-Type: multipart/form-data
Fields:
- organizationId
- file: JPG/PNG/WEBP/PDF بحد أقصى 5MB
```

الـ API يخزن الملف محليًا في التطوير داخل `PAYMENT_PROOF_UPLOAD_DIR` ويرجع metadata:

```json
{
  "id": "prf_xxxxxxxx",
  "proofUrl": "/payment-proofs/org_xxxxxxxx/prf_xxxxxxxx.jpg",
  "originalName": "receipt.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 12345,
  "sha256": "..."
}
```

بعدها صفحة `/payment` ترسل `proofUploadId` إلى:

```text
POST /payments/manual-proof
```

لربط الملف بسجل الدفع وطلب مراجعة الأدمن.

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

## Provisioning queue runner

تم إضافة endpoint لتشغيل كل jobs الجاهزة بدل تشغيل كل job يدويًا من الأدمن:

```text
POST /provisioning/jobs/run-due
Authorization: Bearer <admin-token>
```

يرجع ملخص batch:

```json
{
  "processed": 2,
  "completed": 2,
  "failed": 0,
  "results": [
    { "jobId": "job_xxxxxxxx", "status": "completed" }
  ]
}
```

لو job فشل، الـ runner يكمل باقي jobs ويسجل الفشل في `results` ويفضل `lastError` محفوظًا على job. صفحة `/admin` فيها زر `Run all ready jobs` لتشغيل كل queued/failed jobs الجاهزة.

## Provisioning retry/backoff policy

الـ provisioning jobs أصبحت تحتفظ بمعلومات تشغيل أوضح:

```text
attempts
maxAttempts = 3
nextRunAt
lastError
```

عند فشل job:

- يتحول إلى `failed`.
- يتم حفظ `lastError`.
- يتم تحديد `nextRunAt` بزيادة تدريجية قبل إعادة المحاولة.
- `run-due` لا يعيد تشغيل failed job قبل ميعاد `nextRunAt`.
- بعد الوصول إلى `maxAttempts` يتحول job إلى `dead` ولا يدخل في batch runner تلقائيًا.

صفحة `/admin` تعرض الآن عدد المحاولات، آخر خطأ، وميعاد retry التالي عند وجوده.

## Audit logs

تم إضافة سجل audit للأحداث الحساسة في المنصة:

```text
GET /admin/audit-logs
Authorization: Bearer <admin-token>
```

الأحداث المسجلة حاليًا:

- `admin_login`
- `payment_approved`
- `provisioning_job_completed`
- `provisioning_job_failed`
- `provisioning_job_dead`

كل log يحتوي على:

```text
action
actorUserId
organizationId
targetType
targetId
metadata
createdAt
```

مهم: audit metadata لا تخزن passwords أو secrets. صفحة `/admin` تعرض آخر audit logs لمساعدة الدعم والتشغيل.

## WhatsApp channel settings foundation

تم بدء Phase 3 بإضافة إعدادات WhatsApp قبل استقبال Meta webhooks الفعلي:

```text
GET /channels/whatsapp
Authorization: Bearer <customer-token>

PUT /channels/whatsapp
Authorization: Bearer <customer-token>
```

الـ `PUT` يحفظ:

```text
phoneNumberId
wabaId
accessToken
verifyToken
appSecret optional
```

الـ API يرجع بيانات غير سرية فقط:

```text
phoneNumberId
wabaId
status
hasAccessToken
hasVerifyToken
hasAppSecret
webhookUrl
```

مهم:

- لا يتم إرجاع `accessToken` أو `appSecret` للـ frontend.
- يتم تسجيل `whatsapp_channel_saved` داخل audit logs بدون أسرار.
- صفحة `/integrations` أصبحت تعرض form لحفظ إعدادات WhatsApp وWebhook URL الذي سيتم استخدامه لاحقًا في Meta Developer Console.
- الخطوة التالية حسب الملف: Meta webhook verification + inbound receive + idempotency ثم ربط Dify App.

## Meta webhook verification + inbound receive

تمت إضافة أول جزء من استقبال Meta Webhooks في Phase 3:

```text
GET /webhooks/meta
```

يدعم Meta challenge verification باستخدام `hub.verify_token` المخزن في إعدادات قناة WhatsApp، ويرجع `hub.challenge` عند نجاح التحقق.

```text
POST /webhooks/meta
```

يستقبل payload رسائل WhatsApp من Meta، ثم:

- يحدد قناة العميل من `metadata.phone_number_id`.
- يحفظ الرسائل inbound في `message_events` مع `organizationId` و`channelId`.
- يستخدم `message.id` كـ idempotency key لمنع تكرار نفس الرسالة عند إعادة إرسال Meta للـ webhook.
- يتجاهل الرسائل القادمة لأرقام غير مفعّلة بدل كسر webhook endpoint.

الاستجابة الحالية تكون مثل:

```json
{ "received": true, "processed": 1, "duplicates": 0 }
```

أو عند التكرار:

```json
{ "received": true, "processed": 0, "duplicates": 1 }
```

الخطوة التالية حسب الملف: ربط كل inbound message بـ Dify App API ثم إرسال الرد إلى WhatsApp Cloud API.
