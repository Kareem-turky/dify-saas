import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PAYMENT_PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

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

    return { user: publicUser(user), organization, subscription, nextStep: 'submit_manual_payment_or_card_payment' };
  }

  async login(input: { email: string; password: string }) {
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
      await tx.auditLog.create({
        data: {
          id: id('aud'),
          actorUserId,
          organizationId: organization.id,
          action: 'payment_approved',
          targetType: 'payment',
          targetId: payment.id,
          metadata: { approvalId: approval.id, provisioningJobId: jobId, notes: notes || null }
        }
      });
      return { payment: paidPayment, approval: approvedRequest, subscription: activeSubscription, organization: provisioningOrganization, provisioningJob };
    });
  }

  listProvisioningJobs() {
    return this.db.provisioningJob.findMany({ orderBy: { createdAt: 'desc' }, include: { organization: true } });
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

  private publicChannel(channel: { id: string; organizationId: string; channelType: string; phoneNumberId?: string | null; wabaId?: string | null; accessTokenHash?: string | null; verifyToken?: string | null; appSecretHash?: string | null; status: string; lastError?: string | null; updatedByUserId?: string | null; createdAt: Date; updatedAt: Date }) {
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

  async saveWhatsappChannel(authorization: string | undefined, input: { phoneNumberId?: string; wabaId?: string; accessToken?: string; verifyToken?: string; appSecret?: string }) {
    const user = await this.requireUser(authorization);
    if (!user.organizationId) throw new ForbiddenException('Organization is required');
    const existingChannel = await this.db.channel.findUnique({ where: { organizationId_channelType: { organizationId: user.organizationId, channelType: 'whatsapp' } } });
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
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
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
          verifyToken: input.verifyToken,
          appSecretHash: input.appSecret ? hashSecret(input.appSecret) : existingChannel?.appSecretHash,
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
          metadata: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, hasAppSecret: Boolean(input.appSecret) }
        }
      });
      return savedChannel;
    });

    return this.publicChannel(channel);
  }

  async verifyMetaWebhook(query: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }) {
    if (query['hub.mode'] !== 'subscribe' || !query['hub.verify_token'] || !query['hub.challenge']) {
      throw new BadRequestException('Invalid Meta webhook verification request');
    }

    const channel = await this.db.channel.findFirst({ where: { channelType: 'whatsapp', verifyToken: query['hub.verify_token'], status: 'configured' } });
    if (!channel) throw new ForbiddenException('Invalid Meta webhook verify token');
    return query['hub.challenge'];
  }

  async receiveMetaWebhook(payload: unknown) {
    const messages = this.extractWhatsappMessages(payload);
    let processed = 0;
    let duplicates = 0;
    let ignored = 0;

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

      await this.db.messageEvent.create({
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
    }

    return { received: true, processed, duplicates, ...(ignored ? { ignored } : {}) };
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

    const aiStudioUrl = buildAiStudioUrl(organization);

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
