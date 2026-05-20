import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupLoginAndConfigureMessenger(app: INestApplication, suffix: string, pageId = `page-${suffix}`) {
  const email = `messenger-reply-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Messenger Reply ${suffix}`, email, password, companyName: `Messenger Reply Co ${suffix}`, preferredLanguage: 'ar', planId: 'growth' })
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

function messengerPayload(pageId: string, mid = 'm_mid.reply-1', text = 'hello from messenger') {
  return {
    object: 'page',
    entry: [{
      id: pageId,
      time: 1710000000,
      messaging: [{
        sender: { id: 'psid-123' },
        recipient: { id: pageId },
        timestamp: 1710000001,
        message: { mid, text }
      }]
    }]
  };
}

describe('Messenger to Dify reply gateway', () => {
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

  it('sends new Messenger text messages to Dify, stores the outbound reply, and sends it through Messenger Send API', async () => {
    const customer = await signupLoginAndConfigureMessenger(app, 'success', 'page-success');
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === 'https://dify-api.example.com/v1/chat-messages') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer DIFY-MESSENGER-KEY-success', 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'hello from messenger', response_mode: 'blocking', user: 'psid-123' });
        return { ok: true, json: async () => ({ answer: 'Messenger bot reply' }) } as Response;
      }
      if (target === 'https://graph.facebook.test/v19.0/me/messages?access_token=PAGE-TOKEN-success') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toMatchObject({ recipient: { id: 'psid-123' }, message: { text: 'Messenger bot reply' } });
        return { ok: true, json: async () => ({ recipient_id: 'psid-123', message_id: 'm_mid.outbound-1' }) } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    await request(app.getHttpServer()).post('/webhooks/meta').send(messengerPayload(customer.pageId, 'm_mid.reply-success')).expect(201, { received: true, processed: 1, duplicates: 0, messengerRepliesSent: 1 });

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ direction: 'inbound', channelType: 'messenger', eventId: 'm_mid.reply-success', fromId: 'psid-123', toId: 'page-success', status: 'processed' });
    expect(events[1]).toMatchObject({ direction: 'outbound', channelType: 'messenger', eventId: 'm_mid.outbound-1', fromId: 'page-success', toId: 'psid-123', textBody: 'Messenger bot reply', status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not call Dify or Messenger again when Meta retries the same Messenger message', async () => {
    const customer = await signupLoginAndConfigureMessenger(app, 'duplicate', 'page-duplicate');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('chat-messages')) return { ok: true, json: async () => ({ answer: 'first reply' }) } as Response;
      return { ok: true, json: async () => ({ message_id: 'm_mid.outbound-dup' }) } as Response;
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const payload = messengerPayload(customer.pageId, 'm_mid.reply-duplicate');

    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201);
    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201, { received: true, processed: 0, duplicates: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId } });
    expect(events).toHaveLength(2);
  });

  it('marks Messenger inbound messages failed without leaking tokens when Dify or Messenger delivery fails', async () => {
    const customer = await signupLoginAndConfigureMessenger(app, 'failure', 'page-failure');
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'upstream failed' }) })) as unknown as typeof fetch;

    await request(app.getHttpServer()).post('/webhooks/meta').send(messengerPayload(customer.pageId, 'm_mid.reply-failure')).expect(201, { received: true, processed: 1, duplicates: 0, messengerRepliesFailed: 1 });

    const event = await moduleRef.get(PrismaService).messageEvent.findUniqueOrThrow({ where: { eventId: 'm_mid.reply-failure' } });
    expect(event.status).toBe('failed');
    expect(event.lastError).toContain('Dify App API failed with HTTP 500');
    expect(event.lastError).not.toContain('DIFY-MESSENGER-KEY-failure');
    expect(event.lastError).not.toContain('PAGE-TOKEN-failure');
  });
});
