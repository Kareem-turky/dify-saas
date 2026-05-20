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

  async ensureWorkspace(input: { organizationId: string; organizationName: string; ownerUserId: string }): Promise<DifyWorkspaceResult> {
    if (this.config.mode === 'live') {
      // Credentials are validated in the constructor, but the live HTTP adapter is kept
      // disabled until the target Dify admin endpoints are confirmed.
      throw new Error('Live Dify provisioning adapter is not implemented yet');
    }

    return {
      tenantId: `dry_tenant_${input.organizationId}`,
      accountId: `dry_account_${input.ownerUserId}`
    };
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
      const result = await this.gateway.ensureWorkspace({
        organizationId: job.organization.id,
        organizationName: job.organization.name,
        ownerUserId: job.organization.ownerUserId
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
