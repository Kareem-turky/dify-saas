import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupLoginAndConfigureWhatsapp(app: INestApplication, suffix: string, phoneNumberId = `pn-${suffix}`) {
  const email = `webhook-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Webhook ${suffix}`, email, password, companyName: `Webhook Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  const token = `Bearer ${login.body.token}`;
  await request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', token)
    .send({ phoneNumberId, wabaId: `waba-${suffix}`, accessToken: `TOKEN-${suffix}`, verifyToken: `verify-${suffix}` })
    .expect(200);
  return { token, organizationId: signup.body.organization.id, phoneNumberId, verifyToken: `verify-${suffix}` };
}

function whatsappPayload(phoneNumberId: string, messageId = 'wamid.test-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId, display_phone_number: '+201000000000' },
          contacts: [{ wa_id: '201111111111', profile: { name: 'Meta Tester' } }],
          messages: [{ id: messageId, from: '201111111111', timestamp: '1710000000', type: 'text', text: { body: 'hello bot' } }]
        }
      }]
    }]
  };
}

describe('Meta webhooks', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => { await app.close(); });

  it('verifies Meta webhook challenge using a configured WhatsApp verify token', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'verify');

    await request(app.getHttpServer())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': customer.verifyToken, 'hub.challenge': 'challenge-123' })
      .expect(200, 'challenge-123');

    await request(app.getHttpServer())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge-123' })
      .expect(403);
  });

  it('stores inbound WhatsApp messages with organization context and idempotency', async () => {
    const customer = await signupLoginAndConfigureWhatsapp(app, 'inbound', 'pn-inbound');
    const payload = whatsappPayload(customer.phoneNumberId, 'wamid.unique-1');

    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201, { received: true, processed: 1, duplicates: 0 });
    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201, { received: true, processed: 0, duplicates: 1 });

    const events = await moduleRef.get(PrismaService).messageEvent.findMany({ where: { organizationId: customer.organizationId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      organizationId: customer.organizationId,
      channelType: 'whatsapp',
      direction: 'inbound',
      eventId: 'wamid.unique-1',
      fromId: '201111111111',
      messageType: 'text',
      textBody: 'hello bot',
      status: 'received'
    });
  });

  it('marks inbound messages for unknown phone numbers as ignored without creating message events', async () => {
    const payload = whatsappPayload('unknown-phone-number', 'wamid.unknown-1');

    await request(app.getHttpServer()).post('/webhooks/meta').send(payload).expect(201, { received: true, processed: 0, duplicates: 0, ignored: 1 });

    const count = await moduleRef.get(PrismaService).messageEvent.count();
    expect(count).toBe(0);
  });
});
