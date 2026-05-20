import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

async function signupLoginAndConfigureMessenger(app: INestApplication, suffix: string, pageId = `page-${suffix}`) {
  const email = `messenger-retry-status-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Messenger Retry ${suffix}`, email, password, companyName: `Messenger Retry Co ${suffix}`, preferredLanguage: 'ar', planId: 'growth' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  await request(app.getHttpServer())
    .put('/channels/messenger')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({
      pageId,
      pageName: `Page ${suffix}`,
      pageAccessToken: `PAGE-TOKEN-${suffix}`,
      verifyToken: `verify-${suffix}`,
      difyAppId: `dify-messenger-${suffix}`,
      difyAppApiKey: `DIFY-MESSENGER-KEY-${suffix}`
    })
    .expect(200);
  return { organizationId: signup.body.organization.id, pageId };
}

function messengerPayload(pageId: string, mid = 'm_mid.retry-1', text = 'retry this messenger message') {
  return {
    object: 'page',
    entry: [{
      id: pageId,
      time: 1710000000,
      messaging: [{
        sender: { id: 'psid-retry-123' },
        recipient: { id: pageId },
        timestamp: 1710000001,
        message: { mid, text }
      }]
    }]
  };
}

function messengerDeliveryPayload(pageId: string, mid = 'm_mid.outbound-delivered') {
  return {
    object: 'page',
    entry: [{
      id: pageId,
      time: 1710000002,
      messaging: [{
        sender: { id: pageId },
        recipient: { id: 'psid-retry-123' },
        timestamp: 1710000003,
        delivery: { mids: [mid], watermark: 1710000002 }
      }]
    }]
  };
}

describe('Messenger failed reply retries and status callbacks', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let previousFetch: typeof fetch;

  beforeEach(async () => {
    process.env.DIFY_APP_API_BASE_URL = 'https://dify-api.example.com/v1';
    process.env.META_GRAPH_API_BASE_URL = 'https://graph.facebook.test/v19.0';
    process.env.CHANNEL_SECRET_KEY='test-c...-key';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD='***';
    process.env.AUTH_TOKEN_SECRET='***';
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
    await app.close();
  });

  it('lets admins retry failed inbound Messenger messages and records a sent outbound event', async () => {
    const adminToken = await seedAndLoginAdmin(app, moduleRef);
    const customer = await signupLoginAndConfigureMessenger(app, 'admin-retry', 'page-admin-retry');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (fetchMock.mock.calls.length === 1) {
        return { ok: false, status: 500, json: async () => ({ message: 'temporary messenger outage' }) } as Response;
      }
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        return { ok: true, json: async () => ({ answer: 'messenger retry succeeded' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/me/messages?access_token=PAGE-TOKEN-admin-retry') {
        return { ok: true, json: async () => ({ recipient_id: 'psid-retry-123', message_id: 'm_mid.retry-outbound' }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send(messengerPayload(customer.pageId, 'm_mid.retry-inbound'))
      .expect(201, { received: true, processed: 1, duplicates: 0, messengerRepliesFailed: 1 });

    await request(app.getHttpServer())
      .post('/admin/message-events/retry-failed')
      .set('Authorization', adminToken)
      .send({ limit: 5 })
      .expect(201, { attempted: 1, retried: 1, failed: 0 });

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ direction: 'inbound', channelType: 'messenger', eventId: 'm_mid.retry-inbound', status: 'processed', retryCount: 1, lastError: null });
    expect(events[1]).toMatchObject({ direction: 'outbound', channelType: 'messenger', eventId: 'm_mid.retry-outbound', textBody: 'messenger retry succeeded', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('updates outbound Messenger delivery callbacks without creating inbound duplicates', async () => {
    const customer = await signupLoginAndConfigureMessenger(app, 'delivery', 'page-delivery');
    const prisma = moduleRef.get(PrismaService);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { organizationId_channelType: { organizationId: customer.organizationId, channelType: 'messenger' } } });
    await prisma.messageEvent.create({
      data: {
        id: 'evt_messenger_status_outbound',
        organizationId: customer.organizationId,
        channelId: channel.id,
        channelType: 'messenger',
        direction: 'outbound',
        eventId: 'm_mid.outbound-delivered',
        fromId: 'page-delivery',
        toId: 'psid-retry-123',
        messageType: 'text',
        textBody: 'tracking messenger delivery',
        rawPayload: {},
        status: 'sent'
      }
    });

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send(messengerDeliveryPayload(customer.pageId, 'm_mid.outbound-delivered'))
      .expect(201, { received: true, processed: 0, duplicates: 0, messengerStatusesUpdated: 1 });

    const updated = await prisma.messageEvent.findUniqueOrThrow({ where: { eventId: 'm_mid.outbound-delivered' } });
    expect(updated.status).toBe('delivered');
    expect(updated.rawPayload).toMatchObject({ messengerStatusCallback: { status: 'delivered', pageId: 'page-delivery', eventIds: ['m_mid.outbound-delivered'] } });
  });
});
