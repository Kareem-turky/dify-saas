import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string, phoneNumberId = `pn-${suffix}`) {
  const email = `reply-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Reply ${suffix}`, email, password, companyName: `Reply Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
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

function whatsappPayload(phoneNumberId: string, messageId = 'wamid.reply-1', body = 'hello bot') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId, display_phone_number: '+201****0000' },
          contacts: [{ wa_id: '201111111111', profile: { name: 'Meta Tester' } }],
          messages: [{ id: messageId, from: '201111111111', timestamp: '1710000000', type: 'text', text: { body } }]
        }
      }]
    }]
  };
}

describe('WhatsApp to Dify reply gateway', () => {
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
    previousFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = previousFetch;
    delete process.env.DIFY_APP_API_BASE_URL;
    delete process.env.META_GRAPH_API_BASE_URL;
    delete process.env.CHANNEL_SECRET_KEY;
    await app.close();
  });

  it('sends new inbound text messages to Dify, stores the outbound reply, and sends it through WhatsApp Cloud API', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'success', 'pn-success');
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer DIFY-KEY-success', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'hello bot', response_mode: 'blocking', user: '201111111111' });
        return { ok: true, json: async () => ({ answer: 'أهلاً! أنا مساعدك الذكي.' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/pn-success/messages') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer WA-TOKEN-success', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ messaging_product: 'whatsapp', to: '201111111111', type: 'text', text: { body: 'أهلاً! أنا مساعدك الذكي.' } });
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.outbound-1' }] }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer()).post('/webhooks/meta').send(whatsappPayload(customer.phoneNumberId, 'wamid.reply-success')).expect(201, { received: true, processed: 1, duplicates: 0, repliesSent: 1 });

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ direction: 'inbound', eventId: 'wamid.reply-success', status: 'processed' });
    expect(events[1]).toMatchObject({ direction: 'outbound', eventId: 'wamid.outbound-1', toId: '201111111111', textBody: 'أهلاً! أنا مساعدك الذكي.', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not call Dify or WhatsApp again when Meta retries the same inbound message', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'duplicate', 'pn-duplicate');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('chat-messages')) return { ok: true, json: async () => ({ answer: 'first reply' }) } as Response;
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.outbound-dup' }] }) } as Response;
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const payload = whatsappPayload(customer.phoneNumberId, 'wamid.reply-duplicate');

    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201);
    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201, { received: true, processed: 0, duplicates: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId } });
    expect(events).toHaveLength(2);
  });

  it('marks inbound messages failed without leaking tokens when Dify or WhatsApp delivery fails', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'failure', 'pn-failure');
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'upstream failed' }) })) as unknown as typeof fetch;

    await request(app.getHttpServer()).post('/webhooks/meta').send(whatsappPayload(customer.phoneNumberId, 'wamid.reply-failure')).expect(201, { received: true, processed: 1, duplicates: 0, repliesFailed: 1 });

    const event = await moduleRef.get(PrismaService).messageEvent.findUniqueOrThrow({ where: { eventId: 'wamid.reply-failure' } });
    expect(event.status).toBe('failed');
    expect(event.lastError).toContain('Dify App API failed with HTTP 500');
    expect(event.lastError).not.toContain('DIFY-KEY-failure');
    expect(event.lastError).not.toContain('WA-TOKEN-failure');
  });
});
