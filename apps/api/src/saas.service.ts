import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

@Injectable()
export class SaasService {
  constructor(private readonly db: PrismaService) {}

  listPlans() {
    return this.db.plan.findMany({ orderBy: { monthlyPriceEgp: 'asc' } });
  }

  async signup(input: { name: string; email: string; phone?: string; companyName: string; industry?: string; preferredLanguage?: 'ar' | 'en'; planId: string }) {
    const plan = await this.db.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new BadRequestException('Unknown plan');
    const existingUser = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existingUser) throw new BadRequestException('Email already registered');

    const userId = id('usr');
    const organizationId = id('org');
    const subscriptionId = id('sub');

    const { user, organization, subscription } = await this.db.$transaction(async tx => {
      const organization = await tx.organization.create({
        data: { id: organizationId, name: input.companyName, ownerUserId: userId, status: 'pending_payment', industry: input.industry }
      });
      const user = await tx.user.create({
        data: { id: userId, name: input.name, email: input.email.toLowerCase(), phone: input.phone, role: 'customer', preferredLanguage: input.preferredLanguage ?? 'ar', organizationId }
      });
      const subscription = await tx.subscription.create({
        data: { id: subscriptionId, organizationId, planId: plan.id, status: 'pending_payment' }
      });
      return { user, organization, subscription };
    });

    return { user, organization, subscription, nextStep: 'submit_manual_payment_or_card_payment' };
  }

  async submitManualPayment(input: { organizationId: string; method: 'instapay' | 'vodafone_cash' | 'bank_transfer'; amountEgp: number; reference?: string; proofUrl?: string }) {
    const organization = await this.db.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');
    const subscription = await this.db.subscription.findFirst({ where: { organizationId: organization.id } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const paymentId = id('pay');
    const approvalId = id('apr');

    const result = await this.db.$transaction(async tx => {
      const updatedOrganization = await tx.organization.update({ where: { id: organization.id }, data: { status: 'pending_approval' } });
      await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'needs_review' } });
      const payment = await tx.payment.create({
        data: { id: paymentId, organizationId: organization.id, subscriptionId: subscription.id, method: input.method, amountEgp: input.amountEgp, status: 'needs_review', reference: input.reference, proofUrl: input.proofUrl }
      });
      const approval = await tx.approvalRequest.create({ data: { id: approvalId, organizationId: organization.id, paymentId: payment.id, status: 'open' } });
      return { payment, approval, organization: updatedOrganization };
    });

    return { ...result, nextStep: 'admin_review' };
  }

  async listApprovals() {
    const approvals = await this.db.approvalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { payment: true, organization: true }
    });
    return approvals.map(({ payment, organization, ...approval }) => ({ approval, payment, organization }));
  }

  async approvePayment(paymentId: string, notes?: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const approval = await this.db.approvalRequest.findFirst({ where: { paymentId: payment.id, status: 'open' } });
    if (!approval) throw new BadRequestException('No open approval request for this payment');
    const subscription = await this.db.subscription.findUnique({ where: { id: payment.subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');
    const organization = await this.db.organization.findUnique({ where: { id: payment.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const jobId = id('job');
    return this.db.$transaction(async tx => {
      const paidPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid' } });
      const approvedRequest = await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: 'approved', notes } });
      const activeSubscription = await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'active' } });
      const provisioningOrganization = await tx.organization.update({ where: { id: organization.id }, data: { status: 'provisioning' } });
      const provisioningJob = await tx.provisioningJob.create({
        data: {
          id: jobId,
          organizationId: organization.id,
          type: 'create_dify_workspace',
          status: 'queued',
          attempts: 0,
          payload: { organizationName: organization.name, ownerUserId: organization.ownerUserId, subscriptionId: subscription.id }
        }
      });
      return { payment: paidPayment, approval: approvedRequest, subscription: activeSubscription, organization: provisioningOrganization, provisioningJob };
    });
  }

  listProvisioningJobs() {
    return this.db.provisioningJob.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getOrganizationDashboard(organizationId: string) {
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const subscription = await this.db.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const payment = await this.db.payment.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const approval = await this.db.approvalRequest.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const provisioningJob = await this.db.provisioningJob.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });

    const currentStep = organization.status === 'pending_payment'
      ? 'submit_payment'
      : organization.status === 'pending_approval'
        ? 'wait_for_admin_review'
        : organization.status === 'provisioning'
          ? 'wait_for_ai_studio'
          : organization.status === 'active'
            ? 'open_ai_studio'
            : 'contact_support';

    const aiStudioUrl = organization.status === 'active' && organization.difyTenantId
      ? `https://studio.local/tenants/${organization.difyTenantId}`
      : null;

    return {
      organization,
      subscription: subscription ? { id: subscription.id, status: subscription.status, planId: subscription.planId } : null,
      plan: subscription?.plan ?? null,
      payment,
      approval,
      provisioningJob,
      currentStep,
      aiStudioUrl
    };
  }
}
