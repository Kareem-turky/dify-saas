import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupAndLogin(app: INestApplication, suffix: string, planId = 'starter') {
  const email = `channel-limit-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Channel Limit ${suffix}`, email, password, companyName: `Channel Limit Co ${suffix}`, preferredLanguage: 'ar', planId })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  return { token: login.body.token as string, organizationId: signup.body.organization.id as string };
}

function saveWhatsapp(app: INestApplication, token: string, suffix: string) {
  return request(app.getHttpServer())
    .put('/channels/whatsapp')
    .set('Authorization', `Bearer ${token}`)
    .send({ phoneNumberId: `pn-${suffix}`, wabaId: `waba-${suffix}`, accessToken: `WA-TOKEN-${suffix}`, verifyToken: `verify-${suffix}`, difyAppId: `dify-${suffix}`, difyAppApiKey: `DIFY-KEY-${suffix}` });
}

function saveMessenger(app: INestApplication, token: string, suffix: string) {
  return request(app.getHttpServer())
    .put('/channels/messenger')
    .set('Authorization', `Bearer ${token}`)
    .send({ pageId: `page-${suffix}`, pageName: `Page ${suffix}`, pageAccessToken: `PAGE-TOKEN-${suffix}`, verifyToken: `verify-page-${suffix}`, difyAppId: `dify-page-${suffix}`, difyAppApiKey: `DIFY-PAGE-KEY-${suffix}` });
}

describe('Plan channel limits', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.CHANNEL_SECRET_KEY = 'test-channel-limits-secret-key';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    await moduleRef.get(PrismaService).plan.update({ where: { id: 'starter' }, data: { channelLimit: 1 } });
  });

  afterEach(async () => {
    delete process.env.CHANNEL_SECRET_KEY;
    await app.close();
  });

  it('blocks creating a second configured channel when the organization plan channel limit is reached', async () => {
    const customer = await signupAndLogin(app, 'block-second-channel');

    await saveWhatsapp(app, customer.token, 'limit-first').expect(200);

    const blocked = await saveMessenger(app, customer.token, 'limit-second').expect(403);
    expect(blocked.body.message).toContain('Channel limit reached');

    const prisma = moduleRef.get(PrismaService);
    const channels = await prisma.channel.findMany({ where: { organizationId: customer.organizationId } });
    expect(channels).toHaveLength(1);
    expect(channels[0].channelType).toBe('whatsapp');
  });

  it('allows updating an already configured channel without consuming another channel slot', async () => {
    const customer = await signupAndLogin(app, 'update-existing-channel');

    await saveWhatsapp(app, customer.token, 'limit-update-1').expect(200);
    const updated = await saveWhatsapp(app, customer.token, 'limit-update-2').expect(200);

    expect(updated.body.phoneNumberId).toBe('pn-limit-update-2');
    const channels = await moduleRef.get(PrismaService).channel.findMany({ where: { organizationId: customer.organizationId } });
    expect(channels).toHaveLength(1);
  });

  it('reports channel usage and channel limit on the organization dashboard', async () => {
    const customer = await signupAndLogin(app, 'dashboard-channel-usage');

    await saveWhatsapp(app, customer.token, 'dashboard-channel').expect(200);

    const response = await request(app.getHttpServer()).get(`/organizations/${customer.organizationId}/dashboard`).expect(200);
    expect(response.body.usage).toMatchObject({
      channelsUsed: 1,
      channelLimit: 1,
      channelsRemaining: 0,
      channelLimitReached: true
    });
  });
});
