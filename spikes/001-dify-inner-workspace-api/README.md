# 001: Dify inner workspace provisioning API

## Question

Given the existing self-hosted Dify codebase, when the external SaaS platform needs to create a customer AI Studio workspace, is there a safe internal API endpoint we can call instead of writing directly to Dify's database?

## Research notes

Inspected `/Users/mac/dify/api` and found the existing inner API workspace controller:

```text
controllers/inner_api/workspace/workspace.py
```

Relevant route:

```text
POST /inner/api/enterprise/workspace
```

Required request body:

```json
{
  "name": "Workspace name",
  "owner_email": "owner@example.com"
}
```

Auth wrapper:

```text
controllers/inner_api/wraps.py
enterprise_inner_api_only
```

Required Dify-side config/header:

```text
Dify must have INNER_API enabled.
Client must send X-Inner-Api-Key matching Dify INNER_API_KEY.
```

Success response shape includes:

```json
{
  "message": "enterprise workspace created.",
  "tenant": {
    "id": "...",
    "name": "...",
    "plan": "...",
    "status": "..."
  }
}
```

## Implementation in SaaS platform

Added a live adapter path to `DifyProvisioningGateway`:

```text
DIFY_WORKSPACE_MODE=live
DIFY_BASE_URL=https://your-dify.example.com
DIFY_ADMIN_TOKEN=<Dify INNER_API_KEY>
```

The adapter calls:

```text
POST <DIFY_BASE_URL>/inner/api/enterprise/workspace
Header: X-Inner-Api-Key: <DIFY_ADMIN_TOKEN>
Body: { name, owner_email }
```

Dry-run remains the default and still requires no Dify credentials.

## Tests

Added TDD coverage in:

```text
apps/api/test/dify-gateway-config.spec.ts
```

The tests prove:

- dry-run is the safe default without credentials;
- live mode fails fast without credentials;
- live mode calls the Dify inner enterprise workspace endpoint with the right URL, header, and body;
- the response maps `tenant.id` into the SaaS `difyTenantId` flow.

## Verdict: VALIDATED

### What worked

- Dify already has an internal enterprise workspace creation endpoint.
- The endpoint does not require direct DB writes.
- It supports assigning an existing Dify account as owner by email.
- The SaaS gateway can safely call it behind explicit `DIFY_WORKSPACE_MODE=live`.

### What did not get validated yet

- A real network call to the running Dify instance was not made in this spike.
- We still need to ensure the customer's owner account exists in Dify before workspace creation, because the endpoint returns 404 if `owner_email` does not already exist.

### Recommendation for the real build

Next TDD slice should add Dify owner-account provisioning / ensure-account behavior before workspace creation, or explicitly document that customer emails must be pre-created in Dify. Keep dry-run as the default until real Dify credentials and `INNER_API=true` are configured.
