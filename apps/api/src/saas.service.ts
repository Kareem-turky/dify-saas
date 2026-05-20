import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

  async verifyMetaWebhook(query: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }) {
    if (query['hub.mode'] !== 'subscribe' || !query['hub.verify_token'] || !query['hub.challenge']) {
      throw new BadRequestException('Invalid Meta webhook verification request');
    }

    const channel = await this.db.channel.findFirst({ where: { channelType: { in: ['whatsapp', 'messenger'] }, verifyToken: query['hub.verify_token'], status: 'configured' } });
    if (!channel) throw new ForbiddenException('Invalid Meta webhook verify token');
    return query['hub.challenge'];
  }

  async receiveMetaWebhook(payload: unknown) {
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

      try {
        const replyStatus = await this.processInboundWhatsappMessage(channel, inboundEvent, item);
        if (replyStatus === 'sent') repliesSent += 1;
      } catch (error) {
        repliesFailed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError, nextRetryAt: new Date(Date.now() + 60_000) } });
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

      try {
        const replyStatus = await this.processInboundMessengerMessage(channel, inboundEvent, item);
        if (replyStatus === 'sent') messengerRepliesSent += 1;
      } catch (error) {
        messengerRepliesFailed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({ where: { id: inboundEvent.id }, data: { status: 'failed', lastError, nextRetryAt: new Date(Date.now() + 60_000) } });
        await this.db.channel.update({ where: { id: channel.id }, data: { lastError } });
      }
    }

    return { received: true, processed, duplicates, ...(ignored ? { ignored } : {}), ...(statusesUpdated ? { statusesUpdated } : {}), ...(messengerStatusesUpdated ? { messengerStatusesUpdated } : {}), ...(repliesSent ? { repliesSent } : {}), ...(repliesFailed ? { repliesFailed } : {}), ...(messengerRepliesSent ? { messengerRepliesSent } : {}), ...(messengerRepliesFailed ? { messengerRepliesFailed } : {}) };
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

  async retryFailedMessageEvents(input: { limit?: number; actorUserId?: string }) {
    const limit = Math.min(Math.max(input.limit || 10, 1), 50);
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

    let retried = 0;
    let failed = 0;

    for (const event of failedEvents) {
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
            data: { status: 'failed', lastError: 'Retry skipped because the message is not dispatchable', retryCount: nextRetryCount, nextRetryAt: new Date(Date.now() + 5 * 60_000) }
          });
        }
      } catch (error) {
        failed += 1;
        const lastError = sanitizeIntegrationError(error);
        await this.db.messageEvent.update({
          where: { id: event.id },
          data: { status: 'failed', lastError, retryCount: nextRetryCount, nextRetryAt: new Date(Date.now() + 5 * 60_000) }
        });
        await this.db.channel.update({ where: { id: event.channelId }, data: { lastError } });
      }
    }

    if (failedEvents.length) {
      await this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'message_retry_run',
        targetType: 'message_event',
        metadata: { attempted: failedEvents.length, retried, failed }
      });
    }

    return { attempted: failedEvents.length, retried, failed };
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
