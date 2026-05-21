import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string, phoneNumberId = `pn-${suffix}`) {
  const email = `usage-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Usage ${suffix}`, email, password, companyName: `Usage Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  await request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ phoneNumberId, wabaId: `waba-${suffix}`, accessToken: `WA-TOKEN-${suffix}`, verifyToken: `verify-${suffix}`, difyAppId: `dify-${suffix}`, difyAppApiKey: `DIFY-KEY-${suffix}` })
    .expect(200);
  return { organizationId: signup.body.organization.id, phoneNumberId };
}

function whatsappPayload(phoneNumberId: string, messageId: string, body = 'hello usage bot') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-usage',
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

describe('Plan usage limits', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let previousFetch: typeof fetch;

  beforeEach(async () => {
    process.env.DIFY_APP_API_BASE_URL = 'https://dify-api.example.com/v1';
    process.env.META_GRAPH_API_BASE_URL = 'https://graph.facebook.test/v19.0';
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    await moduleRef.get(PrismaService).plan.update({ where: { id: 'starter' }, data: { messageLimit: 1 } });
    previousFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = previousFetch;
    delete process.env.DIFY_APP_API_BASE_URL;
    delete process.env.META_GRAPH_API_BASE_URL;
    delete process.env.CHANNEL_SECRET_KEY;
    await app.close();
  });

  it('reports monthly message usage and plan limit on the organization dashboard', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'dashboard', 'pn-usage-dashboard');
    const prisma = moduleRef.get(PrismaService);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { organizationId_channelType: { organizationId: customer.organizationId, channelType: 'whatsapp' } } });
    await prisma.messageEvent.create({
      data: { id: 'evt_usage_dashboard', organizationId: customer.organizationId, channelId: channel.id, channelType: 'whatsapp', direction: 'outbound', eventId: 'wamid.usage-dashboard', rawPayload: {}, status: 'sent' }
    });

    const response = await request(app.getHttpServer()).get(`/organizations/${customer.organizationId}/dashboard`).expect(200);

    expect(response.body.usage).toMatchObject({ messagesUsed: 1, messageLimit: 1, messagesRemaining: 0, limitReached: true });
  });

  it('stores inbound messages as usage_limited and skips Dify/WhatsApp once the monthly message limit is reached', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'enforce', 'pn-usage-enforce');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        return { ok: true, json: async () => ({ answer: 'first allowed reply' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/pn-usage-enforce/messages') {
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.usage-outbound-1' }] }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer()).post('/webhooks/meta').send(whatsappPayload(customer.phoneNumberId, 'wamid.usage-inbound-1')).expect(201, { received: true, processed: 1, duplicates: 0, repliesSent: 1 });
    await request(app.getHttpServer()).post('/webhooks/meta').send(whatsappPayload(customer.phoneNumberId, 'wamid.usage-inbound-2')).expect(201, { received: true, processed: 1, duplicates: 0, usageLimited: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const limited = await moduleRef.get(PrismaService).messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.usage-inbound-2' } });
    expect(limited).toMatchObject({ direction: 'inbound', status: 'usage_limited', lastError: 'Monthly message limit reached' });
  });
});
