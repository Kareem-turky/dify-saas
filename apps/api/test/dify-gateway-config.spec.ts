import { describe, expect, it } from 'vitest';
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

      const workspace = await gateway.ensureWorkspace({ organizationId: 'org_123', organizationName: 'Dry Co', ownerUserId: 'usr_456' });

      expect(workspace).toEqual({ tenantId: 'dry_tenant_org_123', accountId: 'dry_account_usr_456' });
    });
  });

  it('fails fast when live mode is selected without Dify credentials', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: undefined, DIFY_ADMIN_TOKEN: undefined }, () => {
      expect(() => new DifyProvisioningGateway()).toThrow('Dify live provisioning requires DIFY_BASE_URL and DIFY_ADMIN_TOKEN');
    });
  });
});
