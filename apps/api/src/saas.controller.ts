import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SaasService } from './saas.service';

@Controller()
export class SaasController {
  constructor(private readonly saas: SaasService) {}

  @Get('health') health() { return { ok: true, service: 'dify-saas-api' }; }
  @Get('plans') listPlans() { return this.saas.listPlans(); }
  @Post('auth/signup') signup(@Body() body: Parameters<SaasService['signup']>[0]) { return this.saas.signup(body); }
  @Post('payments/manual-proof') submitManualPayment(@Body() body: Parameters<SaasService['submitManualPayment']>[0]) { return this.saas.submitManualPayment(body); }
  @Get('admin/approvals') listApprovals() { return this.saas.listApprovals(); }
  @Post('admin/approvals/:paymentId/approve') approve(@Param('paymentId') paymentId: string, @Body() body: { notes?: string }) { return this.saas.approvePayment(paymentId, body?.notes); }
  @Get('provisioning/jobs') jobs() { return this.saas.listProvisioningJobs(); }
}
