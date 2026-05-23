import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { getRateLimitStore } from './rate-limit.store';

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PAYMENT_PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);


function envPositiveInt(name: string, fallback: number) {
  const configured = Number(process.env[name] || fallback);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

async function checkFixedWindowRateLimit(input: { namespace: string; key: string; max: number; windowMs: number; message: string }) {
  const result = await getRateLimitStore().hit({ namespace: input.namespace, key: input.key, max: input.max, windowMs: input.windowMs });
  if (!result.allowed) {
    throw new HttpException(input.message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function safeRateLimitKey(value?: string) {
  return (value || 'unknown').toLowerCase().replace(/[^a-z0-9@._:-]/g, '_').slice(0, 160);
}

async function checkLoginRateLimit(email?: string) {
  await checkFixedWindowRateLimit({
    namespace: 'login',
    key: safeRateLimitKey(email),
    max: envPositiveInt('LOGIN_RATE_LIMIT_MAX', 20),
    windowMs: envPositiveInt('LOGIN_RATE_LIMIT_WINDOW_MS', 60_000),
    message: 'Too many login attempts. Please wait and try again.'
  });
}

async function checkMetaWebhookRateLimit(source?: string) {
  await checkFixedWindowRateLimit({
    namespace: 'meta-webhook',
    key: safeRateLimitKey(source?.split(',')[0]?.trim()),
    max: envPositiveInt('META_WEBHOOK_RATE_LIMIT_MAX', 200),
    windowMs: envPositiveInt('META_WEBHOOK_RATE_LIMIT_WINDOW_MS', 60_000),
    message: 'Too many Meta webhook requests. Please retry later.'
  });
}

function messageEventMaxRetries() {
  const configured = Number(process.env.MESSAGE_EVENT_MAX_RETRIES || 3);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'payment-proof';
}

function getPaymentProofUploadRoot() {
  return process.env.PAYMENT_PROOF_UPLOAD_DIR || './uploads/payment-proofs';
}

function hashPassword(password?: string) {
  if (!password) return null;
  return `sha256:${createHash('sha256').update(password).digest('hex')}`;
}

function hashSecret(secret?: string) {
  if (!secret) return null;
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

function channelSecretKey() {
  return createHash('sha256').update(process.env.CHANNEL_SECRET_KEY || authSecret()).digest();
}

function encryptSecret(secret?: string) {
  if (!secret) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', channelSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(ciphertext?: string | null) {
  if (!ciphertext) return null;
  const [prefix, version, iv, tag, encrypted] = ciphertext.split(':');
  if (prefix !== 'enc' || version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted secret format');
  const decipher = createDecipheriv('aes-256-gcm', channelSecretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

function difyAppApiBaseUrl() {
  return trimTrailingSlash(process.env.DIFY_APP_API_BASE_URL || 'http://localhost:5001/v1');
}

function metaGraphApiBaseUrl() {
  return trimTrailingSlash(process.env.META_GRAPH_API_BASE_URL || 'https://graph.facebook.com/v19.0');
}

function metaWebhookSignatureRequired() {
  return process.env.META_WEBHOOK_SIGNATURE_REQUIRED === 'true';
}

function metaWebhookAppSecret() {
  return process.env.META_WEBHOOK_APP_SECRET || '';
}

function publicWebBaseUrl() {
  return trimTrailingSlash(process.env.PUBLIC_WEB_URL || 'http://localhost:3001');
}

function verifyMetaSignedRequest(signedRequest?: string) {
  const appSecret = metaWebhookAppSecret();
  if (!appSecret || !signedRequest) {
    throw new UnauthorizedException('Invalid Meta signed request');
  }

  const [encodedSignature, encodedPayload] = signedRequest.split('.');
  if (!encodedSignature || !encodedPayload) {
    throw new UnauthorizedException('Invalid Meta signed request');
  }

  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  const received = Buffer.from(encodedSignature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new UnauthorizedException('Invalid Meta signed request');
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { user_id?: string };
  } catch {
    throw new UnauthorizedException('Invalid Meta signed request');
  }
}

function verifyMetaWebhookSignature(payload: unknown, signature?: string, rawBody?: Buffer) {
  if (!metaWebhookSignatureRequired()) return;
  const appSecret = metaWebhookAppSecret();
  if (!appSecret || !signature?.startsWith('sha256=')) {
    throw new UnauthorizedException('Invalid Meta webhook signature');
  }

  const signedBody = rawBody ?? Buffer.from(JSON.stringify(payload));
  const expectedHex = createHmac('sha256', appSecret).update(signedBody).digest('hex');
  const receivedHex = signature.slice('sha256='.length);
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new UnauthorizedException('Invalid Meta webhook signature');
  }
}

function sanitizeIntegrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[^\s,}]+/gi, 'Bearer [REDACTED]');
}

function publicApiBaseUrl() {
  return trimTrailingSlash(process.env.PUBLIC_API_URL || 'http://localhost:4000');
}

function verifyPassword(password: string, storedHash?: string | null) {
  const incoming = hashPassword(password);
  if (!incoming || !storedHash) return false;
  const a = Buffer.from(incoming);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authSecret() {
  return process.env.AUTH_TOKEN_SECRET || process.env.ADMIN_PASSWORD || 'local-dev-auth-secret';
}

function encodeTokenPayload(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signTokenPayload(payload: string) {
  return createHmac('sha256', authSecret()).update(payload).digest('base64url');
}

function createToken(userId: string) {
  const payload = encodeTokenPayload({ sub: userId, iat: Date.now() });
  return `hst_${payload}.${signTokenPayload(payload)}`;
}

function parseBearerToken(authorization?: string) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function todayInvoiceStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function invoiceReceiptUrl(invoiceId: string) {
  return `/billing/invoices/${invoiceId}/receipt`;
}

function printableInvoiceReceiptUrl(invoiceId: string) {
  return `/billing/invoices/${invoiceId}/receipt.html`;
}

function dataDeletionConfirmationCode(metaUserId?: string) {
  const source = `${metaUserId || 'unknown'}:${authSecret()}:${Date.now()}:${randomBytes(8).toString('hex')}`;
  return `del_${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReceiptDate(value?: Date | string | null) {
  if (!value) return '—';
  return new Date(value).toISOString().slice(0, 10);
}

function formatEgp(amount: number) {
  return `${amount.toLocaleString('en-US')} EGP`;
}

function publicUser<T extends { passwordHash?: string | null }>(user: T) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function buildAiStudioUrl(organization: { id: string; status: string; difyTenantId?: string | null; difyAccountId?: string | null }) {
  if (organization.status !== 'active' || !organization.difyTenantId) return null;

  const replacements: Record<string, string> = {
    tenantId: encodeURIComponent(organization.difyTenantId),
    organizationId: encodeURIComponent(organization.id),
    accountId: encodeURIComponent(organization.difyAccountId || '')
  };

  const template = process.env.DIFY_WORKSPACE_URL_TEMPLATE;
  if (template) {
    return template.replace(/\{(tenantId|organizationId|accountId)\}/g, (_, key: string) => replacements[key] ?? '');
  }

  const baseUrl = trimTrailingSlash(process.env.DIFY_CONSOLE_BASE_URL || 'https://studio.local');
  return `${baseUrl}/tenants/${replacements.tenantId}`;
}

@Injectable()
export class SaasService {
  constructor(private readonly db: PrismaService) {}

  listPlans() {
    return this.db.plan.findMany({ orderBy: { monthlyPriceEgp: 'asc' } });
  }

  async signup(input: { name: string; email: string; password?: string; phone?: string; companyName: string; industry?: string; preferredLanguage?: 'ar' | 'en'; planId: string }) {
    const plan = await this.db.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new BadRequestException('Unknown plan');
    const existingUser = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existingUser) throw new BadRequestException('Email already registered');

    const userId = id('usr');
    const organizationId = id('org');
    const subscriptionId = id('sub');
    const passwordHash = hashPassword(input.password);

    const { user, organization, subscription } = await this.db.$transaction(async tx => {
      const organization = await tx.organization.create({
        data: { id: organizationId, name: input.companyName, ownerUserId: userId, status: 'pending_payment', industry: input.industry }
      });
      const user = await tx.user.create({
        data: { id: userId, name: input.name, email: input.email.toLowerCase(), phone: input.phone, role: 'customer', passwordHash, preferredLanguage: input.preferredLanguage ?? 'ar', organizationId }
      });
      const subscription = await tx.subscription.create({
        data: { id: subscriptionId, organizationId, planId: plan.id, status: 'pending_payment' }
      });
      return { user, organization, subscription };
    });

    return { token: createToken(user.id), user: publicUser(user), organization, subscription, nextStep: 'submit_manual_payment_or_card_payment' };
  }

  async login(input: { email: string; password: string }) {
    await checkLoginRateLimit(input.email);
    const user = await this.db.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new UnauthorizedException('Invalid email or password');
    if (user.role === 'admin') {
      await this.recordAuditLog({ actorUserId: user.id, action: 'admin_login', targetType: 'user', targetId: user.id, metadata: { email: user.email } });
    }
    return { token: createToken(user.id), user: publicUser(user) };
  }

  async currentUser(authorization?: string) {
    return publicUser(await this.requireUser(authorization));
  }

  async requireUser(authorization?: string) {
    const token = parseBearerToken(authorization);
    if (!token?.startsWith('hst_')) throw new UnauthorizedException('Bearer token is required');
    const [payload, signature] = token.slice(4).split('.');
    if (!payload || !signature || signTokenPayload(payload) !== signature) throw new UnauthorizedException('Invalid bearer token');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string };
    if (!decoded.sub) throw new UnauthorizedException('Invalid bearer token');
    const user = await this.db.user.findUnique({ where: { id: decoded.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  async requireAdmin(authorization?: string) {
    const user = await this.requireUser(authorization);
    if (user.role !== 'admin') throw new ForbiddenException('Admin role is required');
    return user;
  }


  private async getActivePlanForOrganization(organizationId: string) {
    const subscription = await this.db.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    if (!subscription) throw new BadRequestException('Active subscription is required before managing team members');
    return subscription.plan;
  }

  async listTeamMembers(authorization?: string) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const plan = await this.getActivePlanForOrganization(user.organizationId);
    const members = await this.db.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ createdAt: 'asc' }, { email: 'asc' }]
    });
    return { seatLimit: plan.seatLimit, seatsUsed: members.length, seatsRemaining: Math.max(plan.seatLimit - members.length, 0), members: members.map(publicUser) };
  }

  async addTeamMember(authorization: string | undefined, input: { name?: string; email?: string; role?: string; preferredLanguage?: 'ar' | 'en' }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const organization = await this.db.organization.findUnique({ where: { id: user.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');
    if (organization.ownerUserId !== user.id && user.role !== 'admin') throw new ForbiddenException('Only the organization owner can add team members');

    const email = input.email?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!name || !email) throw new BadRequestException('name and email are required');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('A valid email is required');

    const existingUser = await this.db.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('A user with this email already exists');

    const plan = await this.getActivePlanForOrganization(user.organizationId);
    const seatsUsed = await this.db.user.count({ where: { organizationId: user.organizationId } });
    if (seatsUsed >= plan.seatLimit) throw new ConflictException('Seat limit reached for the active plan');

    const role = ['member', 'manager'].includes(input.role || '') ? input.role! : 'member';
    const member = await this.db.user.create({
      data: { id: id('usr'), name, email, role, preferredLanguage: input.preferredLanguage || 'ar', organizationId: user.organizationId }
    });
    await this.recordAuditLog({
      actorUserId: user.id,
      organizationId: user.organizationId,
      action: 'team_member_added',
      targetType: 'user',
      targetId: member.id,
      metadata: { email: member.email, role: member.role }
    });

    const nextSeatsUsed = seatsUsed + 1;
    return { member: publicUser(member), seatLimit: plan.seatLimit, seatsUsed: nextSeatsUsed, seatsRemaining: Math.max(plan.seatLimit - nextSeatsUsed, 0) };
  }

  async submitManualPayment(input: { organizationId: string; method: 'instapay' | 'vodafone_cash' | 'bank_transfer'; amountEgp: number; reference?: string; proofUrl?: string; proofUploadId?: string }) {
    const organization = await this.db.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');
    const subscription = await this.db.subscription.findFirst({ where: { organizationId: organization.id } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const uploadedProof = input.proofUploadId
      ? await this.db.paymentProof.findUnique({ where: { id: input.proofUploadId } })
      : null;
    if (input.proofUploadId && !uploadedProof) throw new NotFoundException('Payment proof upload not found');
    if (uploadedProof && uploadedProof.organizationId !== organization.id) throw new BadRequestException('Payment proof upload does not belong to this organization');
    if (uploadedProof?.paymentId) throw new BadRequestException('Payment proof upload is already attached to a payment');

    const paymentId = id('pay');
    const approvalId = id('apr');
    const proofUrl = uploadedProof?.proofUrl || input.proofUrl;

    const result = await this.db.$transaction(async tx => {
      const updatedOrganization = await tx.organization.update({ where: { id: organization.id }, data: { status: 'pending_approval' } });
      await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'needs_review' } });
      const payment = await tx.payment.create({
        data: { id: paymentId, organizationId: organization.id, subscriptionId: subscription.id, method: input.method, amountEgp: input.amountEgp, status: 'needs_review', reference: input.reference, proofUrl }
      });
      if (uploadedProof) {
        await tx.paymentProof.update({ where: { id: uploadedProof.id }, data: { paymentId: payment.id, status: 'attached' } });
      }
      const approval = await tx.approvalRequest.create({ data: { id: approvalId, organizationId: organization.id, paymentId: payment.id, status: 'open' } });
      return { payment, approval, organization: updatedOrganization };
    });

    return { ...result, nextStep: 'admin_review' };
  }

  async requestPlanUpgrade(authorization: string | undefined, input: { planId?: string; method?: 'instapay' | 'vodafone_cash' | 'bank_transfer'; amountEgp?: number; reference?: string; proofUrl?: string; proofUploadId?: string }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const organization = await this.db.organization.findUnique({ where: { id: user.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');
    if (organization.status !== 'active') throw new BadRequestException('Organization must be active before requesting a plan upgrade');

    const currentSubscription = await this.db.subscription.findFirst({ where: { organizationId: organization.id, status: 'active' }, orderBy: { createdAt: 'desc' }, include: { plan: true } });
    if (!currentSubscription) throw new BadRequestException('Active subscription is required before requesting a plan upgrade');
    const targetPlan = input.planId ? await this.db.plan.findUnique({ where: { id: input.planId } }) : null;
    if (!targetPlan) throw new BadRequestException('Unknown target plan');
    if (targetPlan.monthlyPriceEgp <= currentSubscription.plan.monthlyPriceEgp) throw new BadRequestException('Upgrade plan must be higher than the current plan');

    const pendingUpgrade = await this.db.subscription.findFirst({
      where: { organizationId: organization.id, planId: targetPlan.id, status: 'needs_review' },
      include: { payments: { where: { status: 'needs_review' }, take: 1 } }
    });
    if (pendingUpgrade) throw new ConflictException('An upgrade request for this plan is already pending admin review');

    const uploadedProof = input.proofUploadId
      ? await this.db.paymentProof.findUnique({ where: { id: input.proofUploadId } })
      : null;
    if (input.proofUploadId && !uploadedProof) throw new NotFoundException('Payment proof upload not found');
    if (uploadedProof && uploadedProof.organizationId !== organization.id) throw new BadRequestException('Payment proof upload does not belong to this organization');
    if (uploadedProof?.paymentId) throw new BadRequestException('Payment proof upload is already attached to a payment');

    const subscriptionId = id('sub');
    const paymentId = id('pay');
    const approvalId = id('apr');
    const proofUrl = uploadedProof?.proofUrl || input.proofUrl;

    const result = await this.db.$transaction(async tx => {
      const upgradeSubscription = await tx.subscription.create({ data: { id: subscriptionId, organizationId: organization.id, planId: targetPlan.id, status: 'needs_review' } });
      const payment = await tx.payment.create({
        data: { id: paymentId, organizationId: organization.id, subscriptionId: upgradeSubscription.id, method: input.method || 'instapay', amountEgp: input.amountEgp || targetPlan.monthlyPriceEgp, status: 'needs_review', reference: input.reference, proofUrl }
      });
      if (uploadedProof) await tx.paymentProof.update({ where: { id: uploadedProof.id }, data: { paymentId: payment.id, status: 'attached' } });
      const approval = await tx.approvalRequest.create({ data: { id: approvalId, organizationId: organization.id, paymentId: payment.id, status: 'open' } });
      await tx.auditLog.create({
        data: {
          id: id('aud'),
          actorUserId: user.id,
          organizationId: organization.id,
          action: 'plan_upgrade_requested',
          targetType: 'subscription',
          targetId: upgradeSubscription.id,
          metadata: { fromPlanId: currentSubscription.planId, toPlanId: targetPlan.id, paymentId: payment.id }
        }
      });
      return { subscription: upgradeSubscription, payment, approval, organization };
    });

    return { ...result, nextStep: 'admin_review' };
  }

  async storePaymentProof(input: { organizationId: string; file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer } }) {
    const organization = await this.db.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');
    const file = input.file;
    if (!file?.buffer?.length) throw new BadRequestException('Payment proof file is required');
    if (!file.mimetype || !ALLOWED_PAYMENT_PROOF_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Unsupported payment proof file type');
    }
    if ((file.size || file.buffer.length) > MAX_PAYMENT_PROOF_BYTES) {
      throw new BadRequestException('Payment proof file is too large');
    }

    const proofId = id('prf');
    const originalName = safeFileName(file.originalname || 'payment-proof');
    const extension = path.extname(originalName);
    const storedFileName = `${proofId}${extension}`;
    const uploadRoot = getPaymentProofUploadRoot();
    const relativeStorageKey = path.posix.join(input.organizationId, storedFileName);
    const organizationDir = path.join(uploadRoot, input.organizationId);
    await mkdir(organizationDir, { recursive: true });
    await writeFile(path.join(organizationDir, storedFileName), file.buffer);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const proofUrl = `/payment-proofs/${relativeStorageKey}`;

    return this.db.paymentProof.create({
      data: {
        id: proofId,
        organizationId: input.organizationId,
        storageKey: relativeStorageKey,
        proofUrl,
        originalName,
        mimeType: file.mimetype,
        sizeBytes: file.size || file.buffer.length,
        sha256,
        status: 'uploaded'
      }
    });
  }

  async listApprovals() {
    const approvals = await this.db.approvalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { payment: true, organization: true }
    });
    return approvals.map(({ payment, organization, ...approval }) => ({ approval, payment, organization }));
  }

  async approvePayment(paymentId: string, notes?: string, actorUserId?: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const approval = await this.db.approvalRequest.findFirst({ where: { paymentId: payment.id, status: 'open' } });
    if (!approval) throw new BadRequestException('No open approval request for this payment');
    const subscription = await this.db.subscription.findUnique({ where: { id: payment.subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');
    const organization = await this.db.organization.findUnique({ where: { id: payment.organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const isUpgradeApproval = organization.status === 'active' && Boolean(organization.difyTenantId);
    const jobId = isUpgradeApproval ? null : id('job');
    const invoiceId = id('inv');
    return this.db.$transaction(async tx => {
      const paidPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid' } });
      const approvedRequest = await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: 'approved', notes } });
      const activeSubscription = await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'active' } });
      const invoice = await tx.invoice.create({
        data: {
          id: invoiceId,
          invoiceNumber: `INV-${todayInvoiceStamp()}-${payment.id.slice(-6).toUpperCase()}`,
          organizationId: organization.id,
          subscriptionId: subscription.id,
          paymentId: payment.id,
          amountEgp: payment.amountEgp,
          currency: 'EGP',
          status: 'paid',
          paidAt: new Date(),
          receiptUrl: invoiceReceiptUrl(invoiceId)
        }
      });
      const provisioningOrganization = isUpgradeApproval
        ? organization
        : await tx.organization.update({ where: { id: organization.id }, data: { status: 'provisioning' } });
      const provisioningJob = isUpgradeApproval ? null : await tx.provisioningJob.create({
        data: {
          id: jobId!,
          organizationId: organization.id,
          type: 'create_dify_workspace',
          status: 'queued',
          attempts: 0,
          payload: { organizationName: organization.name, ownerUserId: organization.ownerUserId, subscriptionId: subscription.id }
        }
      });
      await tx.auditLog.create({
        data: {
          id: id('aud'),
          actorUserId,
          organizationId: organization.id,
          action: isUpgradeApproval ? 'plan_upgrade_approved' : 'payment_approved',
          targetType: 'payment',
          targetId: payment.id,
          metadata: { approvalId: approval.id, provisioningJobId: jobId, notes: notes || null, subscriptionId: subscription.id, invoiceId: invoice.id }
        }
      });
      return { payment: paidPayment, approval: approvedRequest, subscription: activeSubscription, organization: provisioningOrganization, provisioningJob, invoice };
    });
  }

  listProvisioningJobs() {
    return this.db.provisioningJob.findMany({ orderBy: { createdAt: 'desc' }, include: { organization: true } });
  }

  async getReadiness(input: { difyGateway: { mode: string; ready: boolean; tokenConfigured: boolean; requiresExistingDifyOwnerAccount: boolean }; provisioningWorker: Record<string, unknown> }) {
    const started = Date.now();
    let database = { ok: false, latencyMs: 0 };
    try {
      await this.db.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - started };
    } catch {
      database = { ok: false, latencyMs: Date.now() - started };
    }

    const adminUserCount = await this.db.user.count({ where: { role: 'admin' } }).catch(() => 0);
    const paymentProofRoot = getPaymentProofUploadRoot();
    let paymentProofStorage = { ok: false, pathConfigured: Boolean(process.env.PAYMENT_PROOF_UPLOAD_DIR) };
    try {
      await mkdir(paymentProofRoot, { recursive: true });
      paymentProofStorage = { ok: true, pathConfigured: Boolean(process.env.PAYMENT_PROOF_UPLOAD_DIR) };
    } catch {
      paymentProofStorage = { ok: false, pathConfigured: Boolean(process.env.PAYMENT_PROOF_UPLOAD_DIR) };
    }

    const authTokenSecretConfigured = Boolean(process.env.AUTH_TOKEN_SECRET);
    const checks = {
      database,
      adminUser: { ok: adminUserCount > 0, configured: adminUserCount > 0 },
      authTokenSecret: { ok: authTokenSecretConfigured, configured: authTokenSecretConfigured },
      paymentProofStorage,
      difyGateway: {
        ok: input.difyGateway.ready,
        mode: input.difyGateway.mode,
        tokenConfigured: input.difyGateway.tokenConfigured,
        requiresExistingDifyOwnerAccount: input.difyGateway.requiresExistingDifyOwnerAccount
      },
      provisioningWorker: input.provisioningWorker
    };
    const ok = checks.database.ok && checks.adminUser.ok && checks.authTokenSecret.ok && checks.paymentProofStorage.ok && checks.difyGateway.ok;
    return { ok, service: 'dify-saas-api', checkedAt: new Date().toISOString(), checks };
  }

  async getInvoiceReceipt(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: { organization: true, payment: true, subscription: { include: { plan: true } } }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      organizationId: invoice.organizationId,
      organizationName: invoice.organization.name,
      subscriptionId: invoice.subscriptionId,
      planName: invoice.subscription.plan.name,
      paymentId: invoice.paymentId,
      paymentMethod: invoice.payment.method,
      paymentReference: invoice.payment.reference,
      amountEgp: invoice.amountEgp,
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
      receiptUrl: invoice.receiptUrl || invoiceReceiptUrl(invoice.id),
      printableReceiptUrl: printableInvoiceReceiptUrl(invoice.id)
    };
  }

  async renderInvoiceReceiptHtml(invoiceId: string) {
    const receipt = await this.getInvoiceReceipt(invoiceId);
    const rows = [
      ['Invoice number', receipt.invoiceNumber],
      ['Customer', receipt.organizationName],
      ['Plan', receipt.planName],
      ['Amount', formatEgp(receipt.amountEgp)],
      ['Status', receipt.status],
      ['Payment method', receipt.paymentMethod],
      ['Payment reference', receipt.paymentReference || '—'],
      ['Issued at', formatReceiptDate(receipt.issuedAt)],
      ['Paid at', formatReceiptDate(receipt.paidAt)]
    ];
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(receipt.invoiceNumber)} · Receipt</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #102033; background: #f5f7fb; }
    body { margin: 0; padding: 32px; }
    .receipt { max-width: 860px; margin: auto; background: white; border: 1px solid #e4e9f2; border-radius: 28px; box-shadow: 0 24px 80px rgba(16,32,51,.12); overflow: hidden; }
    .hero { padding: 34px; background: linear-gradient(135deg, #101827, #2946d3); color: white; }
    .eyebrow { text-transform: uppercase; letter-spacing: .16em; opacity: .78; font-size: 12px; }
    h1 { margin: 8px 0 4px; font-size: 34px; }
    .subtitle { margin: 0; opacity: .86; }
    .content { padding: 32px; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 26px; }
    .metric { border: 1px solid #edf1f7; border-radius: 18px; padding: 16px; background: #fbfcff; }
    .metric span { display: block; color: #667085; font-size: 13px; margin-bottom: 6px; }
    .metric strong { font-size: 20px; color: #101827; }
    table { width: 100%; border-collapse: collapse; direction: ltr; text-align: left; }
    th, td { padding: 14px 12px; border-bottom: 1px solid #eef2f6; }
    th { width: 34%; color: #667085; font-weight: 600; }
    .actions { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
    .btn { border: 0; border-radius: 999px; padding: 12px 18px; color: white; background: #2946d3; font-weight: 700; cursor: pointer; text-decoration: none; }
    .btn.secondary { color: #2946d3; background: #eef2ff; }
    .note { margin-top: 24px; color: #667085; font-size: 13px; }
    @media print { body { padding: 0; background: white; } .receipt { box-shadow: none; border: 0; border-radius: 0; } .actions { display: none; } }
  </style>
</head>
<body>
  <article class="receipt">
    <section class="hero">
      <div class="eyebrow">Professional payment receipt</div>
      <h1>إيصال دفع رسمي</h1>
      <p class="subtitle">Dify SaaS Platform · ${escapeHtml(receipt.invoiceNumber)}</p>
    </section>
    <section class="content">
      <div class="summary">
        <div class="metric"><span>Customer</span><strong>${escapeHtml(receipt.organizationName)}</strong></div>
        <div class="metric"><span>Amount</span><strong>${escapeHtml(formatEgp(receipt.amountEgp))}</strong></div>
        <div class="metric"><span>Status</span><strong>${escapeHtml(receipt.status)}</strong></div>
      </div>
      <table aria-label="Receipt details"><tbody>
        ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
      </tbody></table>
      <div class="actions">
        <button class="btn" onclick="window.print()">Print / Save as PDF</button>
        <a class="btn secondary" href="${escapeHtml(receipt.receiptUrl)}">JSON receipt</a>
      </div>
      <p class="note">This receipt is generated from approved manual payment records. It intentionally excludes secrets, API keys, and internal admin credentials.</p>
    </section>
  </article>
</body>
</html>`;
  }

  listAuditLogs() {
    return this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { actorUser: true, organization: true } });
  }

  recordAuditLog(input: { actorUserId?: string; organizationId?: string; action: string; targetType?: string; targetId?: string; metadata?: Prisma.InputJsonObject }) {
    return this.db.auditLog.create({
      data: {
        id: id('aud'),
        actorUserId: input.actorUserId,
        organizationId: input.organizationId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata
      }
    });
  }

  private publicChannel(channel: { id: string; organizationId: string; channelType: string; phoneNumberId?: string | null; wabaId?: string | null; accessTokenHash?: string | null; verifyToken?: string | null; appSecretHash?: string | null; difyAppId?: string | null; difyAppApiKeyHash?: string | null; status: string; lastError?: string | null; updatedByUserId?: string | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: channel.id,
      organizationId: channel.organizationId,
      channelType: channel.channelType,
      phoneNumberId: channel.phoneNumberId,
      wabaId: channel.wabaId,
      status: channel.status,
      lastError: channel.lastError,
      updatedByUserId: channel.updatedByUserId,
      hasAccessToken: Boolean(channel.accessTokenHash),
      hasVerifyToken: Boolean(channel.verifyToken),
      hasAppSecret: Boolean(channel.appSecretHash),
      difyAppId: channel.difyAppId,
      hasDifyAppApiKey: Boolean(channel.difyAppApiKeyHash),
      webhookUrl: `${publicApiBaseUrl()}/webhooks/meta`,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt
    };
  }

  private publicMessengerChannel(channel: { id: string; organizationId: string; channelType: string; phoneNumberId?: string | null; wabaId?: string | null; accessTokenHash?: string | null; verifyToken?: string | null; appSecretHash?: string | null; difyAppId?: string | null; difyAppApiKeyHash?: string | null; status: string; lastError?: string | null; updatedByUserId?: string | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: channel.id,
      organizationId: channel.organizationId,
      channelType: channel.channelType,
      pageId: channel.phoneNumberId,
      pageName: channel.wabaId,
      status: channel.status,
      lastError: channel.lastError,
      updatedByUserId: channel.updatedByUserId,
      hasPageAccessToken: Boolean(channel.accessTokenHash),
      hasVerifyToken: Boolean(channel.verifyToken),
      hasAppSecret: Boolean(channel.appSecretHash),
      difyAppId: channel.difyAppId,
      hasDifyAppApiKey: Boolean(channel.difyAppApiKeyHash),
      webhookUrl: `${publicApiBaseUrl()}/webhooks/meta`,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt
    };
  }

  async getWhatsappChannel(authorization?: string) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const channel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'whatsapp' } } });
    if (!channel) throw new NotFoundException('WhatsApp channel is not configured');
    return this.publicChannel(channel);
  }

  async getMessengerChannel(authorization?: string) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const channel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'messenger' } } });
    if (!channel) throw new NotFoundException('Messenger channel is not configured');
    return this.publicMessengerChannel(channel);
  }

  async saveMessengerChannel(authorization: string | undefined, input: { pageId?: string; pageName?: string; pageAccessToken?: string; verifyToken?: string; appSecret?: string; difyAppId?: string; difyAppApiKey?: string }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const existingChannel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'messenger' } } });
    if (!existingChannel) await this.assertChannelLimitAllowsCreate(user.organizationId, 'messenger');
    if (!input.pageId || !input.verifyToken || (!input.pageAccessToken && !existingChannel?.accessTokenHash)) {
      throw new BadRequestException('pageId, pageAccessToken and verifyToken are required');
    }

    const channel = await this.db.$transaction(async tx => {
      const savedChannel = await tx.channel.upsert({
        where: { organizationId_channelType: { organizationId: user.organizationId!, channelType: 'messenger' } },
        update: {
          phoneNumberId: input.pageId,
          wabaId: input.pageName,
          accessTokenHash: input.pageAccessToken ? hashSecret(input.pageAccessToken) : existingChannel?.accessTokenHash,
          accessTokenCiphertext: input.pageAccessToken ? encryptSecret(input.pageAccessToken) : existingChannel?.accessTokenCiphertext,
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
          appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : existingChannel?.appSecretCiphertext,
          difyAppId: input.difyAppId ?? existingChannel?.difyAppId,
          difyAppApiKeyHash: input.difyAppApiKey ? hashSecret(input.difyAppApiKey) : existingChannel?.difyAppApiKeyHash,
          difyAppApiKeyCiphertext: input.difyAppApiKey ? encryptSecret(input.difyAppApiKey) : existingChannel?.difyAppApiKeyCiphertext,
          status: 'configured',
          lastError: null,
          updatedByUserId: user.id
        },
        create: {
          id: id('chn'),
          organizationId: user.organizationId!,
          channelType: 'messenger',
          phoneNumberId: input.pageId,
          wabaId: input.pageName,
          accessTokenHash: input.pageAccessToken ? hashSecret(input.pageAccessToken) : existingChannel?.accessTokenHash,
          accessTokenCiphertext: input.pageAccessToken ? encryptSecret(input.pageAccessToken) : existingChannel?.accessTokenCiphertext,
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
          appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : existingChannel?.appSecretCiphertext,
          difyAppId: input.difyAppId,
          difyAppApiKeyHash: input.difyAppApiKey ? hashSecret(input.difyAppApiKey) : null,
          difyAppApiKeyCiphertext: input.difyAppApiKey ? encryptSecret(input.difyAppApiKey) : null,
          status: 'configured',
          updatedByUserId: user.id
        }
      });
      await tx.auditLog.create({
        data: {
          id: id('aud'),
          actorUserId: user.id,
          organizationId: user.organizationId,
          action: 'messenger_channel_saved',
          targetType: 'channel',
          targetId: savedChannel.id,
          metadata: { pageId: input.pageId, pageName: input.pageName, hasAppSecret: Boolean(input.appSecret), hasDifyApp: Boolean(input.difyAppId), hasDifyAppApiKey: Boolean(input.difyAppApiKey) }
        }
      });
      return savedChannel;
    });

    return this.publicMessengerChannel(channel);
  }

  async saveWhatsappChannel(authorization: string | undefined, input: { phoneNumberId?: string; wabaId?: string; accessToken?: string; verifyToken?: string; appSecret?: string; difyAppId?: string; difyAppApiKey?: string }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const existingChannel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'whatsapp' } } });
    if (!existingChannel) await this.assertChannelLimitAllowsCreate(user.organizationId, 'whatsapp');
    if (!input.phoneNumberId || !input.wabaId || !input.verifyToken || (!input.accessToken && !existingChannel?.accessTokenHash)) {
      throw new BadRequestException('phoneNumberId, wabaId, accessToken and verifyToken are required');
    }

    const channel = await this.db.$transaction(async tx => {
      const savedChannel = await tx.channel.upsert({
        where: { organizationId_channelType: { organizationId: user.organizationId!, channelType: 'whatsapp' } },
        update: {
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessTokenHash: input.accessToken ? hashSecret(input.accessToken) : existingChannel?.accessTokenHash,
          accessTokenCiphertext: input.accessToken ? encryptSecret(input.accessToken) : existingChannel?.accessTokenCiphertext,
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
          appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : existingChannel?.appSecretCiphertext,
          difyAppId: input.difyAppId ?? existingChannel?.difyAppId,
          difyAppApiKeyHash: input.difyAppApiKey ? hashSecret(input.difyAppApiKey) : existingChannel?.difyAppApiKeyHash,
          difyAppApiKeyCiphertext: input.difyAppApiKey ? encryptSecret(input.difyAppApiKey) : existingChannel?.difyAppApiKeyCiphertext,
          status: 'configured',
          lastError: null,
          updatedByUserId: user.id
        },
        create: {
          id: id('chn'),
          organizationId: user.organizationId!,
          channelType: 'whatsapp',
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessTokenHash: input.accessToken ? hashSecret(input.accessToken) : existingChannel?.accessTokenHash,
          accessTokenCiphertext: input.accessToken ? encryptSecret(input.accessToken) : existingChannel?.accessTokenCiphertext,
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
          appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : existingChannel?.appSecretCiphertext,
          difyAppId: input.difyAppId,
          difyAppApiKeyHash: input.difyAppApiKey ? hashSecret(input.difyAppApiKey) : null,
          difyAppApiKeyCiphertext: input.difyAppApiKey ? encryptSecret(input.difyAppApiKey) : null,
          status: 'configured',
          updatedByUserId: user.id
        }
      });
      await tx.auditLog.create({
        data: {
          id: id('aud'),
          actorUserId: user.id,
          organizationId: user.organizationId,
          action: 'whatsapp_channel_saved',
          targetType: 'channel',
          targetId: savedChannel.id,
          metadata: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, hasAppSecret: Boolean(input.appSecret), hasDifyApp: Boolean(input.difyAppId), hasDifyAppApiKey: Boolean(input.difyAppApiKey) }
        }
      });
      return savedChannel;
    });

    return this.publicChannel(channel);
  }

  private async assertChannelLimitAllowsCreate(organizationId: string, channelType: 'whatsapp' | 'messenger') {
    const subscription = await this.db.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const channelLimit = subscription?.plan?.channelLimit ?? 0;
    if (channelLimit <= 0) return;

    const configuredChannels = await this.db.channel.count({ where: { organizationId, status: 'configured' } });
    if (configuredChannels >= channelLimit) {
      throw new ForbiddenException(`Channel limit reached for current plan (${channelLimit}). Upgrade your plan to add ${channelType}.`);
    }
  }

  async verifyMetaWebhook(query: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }) {
    if (query['hub.mode'] !== 'subscribe' || !query['hub.verify_token'] || !query['hub.challenge']) {
      throw new BadRequestException('Invalid Meta webhook verification request');
    }

    const channel = await this.db.channel.findFirst({ where: { channelType: { in: ['whatsapp', 'messenger'] }, verifyToken: query['hub.verify_token'], status: 'configured' } });
    if (!channel) throw new ForbiddenException('Invalid Meta webhook verify token');
    return query['hub.challenge'];
  }

  async handleMetaDataDeletion(input: { signed_request?: string }) {
    const payload = verifyMetaSignedRequest(input.signed_request);
    const confirmation_code = dataDeletionConfirmationCode(payload.user_id);
    return {
      url: `${publicWebBaseUrl()}/data-deletion?confirmation_code=${confirmation_code}`,
      confirmation_code
    };
  }

  async receiveMetaWebhook(payload: unknown, signature?: string, rawBody?: Buffer, source?: string) {
    await checkMetaWebhookRateLimit(source);
    verifyMetaWebhookSignature(payload, signature, rawBody);
    const statusCallbacks = this.extractWhatsappStatusCallbacks(payload);
    const statusesUpdated = await this.updateWhatsappStatusCallbacks(statusCallbacks);
    const messengerStatusCallbacks = this.extractMessengerStatusCallbacks(payload);
    const messengerStatusesUpdated = await this.updateMessengerStatusCallbacks(messengerStatusCallbacks);
    const messages = this.extractWhatsappMessages(payload);
    const messengerMessages = this.extractMessengerMessages(payload);
    let processed = 0;
    let duplicates = 0;
    let ignored = 0;
    let repliesSent = 0;
    let repliesFailed = 0;
    let messengerRepliesSent = 0;
    let messengerRepliesFailed = 0;
    let usageLimited = 0;

    for (const item of messages) {
      const channel = await this.db.channel.findFirst({ where: { channelType: 'whatsapp', phoneNumberId: item.phoneNumberId, status: 'configured' } });
      if (!channel) {
        ignored += 1;
        continue;
      }

      const existing = await this.db.messageEvent.findUnique({ where: { eventId: item.eventId } });
      if (existing) {
        duplicates += 1;
        continue;
      }

      const inboundEvent = await this.db.messageEvent.create({
        data: {
          id: id('evt'),
          organizationId: channel.organizationId,
          channelId: channel.id,
          channelType: 'whatsapp',
          direction: 'inbound',
          eventId: item.eventId,
          fromId: item.fromId,
          toId: item.phoneNumberId,
          messageType: item.messageType,
          textBody: item.textBody,
          rawPayload: item.rawPayload as Prisma.InputJsonObject,
          status: 'received'
        }
      });
      processed += 1;

      const usage = await this.getOrganizationUsage(channel.organizationId);
      if (usage.limitReached) {
        usageLimited += 1;
        await this.markUsageLimited(inboundEvent.id);
        continue;
      }

      try {
        const replyStatus = await this.processInboundWhatsappMessage(channel, inboundEvent, item);
        if (replyStatus === 'sent') repliesSent += 1;
      } catch (error) {
        repliesFailed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError, nextRetryAt: new Date() } });
        await this.db.channel.update({ where: { id: channel.id }, data: { lastError } });
      }
    }

    for (const item of messengerMessages) {
      const channel = await this.db.channel.findFirst({ where: { channelType: 'messenger', phoneNumberId: item.pageId, status: 'configured' } });
      if (!channel) {
        ignored += 1;
        continue;
      }

      const existing = await this.db.messageEvent.findUnique({ where: { eventId: item.eventId } });
      if (existing) {
        duplicates += 1;
        continue;
      }

      const inboundEvent = await this.db.messageEvent.create({
        data: {
          id: id('evt'),
          organizationId: channel.organizationId,
          channelId: channel.id,
          channelType: 'messenger',
          direction: 'inbound',
          eventId: item.eventId,
          fromId: item.fromId,
          toId: item.pageId,
          messageType: item.messageType,
          textBody: item.textBody,
          rawPayload: item.rawPayload as Prisma.InputJsonObject,
          status: 'received'
        }
      });
      processed += 1;

      const usage = await this.getOrganizationUsage(channel.organizationId);
      if (usage.limitReached) {
        usageLimited += 1;
        await this.markUsageLimited(inboundEvent.id);
        continue;
      }

      try {
        const replyStatus = await this.processInboundMessengerMessage(channel, inboundEvent, item);
        if (replyStatus === 'sent') messengerRepliesSent += 1;
      } catch (error) {
        messengerRepliesFailed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError, nextRetryAt: new Date() } });
        await this.db.channel.update({ where: { id: channel.id }, data: { lastError } });
      }
    }

    return { received: true, processed, duplicates, ...(ignored ? { ignored } : {}), ...(statusesUpdated ? { statusesUpdated } : {}), ...(messengerStatusesUpdated ? { messengerStatusesUpdated } : {}), ...(repliesSent ? { repliesSent } : {}), ...(repliesFailed ? { repliesFailed } : {}), ...(messengerRepliesSent ? { messengerRepliesSent } : {}), ...(messengerRepliesFailed ? { messengerRepliesFailed } : {}), ...(usageLimited ? { usageLimited } : {}) };
  }

  async sendWhatsappTestMessage(authorization: string | undefined, input: { to?: string; text?: string }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const to = input.to?.trim();
    const text = input.text?.trim();
    if (!to || !text) throw new BadRequestException('to and text are required');

    const channel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'whatsapp' } } });
    if (!channel) throw new NotFoundException('WhatsApp channel is not configured');

    const inboundEvent = await this.db.messageEvent.create({
      data: {
        id: id('evt'),
        organizationId: channel.organizationId,
        channelId: channel.id,
        channelType: 'whatsapp',
        direction: 'inbound',
        eventId: `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromId: to,
        toId: channel.phoneNumberId,
        messageType: 'text',
        textBody: text,
        rawPayload: { source: 'integrations_test_message', actorUserId: user.id } as Prisma.InputJsonObject,
        status: 'received'
      }
    });

    try {
      const replyStatus = await this.processInboundWhatsappMessage(channel, inboundEvent, {
        fromId: to,
        messageType: 'text',
        textBody: text,
        rawPayload: { source: 'integrations_test_message' }
      });
      if (replyStatus !== 'sent') {
        await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError: 'Test message skipped because WhatsApp/Dify channel is incomplete' } });
        throw new BadRequestException('WhatsApp and Dify App credentials are required before sending a test message');
      }
      const processedInbound = await this.db.messageEvent.findUniqueOrThrow({ where: { id: inboundEvent.id } });
      const outboundEvent = await this.db.messageEvent.findFirstOrThrow({ where: { channelId: channel.id, direction: 'outbound', toId: to }, orderBy: { createdAt: 'desc' } });
      return {
        sent: true,
        inboundEvent: this.publicMessageEvent(processedInbound),
        outboundEvent: this.publicMessageEvent(outboundEvent)
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const lastError = sanitizeIntegrationError(error);
      await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError, nextRetryAt: new Date(Date.now() + 60_000) } });
      await this.db.channel.update({ where: { id: channel.id }, data: { lastError } });
      throw new InternalServerErrorException(lastError);
    }
  }

  private currentUsageWindow() {
    const now = new Date();
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
  }

  private async getOrganizationUsage(organizationId: string) {
    const activeSubscription = await this.db.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const subscription = activeSubscription || await this.db.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const window = this.currentUsageWindow();
    const messagesUsed = await this.db.messageEvent.count({
      where: {
        organizationId,
        direction: 'outbound',
        status: { in: ['sent', 'delivered', 'read'] },
        createdAt: { gte: window.start, lt: window.end }
      }
    });
    const messageLimit = subscription?.plan?.messageLimit ?? 0;
    const channelsUsed = await this.db.channel.count({ where: { organizationId, status: 'configured' } });
    const channelLimit = subscription?.plan?.channelLimit ?? 0;
    const limitReached = messageLimit > 0 && messagesUsed >= messageLimit;
    const channelLimitReached = channelLimit > 0 && channelsUsed >= channelLimit;
    const upgradeReason = limitReached ? 'message_limit' : channelLimitReached ? 'channel_limit' : null;
    const recommendedPlan = subscription?.plan && upgradeReason
      ? await this.findUpgradePlan(subscription.plan, upgradeReason)
      : null;
    return {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      messagesUsed,
      messageLimit,
      messagesRemaining: Math.max(messageLimit - messagesUsed, 0),
      limitReached,
      channelsUsed,
      channelLimit,
      channelsRemaining: Math.max(channelLimit - channelsUsed, 0),
      channelLimitReached,
      ...(upgradeReason && recommendedPlan ? { upgradeRecommendation: { reason: upgradeReason, currentPlanId: subscription!.plan.id, recommendedPlanId: recommendedPlan.id, recommendedPlanName: recommendedPlan.name, monthlyPriceEgp: recommendedPlan.monthlyPriceEgp } } : {})
    };
  }

  private async findUpgradePlan(currentPlan: { id: string; monthlyPriceEgp: number; messageLimit: number; channelLimit: number }, reason: 'message_limit' | 'channel_limit') {
    const plans = await this.db.plan.findMany({ orderBy: { monthlyPriceEgp: 'asc' } });
    return plans.find(plan =>
      plan.monthlyPriceEgp > currentPlan.monthlyPriceEgp &&
      (reason === 'message_limit' ? plan.messageLimit > currentPlan.messageLimit : plan.channelLimit > currentPlan.channelLimit)
    ) || null;
  }

  private async markUsageLimited(eventId: string) {
    await this.db.messageEvent.update({
      where: { id: eventId },
      data: { status: 'usage_limited', lastError: 'Monthly message limit reached', nextRetryAt: null }
    });
  }

  async retryFailedMessageEvents(input: { limit?: number; actorUserId?: string }) {
    const limit = Math.min(Math.max(input.limit || 10, 1), 50);
    const now = new Date();
    const maxRetries = messageEventMaxRetries();
    const failedEvents = await this.db.messageEvent.findMany({
      where: {
        direction: 'inbound',
        channelType: { in: ['whatsapp', 'messenger'] },
        status: 'failed',
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      include: { channel: true }
    });

    let attempted = 0;
    let retried = 0;
    let failed = 0;
    let skippedNotDue = 0;
    let deadLettered = 0;

    for (const event of failedEvents) {
      if (event.retryCount >= maxRetries) {
        deadLettered += 1;
        await this.db.messageEvent.update({ where: { id: event.id }, data: { status: 'dead' } });
        continue;
      }
      if (event.nextRetryAt && event.nextRetryAt > now) {
        skippedNotDue += 1;
        continue;
      }

      attempted += 1;
      const nextRetryCount = event.retryCount + 1;
      await this.db.messageEvent.update({ where: { id: event.id }, data: { retryCount: nextRetryCount, status: 'retrying' } });
      try {
        const messageInput = {
          fromId: event.fromId || undefined,
          messageType: event.messageType || undefined,
          textBody: event.textBody || undefined,
          rawPayload: event.rawPayload as Record<string, unknown>
        };
        const replyStatus = event.channelType === 'messenger'
          ? await this.processInboundMessengerMessage(event.channel, event, messageInput)
          : await this.processInboundWhatsappMessage(event.channel, event, messageInput);
        if (replyStatus === 'sent') {
          retried += 1;
        } else {
          failed += 1;
          await this.db.messageEvent.update({
            where: { id: event.id },
            data: { status: nextRetryCount >= maxRetries ? 'dead' : 'failed', lastError: 'Retry skipped because the message is not dispatchable', retryCount: nextRetryCount, nextRetryAt: nextRetryCount >= maxRetries ? null : new Date(Date.now() + 5 * 60_000) }
          });
          if (nextRetryCount >= maxRetries) deadLettered += 1;
        }
      } catch (error) {
        failed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({
          where: { id: event.id },
          data: { status: nextRetryCount >= maxRetries ? 'dead' : 'failed', lastError, retryCount: nextRetryCount, nextRetryAt: nextRetryCount >= maxRetries ? null : new Date(Date.now() + 5 * 60_000) }
        });
        if (nextRetryCount >= maxRetries) deadLettered += 1;
        await this.db.channel.update({ where: { id: event.channelId }, data: { lastError } });
      }
    }

    if (failedEvents.length) {
      await this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'message_retry_run',
        targetType: 'message_event',
        metadata: { attempted, retried, failed, skippedNotDue, deadLettered, maxRetries }
      });
    }

    return { attempted, retried, failed, ...(skippedNotDue ? { skippedNotDue } : {}), ...(deadLettered ? { deadLettered } : {}) };
  }

  async getMessageEventSummary() {
    const events = await this.db.messageEvent.findMany({
      select: { channelType: true, status: true, direction: true, nextRetryAt: true, createdAt: true }
    });
    const totals: Record<string, number> = {};
    const byChannel: Record<string, Record<string, number>> = {};
    let retryableFailed = 0;
    let deadLettered = 0;
    let oldestFailedAt: Date | null = null;
    const now = new Date();

    for (const event of events) {
      totals[event.status] = (totals[event.status] || 0) + 1;
      byChannel[event.channelType] = byChannel[event.channelType] || {};
      byChannel[event.channelType][event.status] = (byChannel[event.channelType][event.status] || 0) + 1;
      if (event.status === 'failed' && event.direction === 'inbound') {
        if (!event.nextRetryAt || event.nextRetryAt <= now) retryableFailed += 1;
        if (!oldestFailedAt || event.createdAt < oldestFailedAt) oldestFailedAt = event.createdAt;
      }
      if (event.status === 'dead') deadLettered += 1;
    }

    return { totals, byChannel, retryableFailed, deadLettered, oldestFailedAt: oldestFailedAt?.toISOString() ?? null };
  }

  private publicMessageEvent(event: { id: string; organizationId: string; channelId: string; channelType: string; direction: string; eventId: string; fromId?: string | null; toId?: string | null; messageType?: string | null; textBody?: string | null; status: string; lastError?: string | null; retryCount: number; nextRetryAt?: Date | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: event.id,
      organizationId: event.organizationId,
      channelId: event.channelId,
      channelType: event.channelType,
      direction: event.direction,
      eventId: event.eventId,
      fromId: event.fromId,
      toId: event.toId,
      messageType: event.messageType,
      textBody: event.textBody,
      status: event.status,
      lastError: event.lastError,
      retryCount: event.retryCount,
      nextRetryAt: event.nextRetryAt,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt
    };
  }

  private async updateWhatsappStatusCallbacks(statusCallbacks: Array<{ phoneNumberId: string; eventId: string; status: string; recipientId?: string; rawPayload: Record<string, unknown> }>) {
    let updated = 0;
    for (const callback of statusCallbacks) {
      const event = await this.db.messageEvent.findUnique({ where: { eventId: callback.eventId } });
      if (!event || event.direction !== 'outbound' || event.channelType !== 'whatsapp') continue;
      await this.db.messageEvent.update({
        where: { id: event.id },
        data: {
          status: callback.status,
          rawPayload: { ...(event.rawPayload as Record<string, unknown>), statusCallback: { status: callback.status, recipientId: callback.recipientId, phoneNumberId: callback.phoneNumberId, rawPayload: callback.rawPayload } } as Prisma.InputJsonObject
        }
      });
      updated += 1;
    }
    return updated;
  }

  private async updateMessengerStatusCallbacks(statusCallbacks: Array<{ pageId: string; eventIds?: string[]; status: string; psid?: string; rawPayload: Record<string, unknown> }>) {
    let updated = 0;
    for (const callback of statusCallbacks) {
      if (callback.eventIds?.length) {
        for (const eventId of callback.eventIds) {
          const event = await this.db.messageEvent.findUnique({ where: { eventId } });
          if (!event || event.direction !== 'outbound' || event.channelType !== 'messenger') continue;
          await this.db.messageEvent.update({
            where: { id: event.id },
            data: {
              status: callback.status,
              rawPayload: { ...(event.rawPayload as Record<string, unknown>), messengerStatusCallback: { status: callback.status, pageId: callback.pageId, psid: callback.psid, eventIds: callback.eventIds, rawPayload: callback.rawPayload } } as Prisma.InputJsonObject
            }
          });
          updated += 1;
        }
        continue;
      }

      const readEvents = await this.db.messageEvent.findMany({
        where: {
          direction: 'outbound',
          channelType: 'messenger',
          fromId: callback.pageId,
          ...(callback.psid ? { toId: callback.psid } : {}),
          status: { in: ['sent', 'delivered'] }
        }
      });
      for (const event of readEvents) {
        await this.db.messageEvent.update({
          where: { id: event.id },
          data: {
            status: callback.status,
            rawPayload: { ...(event.rawPayload as Record<string, unknown>), messengerStatusCallback: { status: callback.status, pageId: callback.pageId, psid: callback.psid, rawPayload: callback.rawPayload } } as Prisma.InputJsonObject
          }
        });
        updated += 1;
      }
    }
    return updated;
  }

  private async processInboundWhatsappMessage(
    channel: { id: string; organizationId: string; phoneNumberId: string | null; accessTokenCiphertext?: string | null; difyAppApiKeyCiphertext?: string | null },
    inboundEvent: { id: string; eventId: string },
    item: { fromId?: string; messageType?: string; textBody?: string; rawPayload: Record<string, unknown> }
  ) {
    if (item.messageType !== 'text' || !item.textBody || !item.fromId || !channel.phoneNumberId || !channel.accessTokenCiphertext || !channel.difyAppApiKeyCiphertext) {
      return 'skipped' as const;
    }

    const difyApiKey = decryptSecret(channel.difyAppApiKeyCiphertext);
    const whatsappAccessToken = decryptSecret(channel.accessTokenCiphertext);
    if (!difyApiKey || !whatsappAccessToken) return 'skipped' as const;

    const difyReply = await this.callDifyAppApi({ apiKey: difyApiKey, query: item.textBody, user: item.fromId, eventId: inboundEvent.eventId });
    if (!difyReply.answer) return 'skipped' as const;

    const whatsappResult = await this.sendWhatsappTextReply({ accessToken: whatsappAccessToken, phoneNumberId: channel.phoneNumberId, to: item.fromId, body: difyReply.answer });
    const outboundEventId = whatsappResult.messageId || `outbound_${inboundEvent.eventId}`;

    await this.db.$transaction(async tx => {
      await tx.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'processed', lastError: null, nextRetryAt: null } });
      await tx.messageEvent.create({
        data: {
          id: id('evt'),
          organizationId: channel.organizationId,
          channelId: channel.id,
          channelType: 'whatsapp',
          direction: 'outbound',
          eventId: outboundEventId,
          fromId: channel.phoneNumberId,
          toId: item.fromId,
          messageType: 'text',
          textBody: difyReply.answer,
          rawPayload: { dify: difyReply.raw, whatsapp: whatsappResult.raw } as Prisma.InputJsonObject,
          status: 'sent'
        }
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastError: null } });
    });

    return 'sent' as const;
  }

  private async processInboundMessengerMessage(
    channel: { id: string; organizationId: string; phoneNumberId: string | null; accessTokenCiphertext?: string | null; difyAppApiKeyCiphertext?: string | null },
    inboundEvent: { id: string; eventId: string },
    item: { fromId?: string; messageType?: string; textBody?: string; rawPayload: Record<string, unknown> }
  ) {
    if (item.messageType !== 'text' || !item.textBody || !item.fromId || !channel.phoneNumberId || !channel.accessTokenCiphertext || !channel.difyAppApiKeyCiphertext) {
      return 'skipped' as const;
    }

    const difyApiKey = decryptSecret(channel.difyAppApiKeyCiphertext);
    const pageAccessToken = decryptSecret(channel.accessTokenCiphertext);
    if (!difyApiKey || !pageAccessToken) return 'skipped' as const;

    const difyReply = await this.callDifyAppApi({ apiKey: difyApiKey, query: item.textBody, user: item.fromId, eventId: inboundEvent.eventId });
    if (!difyReply.answer) return 'skipped' as const;

    const messengerResult = await this.sendMessengerTextReply({ pageAccessToken, to: item.fromId, body: difyReply.answer });
    const outboundEventId = messengerResult.messageId || `outbound_${inboundEvent.eventId}`;

    await this.db.$transaction(async tx => {
      await tx.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'processed', lastError: null, nextRetryAt: null } });
      await tx.messageEvent.create({
        data: {
          id: id('evt'),
          organizationId: channel.organizationId,
          channelId: channel.id,
          channelType: 'messenger',
          direction: 'outbound',
          eventId: outboundEventId,
          fromId: channel.phoneNumberId,
          toId: item.fromId,
          messageType: 'text',
          textBody: difyReply.answer,
          rawPayload: { dify: difyReply.raw, messenger: messengerResult.raw } as Prisma.InputJsonObject,
          status: 'sent'
        }
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastError: null } });
    });

    return 'sent' as const;
  }

  private async callDifyAppApi(input: { apiKey: string; query: string; user: string; eventId: string }) {
    const response = await fetch(`${difyAppApiBaseUrl()}/chat-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ inputs: {}, query: input.query, response_mode: 'blocking', user: input.user, conversation_id: '', metadata: { source: 'whatsapp', eventId: input.eventId } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Dify App API failed with HTTP ${response.status}`);
    const answer = typeof data?.answer === 'string' ? data.answer : '';
    return { answer, raw: data as Record<string, unknown> };
  }

  private async sendWhatsappTextReply(input: { accessToken: string; phoneNumberId: string; to: string; body: string }) {
    const response = await fetch(`${metaGraphApiBaseUrl()}/${encodeURIComponent(input.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: input.to, type: 'text', text: { body: input.body } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`WhatsApp Cloud API failed with HTTP ${response.status}`);
    const firstMessage = Array.isArray(data?.messages) ? data.messages[0] as { id?: string } | undefined : undefined;
    return { messageId: firstMessage?.id, raw: data as Record<string, unknown> };
  }

  private async sendMessengerTextReply(input: { pageAccessToken: string; to: string; body: string }) {
    const response = await fetch(`${metaGraphApiBaseUrl()}/me/messages?access_token=${encodeURIComponent(input.pageAccessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: input.to }, message: { text: input.body } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Messenger Send API failed with HTTP ${response.status}`);
    const messageId = typeof data?.message_id === 'string' ? data.message_id : undefined;
    return { messageId, raw: data as Record<string, unknown> };
  }

  private extractWhatsappStatusCallbacks(payload: unknown) {
    const root = payload as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }, statuses?: Array<{ id?: string; status?: string; recipient_id?: string; timestamp?: string }> } }> }> };
    const extracted: Array<{ phoneNumberId: string; eventId: string; status: string; recipientId?: string; rawPayload: Record<string, unknown> }> = [];

    for (const entry of root.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        for (const status of value.statuses || []) {
          if (!status.id || !status.status) continue;
          extracted.push({
            phoneNumberId,
            eventId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
            rawPayload: { entry, change, status }
          });
        }
      }
    }

    return extracted;
  }

  private extractMessengerStatusCallbacks(payload: unknown) {
    const root = payload as { entry?: Array<{ id?: string; messaging?: Array<{ sender?: { id?: string }, recipient?: { id?: string }, delivery?: { mids?: string[]; watermark?: number }, read?: { watermark?: number } }> }> };
    const extracted: Array<{ pageId: string; eventIds?: string[]; status: string; psid?: string; rawPayload: Record<string, unknown> }> = [];

    for (const entry of root.entry || []) {
      const pageIdFromEntry = entry.id;
      for (const messaging of entry.messaging || []) {
        const deliveryMids = messaging.delivery?.mids?.filter(mid => typeof mid === 'string' && mid.length > 0);
        if (deliveryMids?.length) {
          const pageId = messaging.sender?.id || pageIdFromEntry;
          if (!pageId) continue;
          extracted.push({
            pageId,
            eventIds: deliveryMids,
            status: 'delivered',
            psid: messaging.recipient?.id,
            rawPayload: { entry, messaging, delivery: messaging.delivery }
          });
          continue;
        }

        if (messaging.read) {
          const pageId = messaging.recipient?.id || pageIdFromEntry;
          if (!pageId) continue;
          extracted.push({
            pageId,
            status: 'read',
            psid: messaging.sender?.id,
            rawPayload: { entry, messaging, read: messaging.read }
          });
        }
      }
    }

    return extracted;
  }

  private extractWhatsappMessages(payload: unknown) {
    const root = payload as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }, messages?: Array<{ id?: string; from?: string; type?: string; text?: { body?: string } }> } }> }> };
    const extracted: Array<{ phoneNumberId: string; eventId: string; fromId?: string; messageType?: string; textBody?: string; rawPayload: Record<string, unknown> }> = [];

    for (const entry of root.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        for (const message of value.messages || []) {
          if (!message.id) continue;
          extracted.push({
            phoneNumberId,
            eventId: message.id,
            fromId: message.from,
            messageType: message.type,
            textBody: message.text?.body,
            rawPayload: { entry, change, message }
          });
        }
      }
    }

    return extracted;
  }

  private extractMessengerMessages(payload: unknown) {
    const root = payload as { entry?: Array<{ id?: string; messaging?: Array<{ sender?: { id?: string }, recipient?: { id?: string }, message?: { mid?: string; text?: string } }> }> };
    const extracted: Array<{ pageId: string; eventId: string; fromId?: string; messageType?: string; textBody?: string; rawPayload: Record<string, unknown> }> = [];

    for (const entry of root.entry || []) {
      const pageIdFromEntry = entry.id;
      for (const messaging of entry.messaging || []) {
        const pageId = messaging.recipient?.id || pageIdFromEntry;
        const mid = messaging.message?.mid;
        if (!pageId || !mid) continue;
        extracted.push({
          pageId,
          eventId: mid,
          fromId: messaging.sender?.id,
          messageType: messaging.message?.text ? 'text' : 'unknown',
          textBody: messaging.message?.text,
          rawPayload: { entry, messaging }
        });
      }
    }

    return extracted;
  }

  async getOrganizationDashboard(organizationId: string) {
    const organization = await this.db.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const activeSubscription = await this.db.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const latestSubscription = await this.db.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true }
    });
    const subscription = activeSubscription || latestSubscription;
    const pendingUpgradeSubscription = activeSubscription ? await this.db.subscription.findFirst({
      where: { organizationId, status: 'needs_review', plan: { monthlyPriceEgp: { gt: activeSubscription.plan.monthlyPriceEgp } } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true, payments: { where: { status: 'needs_review' }, orderBy: { createdAt: 'desc' }, take: 1 } }
    }) : null;
    const pendingUpgradePayment = pendingUpgradeSubscription?.payments[0] || null;
    const pendingUpgradeApproval = pendingUpgradePayment
      ? await this.db.approvalRequest.findFirst({ where: { paymentId: pendingUpgradePayment.id }, orderBy: { createdAt: 'desc' } })
      : null;
    const payment = await this.db.payment.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const approval = await this.db.approvalRequest.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const provisioningJob = await this.db.provisioningJob.findFirst({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
    const latestInvoice = await this.db.invoice.findFirst({ where: { organizationId }, orderBy: { issuedAt: 'desc' } });

    const currentStep = organization.status === 'pending_payment'
      ? 'submit_payment'
      : organization.status === 'pending_approval'
        ? 'wait_for_admin_review'
        : organization.status === 'provisioning'
          ? 'wait_for_ai_studio'
          : organization.status === 'active'
            ? 'open_ai_studio'
            : 'contact_support';

    const aiStudioUrl = buildAiStudioUrl(organization);
    const usage = await this.getOrganizationUsage(organizationId);

    return {
      organization,
      subscription: subscription ? { id: subscription.id, status: subscription.status, planId: subscription.planId } : null,
      plan: subscription?.plan ?? null,
      payment,
      approval,
      provisioningJob,
      latestInvoice,
      currentStep,
      aiStudioUrl,
      usage,
      pendingUpgrade: pendingUpgradeSubscription ? {
        subscription: { id: pendingUpgradeSubscription.id, status: pendingUpgradeSubscription.status, planId: pendingUpgradeSubscription.planId },
        plan: pendingUpgradeSubscription.plan,
        payment: pendingUpgradePayment,
        approval: pendingUpgradeApproval
      } : null
    };
  }

  // ─── Admin Plan Management ─────────────────────────────────
  async adminCreatePlan(input: { name: string; monthlyPriceEgp: number; messageLimit: number; channelLimit: number; seatLimit: number; requiresManualApproval: boolean }) {
    const id = `plan_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    return this.db.plan.create({ data: { id, ...input } });
  }

  async adminUpdatePlan(planId: string, input: Partial<{ name: string; monthlyPriceEgp: number; messageLimit: number; channelLimit: number; seatLimit: number; requiresManualApproval: boolean }>) {
    const plan = await this.db.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new BadRequestException('Plan not found');
    return this.db.plan.update({ where: { id: planId }, data: input });
  }

  async adminDeletePlan(planId: string) {
    const subs = await this.db.subscription.count({ where: { planId } });
    if (subs > 0) throw new BadRequestException('Cannot delete plan with active subscriptions');
    await this.db.plan.delete({ where: { id: planId } });
    return { deleted: true };
  }

  // ─── Admin User Management ─────────────────────────────────
  async adminListUsers() {
    return this.db.user.findMany({
      include: { organization: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminUpdateUser(userId: string, input: { role?: string; status?: string }) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const updated = await this.db.user.update({ where: { id: userId }, data: input, include: { organization: { select: { id: true, name: true, status: true } } } });
    return { user: updated };
  }

  // ─── Content Management ────────────────────────────────────
  async setContentBlock(key: string, value: string, type = 'text') {
    return this.db.contentBlock.upsert({
      where: { key },
      update: { value, type },
      create: { id: `cb_${key}_${Date.now()}`, key, value, type },
    });
  }

  async listContentBlocks() {
    return this.db.contentBlock.findMany({ orderBy: { key: 'asc' } });
  }

  async deleteContentBlock(key: string) {
    await this.db.contentBlock.delete({ where: { key } }).catch(() => {});
    return { deleted: true };
  }
}
