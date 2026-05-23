import { describe, expect, it, vi } from 'vitest';
import { DifyProvisioningGateway } from '../src/dify-provisioning.service';

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = {
    DIFY_WORKSPACE_MODE: process.env.DIFY_WORKSPACE_MODE,
    DIFY_BASE_URL: process.env.DIFY_BASE_URL,
    DIFY_ADMIN_TOKEN: process.env.DIFY_ADMIN_TOKEN
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('Dify provisioning gateway configuration', () => {
  it('defaults to safe dry-run mode and returns deterministic local IDs without credentials', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: undefined, DIFY_BASE_URL: undefined, DIFY_ADMIN_TOKEN: undefined }, async () => {
      const gateway = new DifyProvisioningGateway();

      const workspace = await gateway.ensureWorkspace({ organizationId: 'org_123', organizationName: 'Dry Co', ownerUserId: 'usr_456', ownerEmail: 'owner@example.com' });

      expect(workspace).toEqual({ tenantId: 'dry_tenant_org_123', accountId: 'dry_account_usr_456' });
      expect(gateway.getStatus()).toMatchObject({ mode: 'dry-run', ready: true, tokenConfigured: false, requiresExistingDifyOwnerAccount: false });
    });
  });

  it('fails fast when live mode is selected without Dify credentials', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: undefined, DIFY_ADMIN_TOKEN: undefined }, () => {
      expect(() => new DifyProvisioningGateway()).toThrow('Dify live provisioning requires DIFY_BASE_URL and DIFY_ADMIN_TOKEN');
    });
  });

  it('exposes live status without leaking the inner API key', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, () => {
      const gateway = new DifyProvisioningGateway();

      expect(gateway.getStatus()).toEqual({
        mode: 'live',
        ready: true,
        baseUrl: 'https://dify.example.com',
        accountEndpoint: 'https://dify.example.com/inner/api/enterprise/account/ensure',
        workspaceEndpoint: 'https://dify.example.com/inner/api/enterprise/workspace',
        tokenConfigured: true,
        requiresExistingDifyOwnerAccount: false
      });
      expect(JSON.stringify(gateway.getStatus())).not.toContain('inner-secret');
    });
  });

  it('ensures the Dify owner account before creating the workspace in live mode', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ account: { id: 'account_live_123', email: 'owner@live.co' }, created: true })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tenant: { id: 'tenant_live_123', name: 'Live Co', status: 'normal' } })
        });
      const previousFetch = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        const gateway = new DifyProvisioningGateway();
        const workspace = await gateway.ensureWorkspace({ organizationId: 'org_live', organizationName: 'Live Co', ownerUserId: 'usr_live', ownerEmail: 'owner@live.co' });

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://dify.example.com/inner/api/enterprise/account/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Inner-Api-Key': 'inner-secret' },
          body: JSON.stringify({ email: 'owner@live.co', name: 'owner' })
        });
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://dify.example.com/inner/api/enterprise/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Inner-Api-Key': 'inner-secret' },
          body: JSON.stringify({ name: 'Live Co', owner_email: 'owner@live.co' })
        });
        expect(workspace).toEqual({ tenantId: 'tenant_live_123', accountId: 'account_live_123' });
      } finally {
        global.fetch = previousFetch;
      }
    });
  });

  it('turns Dify missing owner responses into an actionable provisioning error', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ account: { id: 'account_live_123' } }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'owner account not found.' })
        });
      const previousFetch = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        const gateway = new DifyProvisioningGateway();
        await expect(gateway.ensureWorkspace({ organizationId: 'org_live', organizationName: 'Live Co', ownerUserId: 'usr_live', ownerEmail: 'owner@live.co' }))
          .rejects.toThrow('Dify owner account owner@live.co was not found after account ensure. Check Dify account ensure endpoint before retrying provisioning.');
      } finally {
        global.fetch = previousFetch;
      }
    });
  });
});
