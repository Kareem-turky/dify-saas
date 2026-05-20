import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DifyProvisioningGateway, DifyProvisioningService } from './dify-provisioning.service';
import { SaasService } from './saas.service';

@Controller()
export class SaasController {
  constructor(private readonly saas: SaasService, private readonly provisioning: DifyProvisioningService, private readonly difyGateway: DifyProvisioningGateway) {}

  @Get('health') health() { return { ok: true, service: 'dify-saas-api' }; }
  @Get('plans') listPlans() { return this.saas.listPlans(); }
  @Post('auth/signup') signup(@Body() body: Parameters<SaasService['signup']>[0]) { return this.saas.signup(body); }
  @Post('payments/proofs')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadPaymentProof(@UploadedFile() file: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }, @Body('organizationId') organizationId: string) {
    return this.saas.storePaymentProof({ organizationId, file });
  }
  @Post('payments/manual-proof') submitManualPayment(@Body() body: Parameters<SaasService['submitManualPayment']>[0]) { return this.saas.submitManualPayment(body); }
  @Get('admin/approvals') listApprovals() { return this.saas.listApprovals(); }
  @Post('admin/approvals/:paymentId/approve') approve(@Param('paymentId') paymentId: string, @Body() body: { notes?: string }) { return this.saas.approvePayment(paymentId, body?.notes); }
  @Get('provisioning/dify/status') difyStatus() { return this.difyGateway.getStatus(); }
  @Get('provisioning/jobs') jobs() { return this.saas.listProvisioningJobs(); }
  @Post('provisioning/jobs/:jobId/run') runProvisioningJob(@Param('jobId') jobId: string) { return this.provisioning.runJob(jobId); }
  @Get('organizations/:organizationId/dashboard') dashboard(@Param('organizationId') organizationId: string) { return this.saas.getOrganizationDashboard(organizationId); }
}
