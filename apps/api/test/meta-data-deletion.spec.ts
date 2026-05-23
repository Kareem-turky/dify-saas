import 'reflect-metadata';
import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signedRequest(payload: unknown, secret: string) {
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${signature}.${encodedPayload}`;
}

describe('Meta data deletion callback', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.META_WEBHOOK_APP_SECRET = 'meta-data-deletion-secret';
    process.env.PUBLIC_WEB_URL = 'https://saas.example.test';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => {
    delete process.env.META_WEBHOOK_APP_SECRET;
    delete process.env.PUBLIC_WEB_URL;
    await app.close();
  });

  it('accepts a valid Meta signed_request and returns a confirmation tracking URL', async () => {
    const response = await request(app.getHttpServer())
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: 'meta-user-123' }, 'meta-data-deletion-secret') })
      .expect(201);

    expect(response.body).toMatchObject({
      url: expect.stringMatching(/^https:\/\/saas\.example\.test\/data-deletion\?confirmation_code=del_[a-f0-9]{16}$/),
      confirmation_code: expect.stringMatching(/^del_[a-f0-9]{16}$/)
    });
    expect(response.body.url).toBe(`https://saas.example.test/data-deletion?confirmation_code=${response.body.confirmation_code}`);
    expect(JSON.stringify(response.body)).not.toContain('meta-data-deletion-secret');
    expect(JSON.stringify(response.body)).not.toContain('meta-user-123');
  });

  it('rejects invalid Meta signed_request values before returning a confirmation code', async () => {
    await request(app.getHttpServer())
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: signedRequest({ user_id: 'meta-user-123' }, 'wrong-secret') })
      .expect(401);
  });
});
