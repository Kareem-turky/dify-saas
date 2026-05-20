import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string, phoneNumberId = `pn-${suffix}`) {
  const email = `test-message-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Test Message ${suffix}`, email, password, companyName: `Test Message Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  const token = `Bearer ${login.body.token}`;
  await request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', token)
    .send({
      phoneNumberId,
      wabaId: `waba-${suffix}`,
      accessToken: `WA-TOKEN-${suffix}`,
      verifyToken: `verify-${suffix}`,
      difyAppId: `dify-app-${suffix}`,
      difyAppApiKey: `DIFY-KEY-${suffix}`
    })
    .expect(200);
  return { token, organizationId: signup.body.organization.id, phoneNumberId };
}

function statusPayload(phoneNumberId: string, messageId: string, status = 'delivered') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId, display_phone_number: '+201****0000' },
          statuses: [{ id: messageId, status, timestamp: '1710000001', recipient_id: '201111111111' }]
        }
      }]
    }]
  };
}

describe('WhatsApp test message and status callbacks', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let previousFetch: typeof fetch;

  beforeEach(async () => {
    process.env.DIFY_APP_API_BASE_URL = 'https://dify-api.example.com/v1';
    process.env.META_GRAPH_API_BASE_URL = 'https://graph.facebook.test/v19.0';
    process.env.CHANNEL_SECRET_KEY='test-channel-secret-key';
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

  it('lets a customer send a WhatsApp/Dify test message from integrations and stores both events without leaking secrets', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'success', 'pn-test-success');
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer DIFY-KEY-success', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'هل البوت شغال؟', response_mode: 'blocking', user: '201111111111' });
        return { ok: true, json: async () => ({ answer: 'أيوه شغال ✅' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/pn-test-success/messages') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer WA-TOKEN-success', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ messaging_product: 'whatsapp', to: '201111111111', type: 'text', text: { body: 'أيوه شغال ✅' } });
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.test-outbound' }] }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const response = await request(app.getHttpServer())
      .post('/channels/whatsapp/test-message')
      .set('Authorization', customer.token)
      .send({ to: '201111111111', text: 'هل البوت شغال؟' })
      .expect(201);

    expect(response.body).toMatchObject({ sent: true, inboundEvent: { status: 'processed' }, outboundEvent: { eventId: 'wamid.test-outbound', status: 'sent' } });
    expect(JSON.stringify(response.body)).not.toContain('DIFY-KEY-success');
    expect(JSON.stringify(response.body)).not.toContain('WA-TOKEN-success');

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ direction: 'inbound', eventId: expect.stringMatching(/^test_/), textBody: 'هل البوت شغال؟', status: 'processed' });
    expect(events[1]).toMatchObject({ direction: 'outbound', eventId: 'wamid.test-outbound', textBody: 'أيوه شغال ✅', status: 'sent' });
  });

  it('updates outbound message delivery status from Meta status callbacks', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'status', 'pn-status');
    const prisma = moduleRef.get(PrismaService);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { organizationId_channelType: { organizationId: customer.organizationId, channelType: 'whatsapp' } } });
    await prisma.messageEvent.create({
      data: {
        id: 'evt_status_outbound',
        organizationId: customer.organizationId,
        channelId: channel.id,
        channelType: 'whatsapp',
        direction: 'outbound',
        eventId: 'wamid.status-outbound',
        fromId: 'pn-status',
        toId: '201111111111',
        messageType: 'text',
        textBody: 'tracking me',
        rawPayload: {},
        status: 'sent'
      }
    });

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send(statusPayload(customer.phoneNumberId, 'wamid.status-outbound', 'read'))
      .expect(201, { received: true, processed: 0, duplicates: 0, statusesUpdated: 1 });

    const updated = await prisma.messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.status-outbound' } });
    expect(updated.status).toBe('read');
    expect(updated.rawPayload).toMatchObject({ statusCallback: { status: 'read', recipientId: '201111111111' } });
  });
});
