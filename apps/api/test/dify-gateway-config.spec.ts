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
        workspaceEndpoint: 'https://dify.example.com/inner/api/enterprise/workspace',
        tokenConfigured: true,
        requiresExistingDifyOwnerAccount: true
      });
      expect(JSON.stringify(gateway.getStatus())).not.toContain('inner-secret');
    });
  });

  it('calls the Dify inner enterprise workspace endpoint in live mode and maps the tenant id', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tenant: { id: 'tenant_live_123', name: 'Live Co', status: 'normal' } })
      });
      const previousFetch = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        const gateway = new DifyProvisioningGateway();
        const workspace = await gateway.ensureWorkspace({ organizationId: 'org_live', organizationName: 'Live Co', ownerUserId: 'usr_live', ownerEmail: 'owner@live.co' });

        expect(fetchMock).toHaveBeenCalledWith('https://dify.example.com/inner/api/enterprise/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Inner-Api-Key': 'inner-secret' },
          body: JSON.stringify({ name: 'Live Co', owner_email: 'owner@live.co' })
        });
        expect(workspace).toEqual({ tenantId: 'tenant_live_123', accountId: 'usr_live' });
      } finally {
        global.fetch = previousFetch;
      }
    });
  });

  it('turns Dify missing owner responses into an actionable provisioning error', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'owner account not found.' })
      });
      const previousFetch = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        const gateway = new DifyProvisioningGateway();
        await expect(gateway.ensureWorkspace({ organizationId: 'org_live', organizationName: 'Live Co', ownerUserId: 'usr_live', ownerEmail: 'owner@live.co' }))
          .rejects.toThrow('Dify owner account owner@live.co was not found. Create or activate this account in Dify before retrying provisioning.');
      } finally {
        global.fetch = previousFetch;
      }
    });
  });
});
