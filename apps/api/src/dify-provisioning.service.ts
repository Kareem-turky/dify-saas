import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  accountEndpoint?: string;
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

function nextBackoffRunAt(attempts: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function dueJobWhere(now: Date): Prisma.ProvisioningJobWhereInput {
  return {
    status: { in: ['queued', 'failed'] },
    OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
  };
}

function ownerNameFromEmail(email: string) {
  return email.split('@', 1)[0] || email;
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
      accountEndpoint: this.accountEndpoint(),
      workspaceEndpoint: this.workspaceEndpoint(),
      tokenConfigured: Boolean(this.config.adminToken),
      requiresExistingDifyOwnerAccount: false
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

  private accountEndpoint(): string {
    return new URL('/inner/api/enterprise/account/ensure', this.config.baseUrl).toString();
  }

  private workspaceEndpoint(): string {
    return new URL('/inner/api/enterprise/workspace', this.config.baseUrl).toString();
  }

  private innerHeaders() {
    return { 'Content-Type': 'application/json', 'X-Inner-Api-Key': this.config.adminToken! };
  }

  private async ensureLiveWorkspace(input: DifyWorkspaceInput): Promise<DifyWorkspaceResult> {
    if (!input.ownerEmail) {
      throw new Error('Dify live provisioning requires ownerEmail');
    }

    const accountResponse = await fetch(this.accountEndpoint(), {
      method: 'POST',
      headers: this.innerHeaders(),
      body: JSON.stringify({ email: input.ownerEmail, name: ownerNameFromEmail(input.ownerEmail) })
    });
    const accountData = await accountResponse.json().catch(() => ({}));
    if (!accountResponse.ok) {
      const message = typeof accountData?.message === 'string' ? accountData.message : `Dify account ensure failed with HTTP ${accountResponse.status}`;
      throw new Error(message);
    }

    const accountId = accountData?.account?.id;
    if (!accountId || typeof accountId !== 'string') {
      throw new Error('Dify account ensure response did not include account.id');
    }

    const response = await fetch(this.workspaceEndpoint(), {
      method: 'POST',
      headers: this.innerHeaders(),
      body: JSON.stringify({ name: input.organizationName, owner_email: input.ownerEmail })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const difyMessage = typeof data?.message === 'string' ? data.message : '';
      if (response.status === 404 && difyMessage.toLowerCase().includes('owner account not found')) {
        throw new Error(`Dify owner account ${input.ownerEmail} was not found after account ensure. Check Dify account ensure endpoint before retrying provisioning.`);
      }

      const message = difyMessage || `Dify workspace creation failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    const tenantId = data?.tenant?.id;
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Dify workspace creation response did not include tenant.id');
    }

    return { tenantId, accountId };
  }
}

@Injectable()
export class DifyProvisioningService {
  constructor(private readonly db: PrismaService, private readonly gateway: DifyProvisioningGateway) {}

  async runJob(jobId: string, actorUserId?: string) {
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
            nextRunAt: null,
            payload: { ...(job.payload as Record<string, unknown>), difyTenantId: result.tenantId, difyAccountId: result.accountId }
          }
        });
        await tx.auditLog.create({
          data: {
            id: `aud_${Math.random().toString(36).slice(2, 10)}`,
            actorUserId,
            organizationId: organization.id,
            action: 'provisioning_job_completed',
            targetType: 'provisioning_job',
            targetId: completedJob.id,
            metadata: { tenantId: result.tenantId, accountId: result.accountId }
          }
        });
        return { job: completedJob, organization };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown provisioning error';
      const exhausted = runningJob.attempts >= runningJob.maxAttempts;
      const failedJob = await this.db.provisioningJob.update({
        where: { id: runningJob.id },
        data: {
          status: exhausted ? 'dead' : 'failed',
          lastError: message,
          nextRunAt: exhausted ? null : nextBackoffRunAt(runningJob.attempts)
        }
      });
      await this.db.auditLog.create({
        data: {
          id: `aud_${Math.random().toString(36).slice(2, 10)}`,
          actorUserId,
          organizationId: job.organization.id,
          action: exhausted ? 'provisioning_job_dead' : 'provisioning_job_failed',
          targetType: 'provisioning_job',
          targetId: failedJob.id,
          metadata: { error: message, attempts: failedJob.attempts, maxAttempts: failedJob.maxAttempts }
        }
      });
      throw new BadRequestException({ message: 'Dify provisioning failed', job: failedJob });
    }
  }

  async runDueJobs(limit = 10, actorUserId?: string) {
    const jobs = await this.db.provisioningJob.findMany({
      where: dueJobWhere(new Date()),
      orderBy: { createdAt: 'asc' },
      take: limit
    });

    const results: Array<{ jobId: string; status: 'completed' | 'failed'; error?: string }> = [];
    for (const job of jobs) {
      try {
        const result = await this.runJob(job.id, actorUserId);
        results.push({ jobId: result.job.id, status: 'completed' });
      } catch (error) {
        const response = error instanceof BadRequestException ? error.getResponse() : undefined;
        const maybeJob = typeof response === 'object' && response !== null && 'job' in response ? (response as { job?: { id?: string; lastError?: string | null } }).job : undefined;
        const message = maybeJob?.lastError || (error instanceof Error ? error.message : 'Unknown provisioning error');
        results.push({ jobId: maybeJob?.id || job.id, status: 'failed', error: message });
      }
    }

    return {
      processed: results.length,
      completed: results.filter(result => result.status === 'completed').length,
      failed: results.filter(result => result.status === 'failed').length,
      results
    };
  }
}
