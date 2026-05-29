# Dify SaaS Platform — Agent Handoff Document

> **Project:** `dify-saas` (GitHub: `Kareem-turky/dify-saas`)  
> **Type:** External SaaS platform built around Dify (AI Studio)  
> **Stack:** TypeScript, NestJS (API), Next.js (Web), Prisma (SQLite for MVP), pnpm workspaces  
> **Last Updated:** May 2026  
> **Status:** MVP — Phases 1-4 largely implemented, production hardening in progress

---

## 1. What This Project Is

A **white-label SaaS platform** that lets customers:
1. Sign up on a landing page
2. Choose a subscription plan
3. Pay (manual: InstaPay/Vodafone Cash/bank transfer — with admin approval)
4. Get a Dify workspace provisioned automatically
5. Build AI bots inside an embedded "AI Studio" (Dify white-labeled)
6. Connect WhatsApp and/or Messenger/Page channels
7. Receive inbound messages → Dify bot → reply back to the user

**The platform is SEPARATE from Dify.** Dify runs as the AI engine; this platform handles billing, onboarding, Meta channel gateway, and customer management.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER JOURNEY                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Landing → Pricing → Signup → Payment → Admin Approval → Provisioning   │
│     ↓         ↓        ↓        ↓            ↓              ↓           │
│   (Web)    (Web)    (Web)   (Web/API)   (Admin UI)    (Dify Inner API) │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         META CHANNEL GATEWAY                            │
├─────────────────────────────────────────────────────────────────────────┤
│  WhatsApp Cloud API / Messenger Send API ←→ Dify App API                │
│  Webhooks: POST /webhooks/meta                                          │
│  Features: idempotency, retry, dead-letter, rate limits, status cb      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Tech | Purpose |
|-----------|------|---------|
| `apps/api` | NestJS + Prisma + SQLite | Backend API, auth, payments, provisioning, webhooks |
| `apps/web` | Next.js 16 + React 19 | Customer portal, admin dashboard, landing pages |
| `packages/shared` | TypeScript types | Shared constants (locales, channel types, payment methods) |
| Dify (external) | Python/Flask + React | AI Studio for bot building (self-hosted) |

---

## 3. Project Structure

```
dify-saas/
├── apps/
│   ├── api/                          # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts               # Entry point (port 4000)
│   │   │   ├── app.module.ts         # Root module
│   │   │   ├── saas.controller.ts    # All HTTP routes
│   │   │   ├── saas.service.ts       # Business logic
│   │   │   ├── dify-provisioning.service.ts  # Dify workspace creation
│   │   │   ├── provisioning-worker.service.ts # Background job runner
│   │   │   ├── prisma.service.ts     # Prisma client
│   │   │   ├── domain.ts             # Domain types
│   │   │   ├── in-memory.store.ts    # In-memory rate limit store
│   │   │   └── rate-limit.store.ts   # Rate limit interface
│   │   ├── prisma/
│   │   │   └── schema.prisma         # Database schema (SQLite)
│   │   ├── test/                     # 30+ vitest test files
│   │   └── package.json
│   └── web/                          # Next.js frontend
│       ├── app/                      # App router pages
│       │   ├── page.tsx              # Landing
│       │   ├── login/page.tsx        # Login
│       │   ├── signup/page.tsx       # Signup
│       │   ├── dashboard/page.tsx    # Customer dashboard
│       │   ├── admin/page.tsx        # Admin dashboard
│       │   ├── payment/page.tsx      # Payment proof upload
│       │   ├── integrations/page.tsx # WhatsApp/Messenger settings
│       │   ├── team/page.tsx         # Team management
│       │   ├── data-deletion/page.tsx # Meta data deletion
│       │   └── components/           # Shared UI components
│       └── package.json
├── packages/shared/                  # Shared types/constants
│   └── src/index.ts
├── docs/
│   ├── Dify_SaaS_Full_Integration_Architecture_AR.md  # Full Arabic architecture doc
│   └── production-checklist.md       # Pre-production checklist
├── scripts/
│   ├── backup-sqlite.sh              # SQLite backup script
│   └── restore-sqlite.sh             # SQLite restore script
├── spikes/                           # Research spikes
│   ├── 001-dify-inner-workspace-api/
│   └── 002-dify-owner-account-requirement/
├── .env.example                      # Environment template
├── package.json                      # Root workspace config
├── pnpm-workspace.yaml               # pnpm monorepo config
└── tsconfig.base.json                # Shared TS config
```

---

## 4. Database Schema (Prisma → SQLite)

### Core Models

| Model | Purpose |
|-------|---------|
| `User` | Platform users (customers + admins) |
| `Organization` | Customer company/tenant |
| `Plan` | Subscription tiers (price, message limit, channel limit, seat limit) |
| `Subscription` | Active subscription linking org + plan |
| `Payment` | Payment records (manual methods) |
| `Invoice` | Generated invoices |
| `PaymentProof` | Uploaded payment receipts (file + metadata + sha256) |
| `ApprovalRequest` | Admin approval queue for manual payments |
| `ProvisioningJob` | Background jobs to create Dify workspaces |
| `AuditLog` | Security/operations audit trail |
| `Channel` | WhatsApp/Messenger channel config (encrypted tokens) |
| `MessageEvent` | Inbound/outbound message log (with retry tracking) |
| `ContentBlock` | CMS-style content blocks (landing page copy, etc.) |

### Key Relationships
- `Organization` → has many `User`, `Subscription`, `Payment`, `Channel`, `MessageEvent`
- `Organization` → has one active `Subscription` → linked to `Plan`
- `Channel` → stores encrypted Meta tokens (`accessTokenCiphertext`, `appSecretCiphertext`, `difyAppApiKeyCiphertext`)
- `MessageEvent` → tracks every inbound/outbound message with status (`received`, `processed`, `sent`, `failed`, `dead`, `usage_limited`)

---

## 5. API Endpoints

### Public (No Auth)
- `GET /health` — Liveness check
- `GET /plans` — List subscription plans
- `POST /auth/signup` — Customer registration
- `POST /auth/login` — Login (returns Bearer token)
- `GET /webhooks/meta` — Meta webhook verification (challenge)
- `POST /webhooks/meta` — Meta webhook receiver (inbound messages)
- `POST /meta/data-deletion` — Meta data deletion callback
- `GET /content` — Public CMS content blocks

### Customer (Bearer Token)
- `GET /auth/me` — Current user
- `POST /payments/proofs` — Upload payment receipt (multipart/form-data, max 5MB)
- `POST /payments/manual-proof` — Submit manual payment for review
- `POST /subscriptions/upgrade` — Upgrade plan
- `GET /team/members` — List team members
- `POST /team/members` — Add team member
- `GET /channels/whatsapp` — Get WhatsApp channel settings
- `PUT /channels/whatsapp` — Save WhatsApp channel settings
- `GET /channels/messenger` — Get Messenger channel settings
- `PUT /channels/messenger` — Save Messenger channel settings
- `POST /channels/whatsapp/test-message` — Send test message
- `GET /organizations/:id/dashboard` — Customer dashboard data

### Admin (Bearer Token + Admin Role)
- `GET /admin/approvals` — Pending payment approvals
- `POST /admin/approvals/:paymentId/approve` — Approve payment
- `GET /admin/audit-logs` — Security audit logs
- `GET /admin/message-events/summary` — Message queue monitoring
- `POST /admin/message-events/retry-failed` — Retry failed messages
- `GET /admin/readiness` — System readiness check
- `POST /admin/plans` — Create plan
- `PUT /admin/plans/:planId` — Update plan
- `DELETE /admin/plans/:planId` — Delete plan
- `GET /admin/users` — List all users
- `PUT /admin/users/:userId` — Update user role/status
- `PUT /admin/content/:key` — Set CMS content
- `GET /admin/content` — List CMS content
- `DELETE /admin/content/:key` — Delete CMS content

### Provisioning
- `GET /provisioning/dify/status` — Dify gateway status
- `GET /provisioning/jobs` — List provisioning jobs
- `POST /provisioning/jobs/run-due` — Run all due jobs
- `POST /provisioning/jobs/:jobId/run` — Run specific job

---

## 6. Environment Variables

### Required
```bash
DATABASE_URL="file:./dev.db"                    # SQLite path (MVP)
ADMIN_EMAIL="admin@example.com"                 # Bootstrap admin
ADMIN_PASSWORD="change-this-password"           # Bootstrap admin password
AUTH_TOKEN_SECRET="change-this-local-secret"    # JWT signing secret
PAYMENT_PROOF_UPLOAD_DIR="./uploads/payment-proofs"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
PUBLIC_WEB_URL="http://localhost:3001"
```

### Dify Integration (when ready for live)
```bash
DIFY_WORKSPACE_MODE="dry-run"                   # or "live"
DIFY_BASE_URL="https://your-dify.example.com"
DIFY_ADMIN_TOKEN="<Dify INNER_API_KEY>"
DIFY_CONSOLE_BASE_URL="https://studio.your-domain.com"
```

### Meta Webhook Hardening
```bash
META_WEBHOOK_SIGNATURE_REQUIRED="true"
META_WEBHOOK_APP_SECRET="<meta-app-secret>"
CHANNEL_SECRET_KEY="<long-random-secret-for-encryption>"
```

### Rate Limits (dev = in-memory, prod = Redis)
```bash
LOGIN_RATE_LIMIT_MAX=20
LOGIN_RATE_LIMIT_WINDOW_MS=60000
META_WEBHOOK_RATE_LIMIT_MAX=200
META_WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_STORE=redis                          # or "memory"
REDIS_URL="redis://localhost:6379"
```

### Provisioning Worker
```bash
PROVISIONING_WORKER_ENABLED=true
PROVISIONING_WORKER_INTERVAL_MS=60000
PROVISIONING_WORKER_LIMIT=10
```

---

## 7. Development Workflow

### Install
```bash
pnpm install
```

### Run API (port 4000)
```bash
pnpm --filter @dify-saas/api start:dev
```

### Run Web (port 3001)
```bash
pnpm --filter @dify-saas/web dev
```

### Run Tests
```bash
pnpm --filter @dify-saas/api test        # 30+ vitest tests
pnpm typecheck                           # TypeScript check
pnpm build                               # Build all
```

### Database
```bash
# Generate Prisma client
cd apps/api && pnpm prisma:generate

# Push schema (creates/updates tables)
cd apps/api && pnpm prisma:push
```

### Backup/Restore (SQLite)
```bash
# Backup
DATABASE_URL=file:./apps/api/prod.db BACKUP_DIR=./backups pnpm backup:sqlite

# Restore
DATABASE_URL=file:./apps/api/prod.db BACKUP_PATH=./backups/prod.db.YYYYMMDDTHHMMSSZ.backup pnpm restore:sqlite
```

---

## 8. Phases & Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | Discovery & Dify Inner API research | ✅ Complete |
| **Phase 1** | SaaS Foundation (landing, pricing, signup, auth, plans) | ✅ Complete |
| **Phase 2** | Dify Provisioning + Embedded Studio | ✅ Complete (dry-run mode) |
| **Phase 3** | WhatsApp MVP (channel settings, webhooks, Dify reply, test messages) | ✅ Complete |
| **Phase 4** | Messenger/Pages + Production Hardening | 🔄 In Progress |
| **Phase 5** | CRM/Inbox, Analytics, Templates (optional) | ⏳ Future |

### Phase 4 Details (In Progress)
- ✅ Messenger channel settings
- ✅ Messenger webhook verification
- ✅ Messenger inbound → Dify → Send API reply
- ✅ Messenger retry + status callbacks (delivery/read)
- ✅ Message queue monitoring (`/admin/message-events/summary`)
- ✅ Dead-letter handling (max retries = 3)
- ✅ Basic API rate limits (login, webhooks)
- ✅ Usage limits (messages + channels per plan)
- ✅ Meta webhook signature verification
- ✅ Meta data deletion callback
- ⏳ **Next:** Redis/shared store for rate limits, Privacy Policy URLs, production deployment

---

## 9. Key Business Logic

### Payment Flow
1. Customer uploads payment proof → `POST /payments/proofs`
2. Customer submits payment details → `POST /payments/manual-proof`
3. Admin reviews → `POST /admin/approvals/:id/approve`
4. On approval → provisioning job queued → Dify workspace created
5. Customer sees "active" status + AI Studio link

### Provisioning Flow
1. Job created with status `queued`
2. Worker polls every 60s for `queued` or `failed` jobs with `nextRunAt` due
3. In `dry-run` mode: generates fake IDs (`dry_tenant_xxx`, `dry_account_xxx`)
4. In `live` mode: calls Dify Inner API `POST /inner/api/enterprise/workspace`
5. On success: organization updated with `difyTenantId` + `difyAccountId`
6. On failure: retry with backoff (max 3 attempts), then `dead`

### WhatsApp Message Flow
1. Meta sends webhook → `POST /webhooks/meta`
2. Signature verified (if enabled)
3. Idempotency check on `message.id`
4. Channel identified by `phone_number_id`
5. Inbound message saved to `message_events`
6. Dify App API called with customer's message
7. Dify response sent to WhatsApp Cloud API
8. Outbound message saved to `message_events`
9. Meta status callbacks update message status (`delivered`, `read`, `failed`)

### Messenger Message Flow
Same as WhatsApp but:
- Channel identified by `page_id`
- Uses Messenger Send API: `POST /me/messages?access_token=PAGE_TOKEN`
- Idempotency on `message.mid`

---

## 10. Testing

### Test Files (30+ specs in `apps/api/test/`)

| Test File | What It Tests |
|-----------|---------------|
| `phase1-foundation.spec.ts` | Auth, signup, login, plans |
| `auth-rbac.spec.ts` | Role-based access control |
| `payment-proof-upload.spec.ts` | File upload, metadata, sha256 |
| `provisioning.spec.ts` | Dify workspace provisioning |
| `provisioning-worker.spec.ts` | Background job runner |
| `provisioning-queue.spec.ts` | Job queue logic |
| `admin-cms.spec.ts` | Admin content management |
| `admin-provisioning.spec.ts` | Admin provisioning controls |
| `whatsapp-channel.spec.ts` | WhatsApp settings CRUD |
| `whatsapp-dify-reply.spec.ts` | WhatsApp → Dify → reply flow |
| `whatsapp-retry.spec.ts` | Retry logic |
| `whatsapp-test-message-status.spec.ts` | Test messages + status callbacks |
| `messenger-channel.spec.ts` | Messenger settings CRUD |
| `messenger-dify-reply.spec.ts` | Messenger → Dify → reply flow |
| `meta-webhooks.spec.ts` | Webhook verification + inbound |
| `meta-webhook-security.spec.ts` | Signature verification |
| `meta-data-deletion.spec.ts` | Data deletion callback |
| `rate-limit.spec.ts` | Rate limiting |
| `usage-limits.spec.ts` | Plan limits enforcement |
| `channel-limits.spec.ts` | Channel count limits |
| `billing-invoices.spec.ts` | Invoice generation |
| `plan-upgrade.spec.ts` | Subscription upgrades |
| `dashboard-status.spec.ts` | Dashboard data |
| `health-readiness.spec.ts` | Health checks |
| `message-hardening.spec.ts` | Message queue hardening |
| `persistence.spec.ts` | Data persistence |
| `backup-scripts.spec.ts` | Backup/restore scripts |
| `dify-gateway-config.spec.ts` | Dify gateway configuration |
| `dify-status.spec.ts` | Dify connectivity |
| `ui-polish.spec.ts` | UI/UX validation |
| `team-members.spec.ts` | Team management |
| `audit-logs.spec.ts` | Audit logging |

### Running Tests
```bash
cd apps/api
DATABASE_URL=file:./test.db pnpm test
```

---

## 11. Security Considerations

- **Token Encryption:** Meta access tokens, app secrets, and Dify API keys are stored as encrypted ciphertext (not plaintext)
- **Hash + Ciphertext Pattern:** `accessTokenHash` (for lookup) + `accessTokenCiphertext` (encrypted value)
- **Channel Secret Key:** `CHANNEL_SECRET_KEY` must be stable across restarts (used for encryption)
- **Rate Limiting:** Fixed-window rate limits on login and webhooks (in-memory for dev, Redis for prod)
- **Webhook Signature:** Meta webhooks verified with `X-Hub-Signature-256` using timing-safe comparison
- **No Secrets in Frontend:** API never returns actual tokens to the browser — only boolean flags (`hasAccessToken`, `hasDifyAppApiKey`)
- **Audit Logs:** All sensitive actions logged without storing passwords or secrets
- **Raw Body:** NestJS configured with `rawBody: true` for accurate webhook signature verification

---

## 12. Common Tasks for Agents

### Add a New API Endpoint
1. Add route in `apps/api/src/saas.controller.ts`
2. Add business logic in `apps/api/src/saas.service.ts`
3. Add Prisma query if needed
4. Add test in `apps/api/test/`
5. Run `pnpm --filter @dify-saas/api test`

### Modify Database Schema
1. Edit `apps/api/prisma/schema.prisma`
2. Run `cd apps/api && pnpm prisma:push`
3. Update TypeScript types if needed
4. Add migration logic in service if data transformation required

### Add a New Page to Web App
1. Create file in `apps/web/app/[page-name]/page.tsx`
2. Add to Navbar in `apps/web/app/components/Navbar.tsx` if needed
3. Use `fetch()` to call API with Bearer token from `localStorage`

### Configure Dify Live Provisioning
1. Set `DIFY_WORKSPACE_MODE=live`
2. Set `DIFY_BASE_URL` and `DIFY_ADMIN_TOKEN`
3. Ensure Dify instance has `INNER_API=true` and `INNER_API_KEY` set
4. Test with `GET /provisioning/dify/status`

### Connect WhatsApp Channel
1. Customer goes to `/integrations`
2. Fills: `phoneNumberId`, `wabaId`, `accessToken`, `verifyToken`, `difyAppId`, `difyAppApiKey`
3. System encrypts and stores tokens
4. Meta webhook URL set to `https://your-domain.com/webhooks/meta`
5. Send test message to verify

---

## 13. Known Limitations (MVP)

- **SQLite:** Single-file database — fine for MVP, must migrate to PostgreSQL before scaling
- **In-Memory Rate Limits:** Won't work across multiple API instances — migrate to Redis
- **Local File Storage:** Payment proofs stored on disk — move to S3/R2/MinIO in production
- **Manual Payments Only:** No card gateway integration yet
- **No Real-Time Updates:** Admin dashboard doesn't auto-refresh — manual reload needed
- **Dify SSO Not Implemented:** Customers click "AI Studio" and may need to log into Dify separately
- **No Email Notifications:** No SMTP integration for approval/status emails

---

## 14. Production Checklist (Summary)

See full checklist in `docs/production-checklist.md`:

- [ ] Migrate from SQLite to PostgreSQL
- [ ] Set strong `AUTH_TOKEN_SECRET` (not in git)
- [ ] Rotate admin credentials after first login
- [ ] Configure `PAYMENT_PROOF_UPLOAD_DIR` on persistent disk with backups
- [ ] Set `RATE_LIMIT_STORE=redis` with `REDIS_URL`
- [ ] Enable `PROVISIONING_WORKER_ENABLED=true`
- [ ] Configure Dify live mode with real `DIFY_BASE_URL` and `DIFY_ADMIN_TOKEN`
- [ ] Set `META_WEBHOOK_SIGNATURE_REQUIRED=true` + `META_WEBHOOK_APP_SECRET`
- [ ] Set `PUBLIC_WEB_URL` to production domain
- [ ] Run all tests: `pnpm test`
- [ ] Run typecheck: `pnpm typecheck`
- [ ] Run build: `pnpm build`
- [ ] Verify `git status` is clean
- [ ] Take SQLite backup before deploy
- [ ] Set up daily backup cron

---

## 15. Links & References

- **GitHub Repo:** https://github.com/Kareem-turky/dify-saas
- **Architecture Doc:** `docs/Dify_SaaS_Full_Integration_Architecture_AR.md` (Arabic, comprehensive)
- **Production Checklist:** `docs/production-checklist.md`
- **Dify Docs:** https://docs.dify.ai
- **Meta Webhooks:** https://developers.facebook.com/docs/graph-api/webhooks
- **WhatsApp Cloud API:** https://developers.facebook.com/docs/whatsapp/cloud-api

---

## 16. Contact / Owner

- **Owner:** Kareem Turky (كريم تركي)
- **Company:** Fulfly (fulfilment company)
- **Project Purpose:** SaaS platform for e-commerce merchants to build AI chatbots for WhatsApp/Messenger

---

*This document was generated to enable any AI agent to understand and work on the project without prior context.*
