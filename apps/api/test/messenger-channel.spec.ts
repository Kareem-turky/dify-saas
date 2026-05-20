import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupAndLogin(app: INestApplication, suffix: string) {
  const email = `messenger-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Messenger ${suffix}`, email, password, companyName: `Messenger Co ${suffix}`, preferredLanguage: 'ar', planId: 'growth' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  return { token: `Bearer ${login.body.token}`, organizationId: signup.body.organization.id };
}

describe('Messenger/Page channel settings', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    process.env.CHANNEL_SECRET_KEY = 'test-channel-secret-key';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.CHANNEL_SECRET_KEY;
    await app.close();
  });

  it('requires a bearer token for Messenger/Page channel settings', async () => {
    await request(app.getHttpServer()).get('/channels/messenger').expect(401);
    await request(app.getHttpServer()).put('/channels/messenger').send({}).expect(401);
  });

  it('saves and returns non-secret Messenger Page settings for the current organization', async () => {
    const customer = await signupAndLogin(app, 'owner');

    const saved = await request(app.getHttpServer())
      .put('/channels/messenger')
      .set('Authorization', customer.token)
      .send({
        pageId: 'page-123',
        pageName: 'Support Page',
        pageAccessToken: 'PAGE_SECRET_TOKEN',
        verifyToken: 'messenger-verify-me',
        appSecret: 'PAGE_APP_SECRET',
        difyAppId: 'dify-messenger-app',
        difyAppApiKey: 'DIFY-MESSENGER-KEY'
      })
      .expect(200);

    expect(saved.body).toMatchObject({
      organizationId: customer.organizationId,
      channelType: 'messenger',
      pageId: 'page-123',
      pageName: 'Support Page',
      status: 'configured',
      hasPageAccessToken: true,
      hasAppSecret: true,
      difyAppId: 'dify-messenger-app',
      hasDifyAppApiKey: true,
      webhookUrl: 'https://api.example.com/webhooks/meta'
    });
    expect(JSON.stringify(saved.body)).not.toContain('PAGE_SECRET_TOKEN');
    expect(JSON.stringify(saved.body)).not.toContain('PAGE_APP_SECRET');
    expect(JSON.stringify(saved.body)).not.toContain('DIFY-MESSENGER-KEY');

    const loaded = await request(app.getHttpServer())
      .get('/channels/messenger')
      .set('Authorization', customer.token)
      .expect(200);

    expect(loaded.body).toMatchObject(saved.body);
  });

  it('uses Messenger verify tokens during Meta webhook verification and records audit logs', async () => {
    const customer = await signupAndLogin(app, 'verify');
    const saved = await request(app.getHttpServer())
      .put('/channels/messenger')
      .set('Authorization', customer.token)
      .send({ pageId: 'page-verify', pageAccessToken: 'PAGE_TOKEN', verifyToken: 'verify-messenger' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-messenger', 'hub.challenge': 'challenge-ok' })
      .expect(200, 'challenge-ok');

    const auditLog = await moduleRef.get(PrismaService).auditLog.findFirst({
      where: { action: 'messenger_channel_saved', organizationId: customer.organizationId }
    });
    expect(auditLog).toMatchObject({ actorUserId: saved.body.updatedByUserId, targetType: 'channel', targetId: saved.body.id });
    expect(JSON.stringify(auditLog)).not.toContain('PAGE_TOKEN');
  });
});
