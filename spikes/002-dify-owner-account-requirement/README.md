# 002: Dify owner-account requirement and admin readiness

## Question

Given the existing Dify inner workspace endpoint, when the SaaS platform runs live provisioning, can it create both the customer account and workspace automatically, or does it require a pre-existing Dify owner account?

## Research notes

The available Dify endpoint from spike 001 is:

```text
POST /inner/api/enterprise/workspace
```

It loads the owner account by email before creating the workspace:

```python
account = db.session.scalar(select(Account).where(Account.email == args.owner_email).limit(1))
if account is None:
    return {"message": "owner account not found."}, 404
```

The broader Dify codebase has console registration/invitation flows, but no separate inner API endpoint was found that safely creates an owner account from the external platform without modifying Dify.

## Implementation in SaaS platform

Because this project is intentionally separate from `/Users/mac/dify`, the safe MVP behavior is:

1. Keep live provisioning pointed at Dify's existing inner workspace endpoint.
2. Make the owner-account requirement explicit in the SaaS admin status endpoint/UI.
3. Convert Dify's `404 owner account not found.` response into an actionable provisioning error.
4. Keep secrets redacted: status endpoints show only whether a token is configured, never the token value.

Added SaaS API endpoint:

```text
GET /provisioning/dify/status
```

Response shape:

```json
{
  "mode": "live",
  "ready": true,
  "baseUrl": "https://dify.example.com",
  "workspaceEndpoint": "https://dify.example.com/inner/api/enterprise/workspace",
  "tokenConfigured": true,
  "requiresExistingDifyOwnerAccount": true
}
```

For dry-run:

```json
{
  "mode": "dry-run",
  "ready": true,
  "tokenConfigured": false,
  "requiresExistingDifyOwnerAccount": false
}
```

## Tests

Added/updated tests:

```text
apps/api/test/dify-gateway-config.spec.ts
apps/api/test/dify-status.spec.ts
```

Coverage:

- dry-run status is safe and ready;
- live status exposes endpoint/config readiness without leaking `DIFY_ADMIN_TOKEN`;
- missing owner response becomes:

```text
Dify owner account owner@live.co was not found. Create or activate this account in Dify before retrying provisioning.
```

## Verdict: PARTIAL

### What worked

- We can clearly detect and communicate the current owner-account dependency.
- Admin UI can now show whether Dify gateway is in dry-run or live mode.
- Provisioning failures are actionable instead of generic 404 errors.
- No credentials are exposed through API responses or UI.

### What did not work

- No safe existing Dify inner API for creating owner accounts was found without changing Dify.
- Full live end-to-end customer self-access still depends on pre-creating/activating the customer email inside Dify.

### Recommendation for the real build

For production, choose one of two paths:

1. **No-Dify-modification path:** keep requiring Dify owner accounts to be created/invited through existing Dify admin/user flows before live provisioning retry.
2. **Small controlled Dify extension path:** add a dedicated Dify inner API endpoint to ensure/create an account, then call workspace creation. This should be a separate TDD slice in `/Users/mac/dify`, not hidden inside the external SaaS project.
