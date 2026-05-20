import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupAndLogin(app: INestApplication, suffix: string) {
  const email = `whatsapp-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      name: `WhatsApp ${suffix}`,
      email,
      password,
      companyName: `WhatsApp Co ${suffix}`,
      preferredLanguage: 'ar',
      planId: 'starter'
    })
    .expect(201);

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  return { token: `Bearer ${login.body.token}`, organizationId: signup.body.organization.id };
}

describe('WhatsApp channel settings', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => { await app.close(); });

  it('requires a bearer token for WhatsApp channel settings', async () => {
    await request(app.getHttpServer()).get('/channels/whatsapp').expect(401);
    await request(app.getHttpServer()).put('/channels/whatsapp').send({}).expect(401);
  });

  it('saves and returns non-secret WhatsApp settings for the current organization', async () => {
    const customer = await signupAndLogin(app, 'owner');

    const saved = await request(app.getHttpServer())
      .put('/channels/whatsapp')
      .set('Authorization', customer.token)
      .send({
        phoneNumberId: '1234567890',
        wabaId: '9876543210',
        accessToken: 'EAAB_SECRET_TOKEN',
        verifyToken: 'verify-me',
        appSecret: 'APP_SECRET'
      })
      .expect(200);

    expect(saved.body).toMatchObject({
      organizationId: customer.organizationId,
      channelType: 'whatsapp',
      phoneNumberId: '1234567890',
      wabaId: '9876543210',
      status: 'configured',
      hasAccessToken: true,
      hasAppSecret: true,
      webhookUrl: 'https://api.example.com/webhooks/meta'
    });
    expect(JSON.stringify(saved.body)).not.toContain('EAAB_SECRET_TOKEN');
    expect(JSON.stringify(saved.body)).not.toContain('APP_SECRET');

    const loaded = await request(app.getHttpServer())
      .get('/channels/whatsapp')
      .set('Authorization', customer.token)
      .expect(200);

    expect(loaded.body).toMatchObject(saved.body);
    expect(JSON.stringify(loaded.body)).not.toContain('EAAB_SECRET_TOKEN');
  });

  it('isolates WhatsApp settings by organization', async () => {
    const first = await signupAndLogin(app, 'first');
    const second = await signupAndLogin(app, 'second');

    await request(app.getHttpServer())
      .put('/channels/whatsapp')
      .set('Authorization', first.token)
      .send({ phoneNumberId: 'pn-first', wabaId: 'waba-first', accessToken: 'TOKEN1', verifyToken: 'verify-first' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/channels/whatsapp')
      .set('Authorization', second.token)
      .expect(404);
  });

  it('records audit log when WhatsApp settings are saved', async () => {
    const customer = await signupAndLogin(app, 'audit');

    const saved = await request(app.getHttpServer())
      .put('/channels/whatsapp')
      .set('Authorization', customer.token)
      .send({ phoneNumberId: 'pn-audit', wabaId: 'waba-audit', accessToken: 'TOKEN2', verifyToken: 'verify-audit' })
      .expect(200);

    const auditLog = await moduleRef.get(PrismaService).auditLog.findFirst({
      where: { action: 'whatsapp_channel_saved', organizationId: customer.organizationId }
    });

    expect(auditLog).toMatchObject({
      actorUserId: saved.body.updatedByUserId,
      targetType: 'channel',
      targetId: saved.body.id
    });
    expect(JSON.stringify(auditLog)).not.toContain('TOKEN2');
  });
});
