export type UserRole = 'customer' | 'admin';
export type OrganizationStatus = 'pending_payment' | 'pending_approval' | 'provisioning' | 'active' | 'suspended';
export type SubscriptionStatus = 'pending_payment' | 'needs_review' | 'active' | 'cancelled';
export type PaymentStatus = 'pending' | 'needs_review' | 'paid' | 'failed' | 'refunded';
export type ProvisioningJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface User { id: string; name: string; email: string; phone?: string; role: UserRole; preferredLanguage: 'ar' | 'en'; organizationId?: string; }
export interface Organization { id: string; name: string; ownerUserId: string; status: OrganizationStatus; industry?: string; }
export interface Plan { id: string; name: string; monthlyPriceEgp: number; messageLimit: number; channelLimit: number; seatLimit: number; requiresManualApproval: boolean; }
export interface Subscription { id: string; organizationId: string; planId: string; status: SubscriptionStatus; }
export interface Payment { id: string; organizationId: string; subscriptionId: string; method: 'instapay' | 'vodafone_cash' | 'bank_transfer' | 'card'; amountEgp: number; status: PaymentStatus; reference?: string; proofUrl?: string; }
export interface ApprovalRequest { id: string; organizationId: string; paymentId: string; status: 'open' | 'approved' | 'rejected'; notes?: string; }
export interface ProvisioningJob { id: string; organizationId: string; type: 'create_dify_workspace'; status: ProvisioningJobStatus; attempts: number; payload: Record<string, unknown>; lastError?: string; }
