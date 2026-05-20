import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string, phoneNumberId = `pn-${suffix}`) {
  const email = `retry-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Retry ${suffix}`, email, password, companyName: `Retry Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  await request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({
      phoneNumberId,
      wabaId: `waba-${suffix}`,
      accessToken: `WA-TOKEN-${suffix}`,
      verifyToken: `verify-${suffix}`,
      difyAppId: `dify-app-${suffix}`,
      difyAppApiKey: `DIFY-KEY-${suffix}`
    })
    .expect(200);
  return { organizationId: signup.body.organization.id, phoneNumberId };
}

function whatsappPayload(phoneNumberId: string, messageId = 'wamid.retry-1', body = 'retry this') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId, display_phone_number: '+201****0000' },
          messages: [{ id: messageId, from: '201111111111', timestamp: '1710000000', type: 'text', text: { body } }]
        }
      }]
    }]
  };
}

describe('WhatsApp failed reply retries', () => {
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

  it('lets admins retry failed inbound WhatsApp messages and records a sent outbound event', async () => {
    const adminToken = await seedAndLoginAdmin(app, moduleRef);
    const customer = await signupLoginAndConfigureWhatsapp(app, 'admin-retry', 'pn-admin-retry');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (fetchMock.mock.calls.length === 1) {
        return { ok: false, status: 500, json: async () => ({ message: 'temporary outage' }) } as Response;
      }
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        return { ok: true, json: async () => ({ answer: 'retry succeeded' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/pn-admin-retry/messages') {
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.retry-outbound' }] }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send(whatsappPayload(customer.phoneNumberId, 'wamid.retry-inbound'))
      .expect(201, { received: true, processed: 1, duplicates: 0, repliesFailed: 1 });

    await request(app.getHttpServer())
      .post('/admin/message-events/retry-failed')
      .set('Authorization', adminToken)
      .send({ limit: 5 })
      .expect(201, { attempted: 1, retried: 1, failed: 0 });

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ direction: 'inbound', eventId: 'wamid.retry-inbound', status: 'processed', retryCount: 1, lastError: null });
    expect(events[1]).toMatchObject({ direction: 'outbound', eventId: 'wamid.retry-outbound', textBody: 'retry succeeded', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires admin authorization before retrying failed message events', async () => {
    await request(app.getHttpServer())
      .post('/admin/message-events/retry-failed')
      .send({ limit: 5 })
      .expect(401);
  });
});
