import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface DifyWorkspaceResult {
  tenantId: string;
  accountId: string;
}

@Injectable()
export class DifyProvisioningGateway {
  async ensureWorkspace(input: { organizationId: string; organizationName: string; ownerUserId: string }): Promise<DifyWorkspaceResult> {
    // Safe default for local/dev/tests. The production HTTP adapter will replace this once
    // the target Dify admin API credentials/endpoints are configured.
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
