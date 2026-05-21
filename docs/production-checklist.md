# Production Checklist

This checklist is for promoting the Dify SaaS platform from local MVP to a production-like deployment. Do not paste real secrets into this file.

## Required environment

- `DATABASE_URL`: SQLite `file:` path for MVP, or migrate to managed Postgres later.
- `AUTH_TOKEN_SECRET`: long random value managed outside git.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: initial admin bootstrap credentials, rotated after first login.
- `PAYMENT_PROOF_UPLOAD_DIR`: persistent directory with backups enabled.
- `NEXT_PUBLIC_API_BASE_URL`: public API URL used by the web app.
- `RATE_LIMIT_STORE=redis` and `REDIS_URL`: shared rate limits across API processes.
- `PROVISIONING_WORKER_ENABLED=true`: enable automatic Dify provisioning retries.
- `PROVISIONING_WORKER_INTERVAL_MS=60000` and `PROVISIONING_WORKER_LIMIT=10`.
- Dify live provisioning variables only when ready: `DIFY_WORKSPACE_MODE=live`, `DIFY_BASE_URL`, `DIFY_ADMIN_TOKEN`.

## Health and readiness

- Public liveness: `GET /health`.
- Admin readiness: `GET /admin/readiness` with an admin bearer token.
- Confirm readiness shows database, admin user, auth secret, proof storage, Dify gateway, and provisioning worker status.

## Backup

Run before deploys and at least daily for the MVP SQLite setup:

```bash
DATABASE_URL=file:./apps/api/prod.db BACKUP_DIR=./backups pnpm backup:sqlite
```

Store resulting `.backup` and `.sha256` files outside the application server when possible.

## Restore

Stop API workers first, then restore:

```bash
DATABASE_URL=file:./apps/api/prod.db BACKUP_PATH=./backups/prod.db.YYYYMMDDTHHMMSSZ.backup pnpm restore:sqlite
```

After restore:

1. Start API.
2. Check `/health`.
3. Login as admin.
4. Check `/admin/readiness`.
5. Open customer dashboard and admin approvals.

## Deploy safety checks

- Run `pnpm --filter @dify-saas/api test`.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Confirm `git status --short` is clean.
- Confirm no credentials were committed.
- Take a Backup immediately before schema changes.
- Keep one rollback Backup from before the deploy.

## Current MVP limitations

- SQLite is acceptable for MVP but should be migrated to Postgres before higher traffic.
- Receipts are JSON/API-first; PDF rendering can be added later.
- Local file proof storage must live on persistent disk and be backed up.
