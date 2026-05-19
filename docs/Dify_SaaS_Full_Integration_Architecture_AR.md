Architecture كاملة لمنصة SaaS خارجية مبنية على Dify

خطة تكامل كاملة: التسجيل، الباقات، الدفع، الموافقات، إنشاء Workspace تلقائي، Dify White‑Label، وربط Meta WhatsApp/Messenger/Pages

تاريخ الإعداد: 19 مايو 2026 — مبني على فحص نسخة Dify الموجودة في /Users/mac/dify على جهاز Mac.

الهدف: العميل لا يعمل أي خطوات تقنية تقريبًا. يدخل الموقع، يختار الباقة، يعمل حساب، يدفع، يتم اعتماد الحساب، ثم يجد Workspace جاهز داخل Dify مدمج باسم وهوية منصتنا.

# 1. الخلاصة التنفيذية

القرار المعماري الأفضل هنا هو Hybrid Architecture: منصة SaaS خارجية مستقلة بالكامل لإدارة العملاء والباقات والدفع وMeta channels، مع استخدام Dify كـ AI Studio مدمج/مُعاد براندته داخل المنصة، وليس تعديل Dify ليصبح هو كل النظام.

Dify يظل هو محرك بناء الـ chatflows/workflows/knowledge bases لكل عميل داخل Workspace منفصل.

منصتنا الخارجية تكون المسؤولة عن التسجيل، الاشتراكات، الموافقات، الدفع، onboarding، الفيديوهات، وربط القنوات.

Middleware/Gateway منفصل يتعامل مع Meta webhooks وWhatsApp/Messenger/Pages، ثم يستدعي Dify App APIs للردود.

لا ننصح أن يكون كل شيء داخل Plugin فقط؛ لأن تجربة SaaS، الدفع، CRM، approvals، Meta onboarding، والـ audit/state تحتاج نظام خارجي وداتابيز مستقل.

نعدل Dify بأقل قدر ممكن: branding، embedded studio access، وربما SSO/auto-login bridge أو secure reverse proxy integration.

# 2. ما تم فحصه فعليًا في نسخة Dify الحالية

| البند | التفاصيل |
| --- | --- |
| مكان النسخة | /Users/mac/dify على جهاز Mac عبر Tailscale |
| Git branch / commit | main — commit short: 8581a68 — لا يوجد tag version واضح في الفحص |
| بنية المشروع | api + web + docker + sdks + e2e |
| أهم نقطة مكتشفة | وجود Inner API لإنشاء Enterprise Workspace: /inner/api/enterprise/workspace و /inner/api/enterprise/workspace/ownerless |
| حماية Inner API | محمية بـ INNER_API و X-Inner-Api-Key من ملف controllers/inner_api/wraps.py |
| حسابات و Workspaces | Dify يستخدم accounts + tenants + tenant_account_joins، والـ tenant هو الـ workspace فعليًا |
| Roles | owner, admin, editor, normal, dataset_operator |
| إنشاء API keys للتطبيقات | موجود endpoint: /console/api/apps/<app_id>/api-keys لإصدار app- API key |
| Branding | يوجد support للـ workspace/webapp logo و remove/replace webapp brand في custom_config، لكن White-label كامل للـ console يحتاج تعديل web/frontend/config |
| OAuth login | موجود Google/GitHub login؛ ليس كافيًا وحده لتجربة SSO كاملة من منصتنا |
| Meta/WhatsApp/Messenger native | لم يظهر تكامل Native جاهز مع Meta داخل النسخة؛ يحتاج Gateway/Connector خارجي |

# 3. حدود Dify وما نستخدمه منه

## 3.1 ما يصلح أن نعتمد عليه

إنشاء Workspace لكل عميل كـ tenant منفصل.

إضافة العميل كـ owner على Workspace الخاص به.

بناء Apps و Workflows و Chatflows و Knowledge Bases داخل كل Workspace.

إصدار API key لكل App حتى يستطيع Gateway إرسال الرسائل إلى Dify واستلام الرد.

استيراد DSL Templates داخل Workspace إذا أردنا توفير bots جاهزة كبداية.

تخزين credentials/providers داخل Dify لكل workspace عند الحاجة.

## 3.2 ما لا يجب تحميله على Dify

إدارة الباقات والدفع والموافقات.

تجربة SaaS customer portal الكاملة.

WhatsApp/Messenger/Instagram/Page onboarding وwebhooks والـ retries.

CRM أو inbox أو human handoff كامل إن قررنا بناؤه لاحقًا.

فواتير، usage quotas، settlement، manual payment verification.

إدارة علاقة العميل بالمنصة كمنتج مستقل.

# 4. الـ Architecture المقترحة

التصميم المقترح عبارة عن خمس طبقات رئيسية:

Public Marketing Website: صفحات التسويق، الأسعار، FAQ، case studies، وCTA للتسجيل.

SaaS Core Platform: auth، العملاء، الشركات، الباقات، الاشتراكات، الموافقات، الفواتير، الفيديوهات، وربط Dify.

Dify Provisioning Service: خدمة داخلية تنشئ account/workspace في Dify وتربطها بحساب العميل.

AI Studio Embedded Layer: دخول العميل إلى Dify من داخل منصتنا بهوية ولوجو وألوان المنصة.

Meta Channel Gateway: يستقبل webhooks من Meta، يربط numbers/pages، يرسل الرسائل إلى Dify App API، ويرجع الرد للعميل النهائي.

رسم منطقي مبسط:

Customer → Website/Portal → Payment/Approval → Provisioning Service → Dify Workspace → Customer uses AI Studio
Meta Webhooks → Channel Gateway → Dify App API → Channel Gateway → WhatsApp/Messenger/User

# 5. مكونات النظام بالتفصيل

## 5.1 منصة SaaS الخارجية

Frontend: Next.js/React بواجهة عربية وإنجليزية، dark/light mode، تصميم premium SaaS.

Backend: Node.js/NestJS أو Laravel أو FastAPI. الأنسب هنا NestJS لو هنمشي TypeScript full stack.

Database: PostgreSQL للـ customers, organizations, subscriptions, payments, approvals, dify mappings, channels.

Queue: Redis/BullMQ أو RabbitMQ للـ provisioning jobs وwebhook retries.

Object Storage: S3-compatible لتخزين فيديوهات الشرح والملفات واللوجوه.

Admin Dashboard: لإدارة العملاء، مراجعة المدفوعات اليدوية، الموافقات، الباقات، الربط، الدعم.

Audit Logs: كل قرار موافقة، دفع، تعديل باقة، ربط رقم، تغيير إعدادات يتسجل.

## 5.2 Dify Connector / Provisioning Service

يستدعي Dify Inner API لإنشاء workspace بعد الموافقة والدفع.

ينشئ أو يضمن وجود account للعميل داخل Dify.

يربط account بالـ workspace كـ owner.

يخزن mapping: platform_user_id / organization_id / dify_account_id / dify_tenant_id.

ينشئ workspace باسم الشركة، ويطبق إعدادات branding/plan/default templates.

اختياريًا يستورد DSL bots/templates جاهزة داخل workspace حتى يبدأ العميل بسرعة.

يصدر أو يساعد في إصدار API keys للتطبيقات التي سيتم ربطها بالقنوات.

## 5.3 Dify White‑Label / Embedded AI Studio

استخدام subdomain مثل studio.yourbrand.com بدل ظهور Dify مباشرة.

تعديل frontend branding: logo, favicon, app name, colors, login/signup text, footer, powered by.

إخفاء أو تعديل أي روابط Dify غير مرغوبة في الواجهة.

لو هنستخدم iframe داخل منصتنا: يجب ضبط CSP وcookies وsame-site/domain بعناية. الأفضل غالبًا reverse proxy/subdomain بدل iframe خام.

تجربة الدخول المثالية: العميل يضغط “AI Studio” من منصتنا ويدخل بدون إعادة login أو بأقل friction.

بما أن Dify الحالي يعتمد cookie login، نحتاج SSO bridge أو Token handoff endpoint مخصص بدل الاعتماد على Google/GitHub فقط.

## 5.4 Meta Channel Gateway

مكون مستقل يستقبل Webhooks من WhatsApp Cloud API وMessenger/Page events.

يحفظ ربط كل عميل: business_id, waba_id, phone_number_id, page_id, access tokens, selected Dify app_id/api_key.

يعمل signature verification وwebhook verification لطلبات Meta.

يعمل idempotency على message_id/event_id لأن Meta تعيد إرسال webhooks عند الفشل.

يدعم queues/retries/rate limits لتجنب ضياع رسائل أو حظر APIs.

يستدعي Dify App API بالـ app API key الخاصة بالعميل، ثم يرسل الرد عبر Meta Graph API.

يوفر logs داخل منصتنا لكل رسالة: received, routed, dify_response, sent, failed.

# 6. رحلة العميل المقترحة End-to-End

يدخل العميل الموقع ويقرأ الباقات والفوائد والتكاملات.

يختار الباقة المناسبة ويضغط Start / اشترك الآن.

ينشئ حسابه: الاسم، البريد، الهاتف، اسم الشركة، المجال، اللغة المفضلة.

يختار طريقة الدفع: Card/Payment Gateway أو InstaPay أو Vodafone Cash أو تحويل بنكي.

لو الدفع إلكتروني: يتم تفعيل order تلقائيًا بعد webhook نجاح الدفع.

لو دفع يدوي: العميل يرفع إثبات الدفع أو يدخل transaction reference؛ الأدمن يراجع ويوافق.

بعد الموافقة، provisioning job يبدأ: إنشاء Dify account/workspace وربطهم بالعميل.

العميل يدخل Dashboard ويجد onboarding checklist + فيديوهات شرح + زر AI Studio.

من صفحة Integrations يربط WhatsApp أو Messenger/Page عبر Meta Embedded Signup أو OAuth flow.

بعد الربط، يختار Dify App من apps الموجودة أو template جاهز، ثم يعمل test message.

النظام يصبح live: أي رسالة على WhatsApp/Messenger تدخل Gateway ثم Dify ثم يرجع الرد.

# 7. الدفع والباقات والموافقات

## 7.1 طرق الدفع

Payment Gateway للبطاقات والمحافظ لو متاح في السوق المستهدف.

InstaPay: في البداية غالبًا manual verification برقم العملية/صورة الإيصال، ثم يمكن التكامل حسب توفر API رسمي/شريك دفع.

Vodafone Cash: manual verification كبداية أو عبر provider يدعم المحافظ المصرية.

تحويل بنكي: manual verification.

كل طريقة دفع تنتج Payment Intent داخل قاعدة بيانات المنصة بحالة: pending, paid, failed, needs_review, refunded.

## 7.2 منطق الموافقة

لا يتم إنشاء Dify Workspace إلا بعد تحقق الدفع أو موافقة أدمن.

لو دفع إلكتروني ناجح: approval policy يمكن تكون automatic للباقة العادية، وmanual للباقة الكبيرة.

لو دفع يدوي: admin يراجع الإثبات ثم يضغط Approve، فيبدأ provisioning.

لو provisioning فشل: تظهر للأدمن retry button مع error logs بدون أن يشعر العميل بتفاصيل تقنية.

# 8. ربط Meta بحيث العميل لا يعمل خطوات تقنية كثيرة

الهدف الواقعي: العميل لن يكتب tokens أو webhook URLs يدويًا. لكنه سيحتاج تسجيل دخول إلى Facebook/Meta والموافقة على الصلاحيات واختيار Business/Page/WhatsApp number. هذا يتم عبر Embedded Signup / OAuth flow مدمج داخل منصتنا.

## 8.1 WhatsApp

من صفحة Integrations يضغط Connect WhatsApp.

تفتح Meta Embedded Signup / Facebook Login for Business داخل flow رسمي.

العميل يختار Business Manager أو ينشئ واحدًا حسب حالة حسابه.

يختار أو يضيف WhatsApp Business Account والرقم.

منصتنا تستقبل callback وتحصل على codes/tokens/IDs المطلوبة.

Gateway يحفظ waba_id وphone_number_id وaccess token بشكل encrypted.

Gateway يسجل webhook subscription ويختبر الإرسال والاستقبال.

العميل يختار Dify App الذي سيرد على الرسائل ثم يعمل Test.

## 8.2 Messenger / Facebook Pages

العميل يضغط Connect Facebook Page.

يعمل login بحساب لديه صلاحية إدارة الصفحة.

يوافق على permissions الخاصة بالصفحات والرسائل.

منصتنا تعرض الصفحات المتاحة، يختار الصفحة.

Gateway يحفظ page_id وpage access token، ويسجل webhook للرسائل.

يربط الصفحة بـ Dify App محدد داخل workspace العميل.

## 8.3 ملاحظات مهمة

يجب إنشاء Meta App رسمي باسم منصتنا وإعداده والتحقق منه Business Verification حسب الحاجة.

يجب مراجعة الصلاحيات المطلوبة أثناء التنفيذ لأن Meta تغير المتطلبات والمراجعات بمرور الوقت.

Webhook endpoint يجب أن يكون public HTTPS ومستقر، مع verify token وsignature validation.

يجب وجود سياسة خصوصية وData Deletion Callback وصفحات قانونية قبل مراجعة Meta.

العميل لن يحتاج إنشاء Meta Developer App خاص به في النموذج المثالي؛ هو يربط أصوله عبر تطبيقنا الرسمي.

# 9. قاعدة البيانات المقترحة للمنصة الخارجية

users: بيانات دخول المستخدمين على منصتنا.

organizations: شركة/عميل SaaS.

organization_members: أعضاء وصلاحيات داخل شركة العميل.

plans: تعريف الباقات والحدود.

subscriptions: اشتراك كل organization وحالته.

payments: كل عملية دفع وإثباتاتها.

approval_requests: طلبات مراجعة/اعتماد الحسابات والمدفوعات.

dify_workspaces: mapping بين organization وdify_tenant_id وdify_account_id.

dify_apps: cache أو mapping للتطبيقات المختارة وربطها بالقنوات.

channels: تعريف قناة WhatsApp/Messenger/Page لكل عميل.

channel_credentials: tokens مشفرة ومفصولة عن البيانات العامة.

message_events: سجل inbound/outbound للرسائل وحالاتها.

onboarding_progress: تقدم العميل في الفيديوهات والخطوات.

audit_logs: سجل تغييرات مهم للأمان والدعم.

# 10. UX المقترحة للعميل

## 10.1 الصفحات الرئيسية

Landing Page: وعد واضح “ابني شات بوت AI لواتساب وفيسبوك في دقائق”.

Pricing Page: باقات بسيطة مع limits واضحة: عدد الرسائل، القنوات، أعضاء الفريق، مساحة المعرفة.

Signup Wizard: 3 خطوات فقط: الحساب، الشركة، اختيار الباقة/الدفع.

Pending Approval Screen: حالة واضحة بعد الدفع اليدوي “طلبك تحت المراجعة”.

Customer Dashboard: cards مختصرة للحالة، الاشتراك، AI Studio، Integrations، Tutorials.

AI Studio Page: زر دخول إلى Dify مدمج + شرح مختصر + حالة workspace.

Integrations Page: WhatsApp / Messenger / Pages مع connect buttons وحالة كل قناة.

Tutorials Academy: فيديوهات قصيرة حسب المرحلة، مع progress tracking.

Billing Page: الفواتير، تغيير الباقة، تجديد الاشتراك، طرق الدفع.

Support Page: تذكرة دعم أو WhatsApp support.

## 10.2 مبادئ UX

لا تعرض للعميل مصطلحات Dify الداخلية في البداية؛ استخدم: AI Studio، Knowledge Base، Bot Builder.

استخدم onboarding checklist: 1) شاهد فيديو البداية 2) افتح AI Studio 3) اربط WhatsApp 4) اختبر البوت.

اجعل كل خطوة لها حالة واضحة: Not connected / Needs action / Connected / Live / Error.

التجربة ثنائية اللغة من اليوم الأول: عربي وإنجليزي، مع RTL ممتاز.

Dark/light mode اختياري في إعدادات الحساب ويحفظ على مستوى user.

اعرض errors باللغة البشرية: “الربط يحتاج إعادة موافقة من فيسبوك” بدل رسائل API.

# 11. تجربة الأدمن Internal Admin

قائمة العملاء وحالة كل حساب: pending payment, pending approval, provisioning, active, suspended.

مراجعة المدفوعات اليدوية: صورة الإيصال، رقم العملية، notes، approve/reject.

إعادة تشغيل provisioning jobs ومشاهدة logs.

إدارة الباقات والحدود والأسعار.

عرض Dify workspace mapping وزر فتح workspace كأدمن داخلي عند الحاجة.

إدارة Meta channels: token status, webhook status, last event, errors.

إيقاف/تعليق عميل عند انتهاء الاشتراك أو مخالفة الاستخدام.

Audit log لكل فعل حساس.

# 12. الأمان والخصوصية

تشفير tokens وAPI keys في قاعدة البيانات باستخدام KMS أو libsodium/Fernet مع key rotation.

فصل صلاحيات الأدمن الداخلي عن صلاحيات العميل.

عدم تخزين access tokens في frontend أو logs.

Webhook signature verification لكل Meta request.

Idempotency keys لكل webhook event.

Rate limiting على login، payment callbacks، webhook endpoints.

Backups يومية لقاعدة البيانات، وخطة restore مجربة.

سياسة retention للرسائل حسب الباقة والقوانين.

Data deletion flow لطلبات Meta وحذف بيانات العملاء.

# 13. قابلية التوسع والتشغيل

ابدأ بنشر SaaS platform وGateway كخدمات منفصلة Docker containers.

PostgreSQL managed أو self-hosted مع backups ومراقبة.

Redis للqueues والrate limits.

Observability: logs structured + metrics + alerts.

Dead-letter queue للرسائل التي تفشل بعد retries.

Scale أفقي للـ Gateway لأنه سيستقبل webhooks كثيرة.

Dify نفسه يحتاج مراقبة منفصلة: API, web, worker, db, vector db, redis, object storage.

ضع حدود usage لكل خطة: messages/month، channels، seats، storage، Dify apps/templates.

# 14. خطة تنفيذ على مراحل

## Phase 0 — Discovery وتثبيت القرار

تشغيل نسخة Dify محليًا/على staging والتأكد من Inner API عمليًا.

تحديد طريقة SSO/auto-login المناسبة مع Dify.

تحديد payment providers المتاحة رسميًا في مصر/السوق المستهدف.

تجهيز Meta App وBusiness verification والمتطلبات القانونية.

## Phase 1 — SaaS Foundation

Landing + pricing + signup/login.

Organizations + plans + subscriptions.

Payments manual flow: InstaPay/Vodafone Cash proof upload + admin approval.

Admin dashboard للـ approvals.

Provisioning job framework.

## Phase 2 — Dify Provisioning + Embedded Studio

إنشاء Dify account/workspace تلقائيًا بعد approval.

تخزين mapping بين منصة العميل وDify tenant.

تعديل branding الأساسي لـ Dify.

زر AI Studio داخل المنصة مع تجربة دخول سلسة.

استيراد template bot جاهز كاختبار.

## Phase 3 — WhatsApp MVP

Channel settings داخل المنصة.

Meta webhook verification + inbound receive.

اختيار Dify App وربطه بالرقم.

إرسال inbound message إلى Dify API واستلام response.

إرسال الرد إلى WhatsApp Cloud API.

Logs + retry + idempotency.

## Phase 4 — Messenger/Pages + Production Hardening

ربط Facebook Pages/Messenger بنفس نمط WhatsApp.

تحسين onboarding embedded signup.

Billing automation/card gateway.

Usage limits وتعليق تلقائي عند انتهاء الباقة.

Monitoring/alerts/backups/security review.

## Phase 5 — CRM/Inbox اختياري لاحقًا

Inbox للرسائل، human handoff، tags، notes، assigned agents.

Analytics: عدد الرسائل، conversion، response time، errors.

Team permissions داخل منصة العميل.

Templates marketplace جاهزة حسب المجال.

# 15. أهم القرارات الفنية المطلوبة قبل بدء التطوير

هل نستخدم NestJS/Next.js كـ stack موحد؟ التوصية: نعم لو الفريق مرتاح لـ TypeScript.

هل Dify سيكون في subdomain منفصل أو iframe؟ التوصية: subdomain/reverse proxy أفضل، iframe فقط لو تم حل cookies/CSP.

هل الموافقات manual أم automatic؟ التوصية: automatic للبوابة الإلكترونية، manual للدفع اليدوي والباقات الكبيرة.

هل العميل يربط Meta عبر تطبيقنا أم ينشئ App خاص؟ التوصية: عبر تطبيقنا الرسمي لتقليل الخطوات.

هل نبني CRM من البداية؟ التوصية: لا. ابدأ بالرسائل الآلية والربط، ثم CRM بعد إثبات الاستخدام.

هل نعدل Dify بعمق؟ التوصية: أقل تعديل ممكن للحفاظ على سهولة تحديث Dify مستقبلاً.

# 16. المخاطر وكيف نخففها

| البند | التفاصيل |
| --- | --- |
| تعقيد SSO مع Dify | ابدأ بـ subdomain + login bridge بسيط، ثم حسّن SSO لاحقًا. اختبر cookies مبكرًا. |
| Meta approvals قد تتأخر | ابدأ WhatsApp test/staging مبكرًا وجهز privacy policy وdata deletion callback. |
| الدفع اليدوي يسبب ضغط تشغيل | Admin dashboard واضح + proof upload + status notifications. |
| تحديثات Dify قد تكسر التعديلات | احصر التعديلات في branding/bridge صغيرة، واحتفظ بفورك minimal diff. |
| ضياع webhooks أو تكرارها | Queue + idempotency + dead-letter + retry policy. |
| تكلفة تشغيل عالية | ابدأ single Dify instance متعدد workspaces، ثم راقب usage قبل فصل instances. |

# 17. MVP المقترح بالضبط

أول نسخة قابلة للبيع يجب أن تركز على رحلة واحدة كاملة من أول التسجيل حتى أول رسالة WhatsApp ترد من Dify:

Landing/Pricing/Signup.

دفع يدوي InstaPay/Vodafone Cash + إثبات دفع.

Admin approval.

إنشاء Dify workspace تلقائيًا.

Dashboard للعميل + فيديوهات + زر AI Studio.

Dify white-label مبدئي: logo/name/colors/subdomain.

ربط WhatsApp channel واحد يدوي/نصف آلي كبداية.

اختيار Dify App + test message.

Logs أساسية للرسائل والأخطاء.

# 18. توصية نهائية

ابدأوا بمنصة خارجية مستقلة تكون هي المنتج الحقيقي أمام العميل، واجعلوا Dify “AI Studio” مدمج داخلها. استخدموا Dify لما هو قوي فيه: بناء البوتات والـ workflows والـ knowledge bases. أما الدفع، الموافقات، Meta channels، onboarding، الفيديوهات، dashboard، والـ CRM لاحقًا فيجب أن تكون خارج Dify في SaaS platform وGateway مستقلين.

هذا المسار يعطيكم سيطرة كاملة على تجربة العميل والهوية التجارية، وفي نفس الوقت يستفيد من Dify بدون أن نحوله إلى منتج لا يناسبه أو نغرق في تعديلات core كبيرة من البداية.
