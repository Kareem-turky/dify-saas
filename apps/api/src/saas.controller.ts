import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DifyProvisioningGateway, DifyProvisioningService } from './dify-provisioning.service';
import { SaasService } from './saas.service';
import { ProvisioningWorkerService } from './provisioning-worker.service';

@Controller()
export class SaasController {
  constructor(private readonly saas: SaasService, private readonly provisioning: DifyProvisioningService, private readonly difyGateway: DifyProvisioningGateway, private readonly provisioningWorker: ProvisioningWorkerService) {}

  @Get('health') health() { return { ok: true, service: 'dify-saas-api' }; }
  @Get('plans') listPlans() { return this.saas.listPlans(); }
  @Post('auth/signup') signup(@Body() body: Parameters<SaasService['signup']>[0]) { return this.saas.signup(body); }
  @Post('auth/login') login(@Body() body: Parameters<SaasService['login']>[0]) { return this.saas.login(body); }
  @Get('auth/me') async me(@Headers('authorization') authorization?: string) { return { user: await this.saas.currentUser(authorization) }; }
  @Post('payments/proofs')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadPaymentProof(@UploadedFile() file: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }, @Body('organizationId') organizationId: string) {
    return this.saas.storePaymentProof({ organizationId, file });
  }
  @Post('payments/manual-proof') submitManualPayment(@Body() body: Parameters<SaasService['submitManualPayment']>[0]) { return this.saas.submitManualPayment(body); }
  @Post('subscriptions/upgrade') requestPlanUpgrade(@Body() body: Parameters<SaasService['requestPlanUpgrade']>[1], @Headers('authorization') authorization?: string) { return this.saas.requestPlanUpgrade(authorization, body); }
  @Get('team/members') listTeamMembers(@Headers('authorization') authorization?: string) { return this.saas.listTeamMembers(authorization); }
  @Post('team/members') addTeamMember(@Body() body: Parameters<SaasService['addTeamMember']>[1], @Headers('authorization') authorization?: string) { return this.saas.addTeamMember(authorization, body); }
  @Get('channels/whatsapp') getWhatsappChannel(@Headers('authorization') authorization?: string) { return this.saas.getWhatsappChannel(authorization); }
  @Put('channels/whatsapp') saveWhatsappChannel(@Body() body: Parameters<SaasService['saveWhatsappChannel']>[1], @Headers('authorization') authorization?: string) { return this.saas.saveWhatsappChannel(authorization, body); }
  @Get('channels/messenger') getMessengerChannel(@Headers('authorization') authorization?: string) { return this.saas.getMessengerChannel(authorization); }
  @Put('channels/messenger') saveMessengerChannel(@Body() body: Parameters<SaasService['saveMessengerChannel']>[1], @Headers('authorization') authorization?: string) { return this.saas.saveMessengerChannel(authorization, body); }
  @Post('channels/whatsapp/test-message') sendWhatsappTestMessage(@Body() body: { to?: string; text?: string }, @Headers('authorization') authorization?: string) { return this.saas.sendWhatsappTestMessage(authorization, body); }
  @Get('webhooks/meta') verifyMetaWebhook(@Query() query: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }) { return this.saas.verifyMetaWebhook(query); }
  @Post('webhooks/meta') receiveMetaWebhook(@Body() body: unknown, @Headers('x-hub-signature-256') signature?: string, @Headers('x-forwarded-for') forwardedFor?: string, @Req() request?: { rawBody?: Buffer; ip?: string }) { return this.saas.receiveMetaWebhook(body, signature, request?.rawBody, forwardedFor || request?.ip); }
  @Get('admin/approvals') async listApprovals(@Headers('authorization') authorization?: string) { await this.saas.requireAdmin(authorization); return this.saas.listApprovals(); }
  @Get('admin/audit-logs') async listAuditLogs(@Headers('authorization') authorization?: string) { await this.saas.requireAdmin(authorization); return this.saas.listAuditLogs(); }
  @Get('admin/message-events/summary') async messageEventSummary(@Headers('authorization') authorization?: string) { await this.saas.requireAdmin(authorization); return this.saas.getMessageEventSummary(); }
  @Post('admin/message-events/retry-failed') async retryFailedMessageEvents(@Body() body: { limit?: number }, @Headers('authorization') authorization?: string) { const admin = await this.saas.requireAdmin(authorization); return this.saas.retryFailedMessageEvents({ limit: body?.limit, actorUserId: admin.id }); }
  @Post('admin/approvals/:paymentId/approve') async approve(@Param('paymentId') paymentId: string, @Body() body: { notes?: string }, @Headers('authorization') authorization?: string) { const admin = await this.saas.requireAdmin(authorization); return this.saas.approvePayment(paymentId, body?.notes, admin.id); }
  @Get('provisioning/dify/status') difyStatus() { return this.difyGateway.getStatus(); }
  @Get('provisioning/jobs') async jobs(@Headers('authorization') authorization?: string) { await this.saas.requireAdmin(authorization); return this.saas.listProvisioningJobs(); }
  @Post('provisioning/jobs/run-due') async runDueProvisioningJobs(@Headers('authorization') authorization?: string) { const admin = await this.saas.requireAdmin(authorization); return this.provisioning.runDueJobs(10, admin.id); }
  @Post('provisioning/jobs/:jobId/run') async runProvisioningJob(@Param('jobId') jobId: string, @Headers('authorization') authorization?: string) { const admin = await this.saas.requireAdmin(authorization); return this.provisioning.runJob(jobId, admin.id); }
  @Get('organizations/:organizationId/dashboard') dashboard(@Param('organizationId') organizationId: string) { return this.saas.getOrganizationDashboard(organizationId); }
}
