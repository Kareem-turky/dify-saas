import { Injectable } from '@nestjs/common';
import { ApprovalRequest, Organization, Payment, Plan, ProvisioningJob, Subscription, User } from './domain';

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

@Injectable()
export class InMemoryStore {
  users: User[] = [];
  organizations: Organization[] = [];
  plans: Plan[] = [
    { id: 'starter', name: 'Starter', monthlyPriceEgp: 1500, messageLimit: 3000, channelLimit: 1, seatLimit: 2, requiresManualApproval: false },
    { id: 'growth', name: 'Growth', monthlyPriceEgp: 3500, messageLimit: 12000, channelLimit: 3, seatLimit: 5, requiresManualApproval: false },
    { id: 'business', name: 'Business', monthlyPriceEgp: 7500, messageLimit: 40000, channelLimit: 8, seatLimit: 15, requiresManualApproval: true }
  ];
  subscriptions: Subscription[] = [];
  payments: Payment[] = [];
  approvals: ApprovalRequest[] = [];
  provisioningJobs: ProvisioningJob[] = [];

  nextId(prefix: string) { return id(prefix); }
  reset() { this.users = []; this.organizations = []; this.subscriptions = []; this.payments = []; this.approvals = []; this.provisioningJobs = []; }
}
