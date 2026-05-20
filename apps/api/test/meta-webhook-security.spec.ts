import 'reflect-metadata';
import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

function signPayload(payload: unknown, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')}`;
}

describe('Meta webhook signature hardening', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.META_WEBHOOK_SIGNATURE_REQUIRED = 'true';
    process.env.META_WEBHOOK_APP_SECRET = 'meta-app-secret';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => {
    delete process.env.META_WEBHOOK_SIGNATURE_REQUIRED;
    delete process.env.META_WEBHOOK_APP_SECRET;
    await app.close();
  });

  it('rejects unsigned Meta webhook POSTs when signature verification is required', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .send({ object: 'page', entry: [] })
      .expect(401);
  });

  it('accepts correctly signed Meta webhook POSTs before processing the payload', async () => {
    const payload = { object: 'page', entry: [] };

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signPayload(payload, 'meta-app-secret'))
      .send(payload)
      .expect(201, { received: true, processed: 0, duplicates: 0 });
  });

  it('rejects invalid Meta webhook signatures using a safe constant-time comparison path', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [] };

    await request(app.getHttpServer())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=bad-signature')
      .send(payload)
      .expect(401);
  });
});
