import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef };
}

describe('persistent SaaS storage', () => {
  let firstApp: INestApplication | undefined;
  let secondApp: INestApplication | undefined;
  let firstModule: TestingModule | undefined;
  let secondModule: TestingModule | undefined;

  afterEach(async () => {
    if (firstApp) await firstApp.close();
    if (secondApp) await secondApp.close();
    firstApp = undefined;
    secondApp = undefined;
    firstModule = undefined;
    secondModule = undefined;
  });

  it('keeps organizations available after application restart so manual payment can continue', async () => {
    ({ app: firstApp, moduleRef: firstModule } = await createApp());
    await firstModule.get(PrismaService).resetForTests();

    const signup = await request(firstApp.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Persistent Customer',
        email: `persistent-${Date.now()}@example.com`,
        companyName: 'Persistent Co',
        preferredLanguage: 'ar',
        planId: 'starter'
      })
      .expect(201);

    const organizationId = signup.body.organization.id;
    await firstApp.close();
    firstApp = undefined;

    ({ app: secondApp, moduleRef: secondModule } = await createApp());
    const payment = await request(secondApp.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId, method: 'instapay', amountEgp: 1500, reference: 'PERSIST-1' })
      .expect(201);

    expect(payment.body.organization.id).toBe(organizationId);
    expect(payment.body.payment.status).toBe('needs_review');
  });
});
