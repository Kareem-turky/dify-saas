import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export type DifyWorkspaceMode = 'dry-run' | 'live';

export interface DifyWorkspaceResult {
  tenantId: string;
  accountId: string;
}

export interface DifyProvisioningConfig {
  mode: DifyWorkspaceMode;
  baseUrl?: string;
  adminToken?: string;
}

export interface DifyProvisioningStatus {
  mode: DifyWorkspaceMode;
  ready: boolean;
  baseUrl?: string;
  workspaceEndpoint?: string;
  tokenConfigured: boolean;
  requiresExistingDifyOwnerAccount: boolean;
}

export interface DifyWorkspaceInput {
  organizationId: string;
  organizationName: string;
  ownerUserId: string;
  ownerEmail?: string;
}

function readDifyProvisioningConfig(env: NodeJS.ProcessEnv = process.env): DifyProvisioningConfig {
  const mode = (env.DIFY_WORKSPACE_MODE || 'dry-run') as DifyWorkspaceMode;
  if (mode !== 'dry-run' && mode !== 'live') {
    throw new Error('DIFY_WORKSPACE_MODE must be dry-run or live');
  }

  const config = {
    mode,
    baseUrl: env.DIFY_BASE_URL,
    adminToken: env.DIFY_ADMIN_TOKEN
  };

  if (mode === 'live' && (!config.baseUrl || !config.adminToken)) {
    throw new Error('Dify live provisioning requires DIFY_BASE_URL and DIFY_ADMIN_TOKEN');
  }

  return config;
}

@Injectable()
export class DifyProvisioningGateway {
  private readonly config: DifyProvisioningConfig;

  constructor() {
    this.config = readDifyProvisioningConfig();
  }

  getStatus(): DifyProvisioningStatus {
    if (this.config.mode === 'dry-run') {
      return {
        mode: 'dry-run',
        ready: true,
        tokenConfigured: false,
        requiresExistingDifyOwnerAccount: false
      };
    }

    return {
      mode: 'live',
      ready: true,
      baseUrl: this.config.baseUrl,
      workspaceEndpoint: this.workspaceEndpoint(),
      tokenConfigured: Boolean(this.config.adminToken),
      requiresExistingDifyOwnerAccount: true
    };
  }

  async ensureWorkspace(input: DifyWorkspaceInput): Promise<DifyWorkspaceResult> {
    if (this.config.mode === 'live') {
      return this.ensureLiveWorkspace(input);
    }

    return {
      tenantId: `dry_tenant_${input.organizationId}`,
      accountId: `dry_account_${input.ownerUserId}`
    };
  }

  private workspaceEndpoint(): string {
    return new URL('/inner/api/enterprise/workspace', this.config.baseUrl).toString();
  }

  private async ensureLiveWorkspace(input: DifyWorkspaceInput): Promise<DifyWorkspaceResult> {
    if (!input.ownerEmail) {
      throw new Error('Dify live provisioning requires ownerEmail');
    }

    const response = await fetch(this.workspaceEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inner-Api-Key': this.config.adminToken! },
      body: JSON.stringify({ name: input.organizationName, owner_email: input.ownerEmail })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const difyMessage = typeof data?.message === 'string' ? data.message : '';
      if (response.status === 404 && difyMessage.toLowerCase().includes('owner account not found')) {
        throw new Error(`Dify owner account ${input.ownerEmail} was not found. Create or activate this account in Dify before retrying provisioning.`);
      }

      const message = difyMessage || `Dify workspace creation failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    const tenantId = data?.tenant?.id;
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Dify workspace creation response did not include tenant.id');
    }

    return { tenantId, accountId: input.ownerUserId };
  }
}

@Injectable()
export class DifyProvisioningService {
  constructor(private readonly db: PrismaService, private readonly gateway: DifyProvisioningGateway) {}

  async runJob(jobId: string) {
    const job = await this.db.provisioningJob.findUnique({ where: { id: jobId }, include: { organization: true } });
    if (!job) throw new NotFoundException('Provisioning job not found');
    if (job.type !== 'create_dify_workspace') throw new BadRequestException('Unsupported provisioning job type');
    if (job.status === 'completed') return { job, organization: job.organization };
    if (job.status !== 'queued' && job.status !== 'failed') throw new BadRequestException('Provisioning job is already running');

    const runningJob = await this.db.provisioningJob.update({
      where: { id: job.id },
      data: { status: 'running', attempts: { increment: 1 }, lastError: null }
    });

    try {
      const owner = await this.db.user.findUnique({ where: { id: job.organization.ownerUserId } });
      const result = await this.gateway.ensureWorkspace({
        organizationId: job.organization.id,
        organizationName: job.organization.name,
        ownerUserId: job.organization.ownerUserId,
        ownerEmail: owner?.email
      });

      return this.db.$transaction(async tx => {
        const organization = await tx.organization.update({
          where: { id: job.organization.id },
          data: { status: 'active', difyTenantId: result.tenantId, difyAccountId: result.accountId }
        });
        const completedJob = await tx.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            payload: { ...(job.payload as Record<string, unknown>), difyTenantId: result.tenantId, difyAccountId: result.accountId }
          }
        });
        return { job: completedJob, organization };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown provisioning error';
      const failedJob = await this.db.provisioningJob.update({ where: { id: runningJob.id }, data: { status: 'failed', lastError: message } });
      throw new BadRequestException({ message: 'Dify provisioning failed', job: failedJob });
    }
  }
}
