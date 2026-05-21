import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string) {
  const email = `hardening-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Hardening ${suffix}`, email, password, companyName: `Hardening Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  await request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({
      phoneNumberId: `pn-${suffix}`,
      wabaId: `waba-${suffix}`,
      accessToken: `WA-TOKEN-${suffix}`,
      verifyToken: `verify-${suffix}`,
      difyAppId: `dify-${suffix}`,
      difyAppApiKey: `DIFY-KEY-${suffix}`
    })
    .expect(200);
  return { organizationId: signup.body.organization.id, phoneNumberId: `pn-${suffix}` };
}

describe('Message event production hardening', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let previousFetch: typeof fetch;

  beforeEach(async () => {
    process.env.DIFY_APP_API_BASE_URL = 'https://dify-api.example.com/v1';
    process.env.META_GRAPH_API_BASE_URL = 'https://graph.facebook.test/v19.0';
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'AdminPass123!';
    process.env.AUTH_TOKEN_SECRET = 'test-secret';
    process.env.MESSAGE_EVENT_MAX_RETRIES = '3';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    previousFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = previousFetch;
    delete process.env.DIFY_APP_API_BASE_URL;
    delete process.env.META_GRAPH_API_BASE_URL;
    delete process.env.CHANNEL_SECRET_KEY;
    delete process.env.MESSAGE_EVENT_MAX_RETRIES;
    await app.close();
  });

  it('retries only due failed inbound events and moves exhausted events to dead-letter', async () => {
    const adminToken = await seedAndLoginAdmin(app, moduleRef);
    const customer = await signupLoginAndConfigureWhatsapp(app, 'retry-policy');
    const prisma = moduleRef.get(PrismaService);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { organizationId_channelType: { organizationId: customer.organizationId, channelType: 'whatsapp' } } });
    const future = new Date(Date.now() + 10 * 60_000);
    const past = new Date(Date.now() - 60_000);

    await prisma.messageEvent.createMany({ data: [
      { id: 'evt_due_failed', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.due-failed', fromId: '201111111111', toId: customer.phoneNumberId, messageType: 'text', textBody: 'retry me now', rawPayload: {}, status: 'failed', retryCount: 1, nextRetryAt: past },
      { id: 'evt_future_failed', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.future-failed', fromId: '201111111112', toId: customer.phoneNumberId, messageType: 'text', textBody: 'not yet', rawPayload: {}, status: 'failed', retryCount: 1, nextRetryAt: future },
      { id: 'evt_exhausted_failed', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.exhausted-failed', fromId: '201111111113', toId: customer.phoneNumberId, messageType: 'text', textBody: 'too many retries', rawPayload: {}, status: 'failed', retryCount: 3, nextRetryAt: past, lastError: 'previous outage' }
    ] });

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        return { ok: true, json: async () => ({ answer: 'retry policy ok' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/pn-retry-policy/messages') {
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.retry-policy-outbound' }] }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer())
      .post('/admin/message-events/retry-failed')
      .set('Authorization', adminToken)
      .send({ limit: 10 })
      .expect(201, { attempted: 1, retried: 1, failed: 0, skippedNotDue: 1, deadLettered: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(prisma.messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.due-failed' } })).resolves.toMatchObject({ status: 'processed', retryCount: 2, lastError: null, nextRetryAt: null });
    await expect(prisma.messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.future-failed' } })).resolves.toMatchObject({ status: 'failed', retryCount: 1 });
    await expect(prisma.messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.exhausted-failed' } })).resolves.toMatchObject({ status: 'dead', retryCount: 3, lastError: 'previous outage' });
  });

  it('exposes an admin monitoring summary for channel message queues', async () => {
    const adminToken = await seedAndLoginAdmin(app, moduleRef);
    const customer = await signupLoginAndConfigureWhatsapp(app, 'summary');
    const prisma = moduleRef.get(PrismaService);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { organizationId_channelType: { organizationId: customer.organizationId, channelType: 'whatsapp' } } });
    await prisma.messageEvent.createMany({ data: [
      { id: 'evt_summary_received', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.summary-received', rawPayload: {}, status: 'received' },
      { id: 'evt_summary_failed', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.summary-failed', rawPayload: {}, status: 'failed', nextRetryAt: new Date(Date.now() - 1000) },
      { id: 'evt_summary_dead', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'inbound', eventId: 'wamid.summary-dead', rawPayload: {}, status: 'dead', retryCount: 3 }
    ] });

    const response = await request(app.getHttpServer())
      .get('/admin/message-events/summary')
      .set('Authorization', adminToken)
      .expect(200);

    expect(response.body.totals).toMatchObject({ received: 1, failed: 1, dead: 1 });
    expect(response.body.byChannel.whatsapp).toMatchObject({ received: 1, failed: 1, dead: 1 });
    expect(response.body.retryableFailed).toBe(1);
    expect(response.body.deadLettered).toBe(1);
    expect(response.body.oldestFailedAt).toEqual(expect.any(String));
  });
});
