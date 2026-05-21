import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupUser(app: INestApplication, suffix: string) {
  const email = `rate-limit-${suffix}-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: `Rate Limit ${suffix}`, email, password, companyName: `Rate Limit Co ${suffix}`, preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  return { email, password };
}

describe('Production rate limiting guardrails', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '2';
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.META_WEBHOOK_RATE_LIMIT_MAX = '2';
    process.env.META_WEBHOOK_RATE_LIMIT_WINDOW_MS = '60000';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.META_WEBHOOK_RATE_LIMIT_MAX;
    delete process.env.META_WEBHOOK_RATE_LIMIT_WINDOW_MS;
    await app.close();
  });

  it('blocks repeated login attempts for the same email inside the configured window', async () => {
    const user = await signupUser(app, 'login');

    await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'wrong-1' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'wrong-2' }).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(429)
      .expect(({ body }) => {
        expect(body.message).toContain('Too many login attempts');
      });
  });

  it('rate limits Meta webhook requests by source IP before processing payloads', async () => {
    const sourceIp = `203.0.113.${Math.floor(Math.random() * 100)}`;
    const payload = { object: 'whatsapp_business_account', entry: [] };

    await request(app.getHttpServer()).post('/webhooks/meta').set('x-forwarded-for', sourceIp).send(payload).expect(201);
    await request(app.getHttpServer()).post('/webhooks/meta').set('x-forwarded-for', sourceIp).send(payload).expect(201);
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('x-forwarded-for', sourceIp)
      .send(payload)
      .expect(429)
      .expect(({ body }) => {
        expect(body.message).toContain('Too many Meta webhook requests');
      });
  });
});
