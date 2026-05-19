import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InMemoryStore } from './in-memory.store';

@Injectable()
export class SaasService {
  constructor(private readonly store: InMemoryStore) {}

  listPlans() { return this.store.plans; }

  signup(input: { name: string; email: string; phone?: string; companyName: string; industry?: string; preferredLanguage?: 'ar' | 'en'; planId: string }) {
    const plan = this.store.plans.find(p => p.id === input.planId);
    if (!plan) throw new BadRequestException('Unknown plan');
    if (this.store.users.some(u => u.email.toLowerCase() === input.email.toLowerCase())) throw new BadRequestException('Email already registered');

    const userId = this.store.nextId('usr');
    const organizationId = this.store.nextId('org');
    const user = { id: userId, name: input.name, email: input.email, phone: input.phone, role: 'customer' as const, preferredLanguage: input.preferredLanguage ?? 'ar' as const, organizationId };
    const organization = { id: organizationId, name: input.companyName, ownerUserId: user.id, status: 'pending_payment' as const, industry: input.industry };
    const subscription = { id: this.store.nextId('sub'), organizationId: organization.id, planId: plan.id, status: 'pending_payment' as const };

    this.store.users.push(user); this.store.organizations.push(organization); this.store.subscriptions.push(subscription);
    return { user, organization, subscription, nextStep: 'submit_manual_payment_or_card_payment' };
  }

  submitManualPayment(input: { organizationId: string; method: 'instapay' | 'vodafone_cash' | 'bank_transfer'; amountEgp: number; reference?: string; proofUrl?: string }) {
    const organization = this.store.organizations.find(o => o.id === input.organizationId);
    if (!organization) throw new NotFoundException('Organization not found');
    const subscription = this.store.subscriptions.find(s => s.organizationId === organization.id);
    if (!subscription) throw new NotFoundException('Subscription not found');

    organization.status = 'pending_approval';
    subscription.status = 'needs_review';
    const payment = { id: this.store.nextId('pay'), organizationId: organization.id, subscriptionId: subscription.id, method: input.method, amountEgp: input.amountEgp, status: 'needs_review' as const, reference: input.reference, proofUrl: input.proofUrl };
    const approval = { id: this.store.nextId('apr'), organizationId: organization.id, paymentId: payment.id, status: 'open' as const };
    this.store.payments.push(payment); this.store.approvals.push(approval);
    return { payment, approval, organization, nextStep: 'admin_review' };
  }

  listApprovals() {
    return this.store.approvals.map(approval => ({ approval, payment: this.store.payments.find(p => p.id === approval.paymentId), organization: this.store.organizations.find(o => o.id === approval.organizationId) }));
  }

  approvePayment(paymentId: string, notes?: string) {
    const payment = this.store.payments.find(p => p.id === paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    const approval = this.store.approvals.find(a => a.paymentId === payment.id && a.status === 'open');
    if (!approval) throw new BadRequestException('No open approval request for this payment');
    const organization = this.store.organizations.find(o => o.id === payment.organizationId)!;
    const subscription = this.store.subscriptions.find(s => s.id === payment.subscriptionId)!;

    payment.status = 'paid'; approval.status = 'approved'; approval.notes = notes; subscription.status = 'active'; organization.status = 'provisioning';
    const job = { id: this.store.nextId('job'), organizationId: organization.id, type: 'create_dify_workspace' as const, status: 'queued' as const, attempts: 0, payload: { organizationName: organization.name, ownerUserId: organization.ownerUserId, subscriptionId: subscription.id } };
    this.store.provisioningJobs.push(job);
    return { payment, approval, subscription, organization, provisioningJob: job };
  }

  listProvisioningJobs() { return this.store.provisioningJobs; }
}
