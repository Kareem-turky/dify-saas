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
difyAppId optional
difyAppApiKey optional
```

الـ API يرجع بيانات غير سرية فقط:

```text
phoneNumberId
wabaId
status
hasAccessToken
hasVerifyToken
hasAppSecret
difyAppId
hasDifyAppApiKey
webhookUrl
```

مهم:

- لا يتم إرجاع `accessToken` أو `appSecret` أو `difyAppApiKey` للـ frontend.
- يتم تخزين WhatsApp/Dify secrets كـ encrypted ciphertext مع hash للـ flags، وليس كـ plain text.
- يتم تسجيل `whatsapp_channel_saved` داخل audit logs بدون أسرار.
- صفحة `/integrations` تعرض form لحفظ إعدادات WhatsApp وWebhook URL وربط Dify App API key.
- تم إنجاز Meta webhook verification + inbound receive + idempotency، والمرحلة الحالية تضيف Dify reply dispatch.

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

الاستجابة تكون مثل:

```json
{ "received": true, "processed": 1, "duplicates": 0 }
```

أو عند التكرار:

```json
{ "received": true, "processed": 0, "duplicates": 1 }
```

## WhatsApp inbound → Dify App API → Cloud API reply

تمت إضافة خطوة الرد التلقائي ضمن Phase 3:

- عندما تصل رسالة WhatsApp text جديدة لقناة مربوطة بـ `difyAppApiKey`، يستدعي الـ Gateway:
  `POST {DIFY_APP_API_BASE_URL}/chat-messages`
- يستخدم body بنمط Dify App API:
  `inputs`, `query`, `response_mode=blocking`, `user`, وmetadata لمصدر الرسالة.
- يأخذ `answer` من Dify ويحفظ outbound `message_event`.
- يرسل الرد إلى WhatsApp Cloud API:
  `POST {META_GRAPH_API_BASE_URL}/{phoneNumberId}/messages`
- يحفظ inbound event بالحالة `processed` عند نجاح الإرسال.
- عند فشل Dify أو WhatsApp لا يسقط webhook endpoint؛ يتم وضع inbound event في `failed` مع `lastError` بدون أسرار.
- عند duplicate inbound message لا يتم استدعاء Dify أو WhatsApp مرة ثانية.

متغيرات البيئة الجديدة:

```text
DIFY_APP_API_BASE_URL=https://your-dify.example.com/v1
META_GRAPH_API_BASE_URL=https://graph.facebook.com/v19.0
CHANNEL_SECRET_KEY=change-me-long-random-secret
```

مهم: `CHANNEL_SECRET_KEY` لازم يظل ثابتًا بين التشغيلات حتى يمكن فك تشفير tokens المخزنة.

استجابة webhook عند إرسال رد ناجح:

```json
{ "received": true, "processed": 1, "duplicates": 0, "repliesSent": 1 }
```

وعند فشل Dify/WhatsApp:

```json
{ "received": true, "processed": 1, "duplicates": 0, "repliesFailed": 1 }
```

## WhatsApp/Dify reply retry foundation

تمت إضافة جزء `Logs + retry + idempotency` من Phase 3:

```text
POST /admin/message-events/retry-failed
Authorization: Bearer ***
```

الـ endpoint أدمن فقط ويعيد معالجة inbound WhatsApp message events التي حالتها `failed`.

السلوك:

- لا يعيد معالجة duplicates القادمة من Meta؛ retry يعمل فقط على failed events المسجلة داخليًا.
- يزيد `retryCount` لكل محاولة retry.
- عند النجاح يحول inbound event إلى `processed` وينشئ outbound `message_event` بحالة `sent`.
- عند الفشل يترك inbound event في `failed` ويحدث `lastError` و`nextRetryAt` بدون تسريب tokens.
- يسجل audit log باسم `message_retry_run` يحتوي counts فقط بدون أسرار.
- صفحة `/admin` فيها زر `Retry failed messages` لتشغيل retry يدويًا.

استجابة retry:

```json
{ "attempted": 1, "retried": 1, "failed": 0 }
```

## WhatsApp test message + status callbacks

تم استكمال آخر جزء وظيفي من Phase 3:

```text
POST /channels/whatsapp/test-message
Authorization: Bearer <customer-token>
Content-Type: application/json
```

Body:

```json
{ "to": "201111111111", "text": "هل البوت شغال؟" }
```

السلوك:

- يستدعي Dify App API بنفس مفاتيح القناة المشفرة.
- يرسل رد Dify إلى WhatsApp Cloud API.
- يسجل inbound test event و outbound WhatsApp event داخل `message_events`.
- لا يرجع access tokens أو Dify API keys للمتصفح.
- صفحة `/integrations` تعرض فورم `Test message` بعد حفظ WhatsApp/Dify settings.

تمت إضافة دعم Meta status callbacks داخل نفس webhook:

```text
POST /webhooks/meta
```

- يقرأ `statuses[]` القادمة من Meta.
- يحدث حالة outbound `message_event` المطابق مثل `delivered` أو `read` أو `failed`.
- يخزن تفاصيل status callback داخل `rawPayload.statusCallback` بدون أسرار.

Phase 3 مكتملة وظيفياً الآن: channel settings + Meta webhook verification/inbound + idempotency + Dify reply dispatch + WhatsApp send + logs/retry + status callbacks + test message.

الخطوة التالية حسب الملف: Phase 4 Messenger/Pages + production hardening.

## Phase 4 start — Messenger/Page channel settings

تم بدء Phase 4 بإضافة أول slice لربط Facebook Pages/Messenger بنفس نمط WhatsApp:

```text
GET /channels/messenger
PUT /channels/messenger
Authorization: Bearer <customer-token>
```

Body للحفظ:

```json
{
  "pageId": "page-123",
  "pageName": "Support Page",
  "pageAccessToken": "PAGE_TOKEN",
  "verifyToken": "messenger-verify-token",
  "appSecret": "APP_SECRET",
  "difyAppId": "dify-messenger-app",
  "difyAppApiKey": "DIFY_APP_API_KEY"
}
```

السلوك:

- Page access token و app secret و Dify App API key يتم تخزينهم encrypted/hash server-side.
- الاستجابة لا ترجع أي أسرار؛ فقط flags مثل `hasPageAccessToken` و `hasDifyAppApiKey`.
- إعدادات Messenger/Page معزولة حسب organization.
- Meta webhook verification أصبح يقبل verify tokens لقنوات WhatsApp وMessenger.
- يتم تسجيل `messenger_channel_saved` داخل audit logs بدون أسرار.
- صفحة `/integrations` أصبحت تحتوي فورم Messenger/Facebook Page settings بجانب WhatsApp.

ملاحظة تنفيذية: أول slice يستخدم نفس جدول `Channel` الحالي مع `channelType = messenger` ويعرض `phoneNumberId` كـ `pageId` و `wabaId` كـ `pageName` لتقليل تغييرات schema في بداية Phase 4. ممكن لاحقًا نفصل الأعمدة semantic لو هنضيف Messenger dispatch كامل.

الخطوة التالية في Phase 4: استقبال Messenger/Page webhook events ثم إرسالها إلى Dify وإرسال الرد عبر Send API، وبعدها production hardening.

## Messenger → Dify reply dispatch

تم إضافة معالجة Messenger/Page webhook events ضمن Phase 4:

```text
POST /webhooks/meta
```

السلوك الجديد عند استقبال `object = page` و `entry[].messaging[]`:

- استخراج `sender.id` كـ PSID.
- استخراج `recipient.id` أو `entry.id` كـ Facebook Page ID.
- استخدام `message.mid` كـ idempotency key.
- حفظ inbound `message_event` بقيمة:

```text
channelType = messenger
方向/direction = inbound
```

- إرسال نص المستخدم إلى Dify App API بنفس Dify key المخزن للقناة.
- إرسال رد Dify عبر Messenger Send API:

```text
POST {META_GRAPH_API_BASE_URL}/me/messages?access_token=<PAGE_TOKEN>
```

- حفظ outbound `message_event` بقيمة:

```text
channelType = messenger
direction = outbound
status = sent
```

- عند تكرار نفس `message.mid` من Meta لا يتم استدعاء Dify أو Messenger مرة ثانية.
- عند فشل Dify أو Messenger Send API يتم تعليم inbound event كـ `failed` مع `lastError` آمن بدون تسريب Page token أو Dify API key.

## Messenger retries/status callbacks

تم توسيع جزء `Logs + retry + idempotency` ليشمل Messenger/Page بجانب WhatsApp:

```text
POST /admin/message-events/retry-failed
Authorization: Bearer <admin-token>
```

السلوك:

- يعيد محاولة failed inbound events لقنوات `whatsapp` و`messenger`.
- عند Messenger retry يستخدم نفس مسار Dify App API ثم Messenger Send API.
- يزيد `retryCount` لكل محاولة ويترك `lastError` آمن بدون Page token أو Dify API key.
- يسجل outbound Messenger event جديد عند نجاح retry.

كما تم دعم Messenger delivery/read callbacks داخل:

```text
POST /webhooks/meta
```

- `delivery.mids[]` يحدّث matching outbound Messenger events إلى `delivered`.
- `read` يحدّث outbound Messenger events المطابقة للـ Page/PSID إلى `read` عندما لا توفر Meta message ids.
- يخزن callback metadata تحت `rawPayload.messengerStatusCallback` بدون أسرار.
- استجابة webhook تضيف `messengerStatusesUpdated` عند وجود تحديثات.

Phase 4 Messenger functional slice مكتملة حالياً: channel settings + webhook verification + inbound extraction + Dify reply dispatch + Send API + idempotency + failed-message retry + delivery/read callbacks.

## Phase 4 production hardening — message queue monitoring/dead-letter

تمت إضافة أول hardening slice لقنوات WhatsApp/Messenger قبل الإنتاج:

```text
GET /admin/message-events/summary
Authorization: Bearer ***
```

يعرض summary تشغيلي للرسائل حسب الحالة والقناة:

```text
totals
byChannel
retryableFailed
deadLettered
oldestFailedAt
```

وتم تحسين:

- `POST /admin/message-events/retry-failed` لا يعيد محاولة events مؤجلة قبل `nextRetryAt`.
- الرسائل التي وصلت حد `MESSAGE_EVENT_MAX_RETRIES`، والـ default = `3`، تتحول إلى `dead` بدل retry لا نهائي.
- رد الـ retry أصبح يرجع `skippedNotDue` و `deadLettered` عند وجودهم.
- صفحة `/admin` تعرض monitoring summary لقوائم WhatsApp/Messenger مع retryable/dead-letter counts.

## Phase 4 production hardening — basic API rate limits

تمت إضافة guardrails مبدئية لتقليل brute-force/traffic spikes قبل الانتقال لـ Redis/BullMQ:

- `POST /auth/login` عليه fixed-window rate limit حسب البريد.
- `POST /webhooks/meta` عليه fixed-window rate limit حسب source IP من `x-forwarded-for` أو request IP.
- عند تخطي الحد يرجع API status `429` برسالة واضحة.

الإعدادات:

```text
LOGIN_RATE_LIMIT_MAX=20
LOGIN_RATE_LIMIT_WINDOW_MS=60000
META_WEBHOOK_RATE_LIMIT_MAX=200
META_WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
```

ملاحظة: التنفيذ الحالي in-memory مناسب كبداية/dev أو instance واحدة. في الإنتاج متعدد النسخ يجب نقله إلى Redis/shared store.

## Usage limits foundation

تمت إضافة أول slice من usage limits حسب الباقات:

- Dashboard API يرجع الآن `usage` لكل organization:

```text
messagesUsed
messageLimit
messagesRemaining
limitReached
channelsUsed
channelLimit
channelsRemaining
channelLimitReached
upgradeRecommendation
windowStart
windowEnd
```

- حساب الاستهلاك الحالي يعتمد على outbound message events الناجحة داخل الشهر الحالي.
- عند وصول `messagesUsed` إلى `plan.messageLimit`:
  - يستقبل الـ webhook الرسالة ويحفظها كـ inbound event.
  - يتم وضع status = `usage_limited`.
  - لا يتم استدعاء Dify App API ولا Meta Send API.
  - response يحتوي `usageLimited` عند حدوث ذلك.
- صفحة `/dashboard` تعرض استخدام الرسائل الحالي وحد الباقة.
- نفس `usage` يرجع الآن استخدام القنوات: `channelsUsed`, `channelLimit`, `channelsRemaining`, `channelLimitReached`.
- عند الوصول لحد الرسائل أو القنوات يرجع `upgradeRecommendation` بأقرب باقة أعلى مناسبة، وتعرض صفحة `/dashboard` CTA للترقية.
- `POST /subscriptions/upgrade` ينشئ subscription جديدة بالباقة الأعلى + payment/approval review بدون تعطيل workspace نشط، وعند موافقة الأدمن لا يتم إنشاء provisioning job جديد إذا كانت مساحة Dify موجودة بالفعل.

## Channel limits foundation

تمت إضافة slice جديدة من limits حسب الباقة لقنوات Meta:

- عند إنشاء قناة WhatsApp أو Messenger جديدة يتم حساب عدد القنوات `configured` للـ organization.
- لو العدد الحالي وصل إلى `plan.channelLimit`:
  - يرجع API status `403`.
  - لا يتم إنشاء القناة الجديدة.
  - تظهر رسالة `Channel limit reached` لتوجيه العميل لترقية الباقة.
- تحديث قناة موجودة من نفس النوع لا يستهلك slot إضافي ويظل مسموحًا.

هذا يكمل أول enforcement عملي لـ `channelLimit` بجانب `messageLimit`.

## Meta webhook signature verification

تمت إضافة أول جزء من production hardening لقنوات Meta:

```text
META_WEBHOOK_SIGNATURE_REQUIRED=true
META_WEBHOOK_APP_SECRET=<meta-app-secret>
```

عند تفعيل الإعدادات:

- `POST /webhooks/meta` يرفض أي request بدون `X-Hub-Signature-256`.
- يقارن توقيع `sha256=<hmac>` باستخدام `timingSafeEqual`.
- في التشغيل الإنتاجي يتم تفعيل Nest raw body support حتى يتم توقيع نفس request body القادم من Meta.
- لو التوقيع غير صحيح يرجع `401 Unauthorized` قبل أي معالجة أو كتابة events.

الخطوة التالية في Phase 4 production hardening: queue/rate limits/dead-letter/monitoring.

