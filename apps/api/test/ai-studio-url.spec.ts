import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = {
    DIFY_CONSOLE_BASE_URL: process.env.DIFY_CONSOLE_BASE_URL,
    DIFY_WORKSPACE_URL_TEMPLATE: process.env.DIFY_WORKSPACE_URL_TEMPLATE
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('AI Studio URL builder', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function boot() {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    adminToken = await seedAndLoginAdmin(app, moduleRef);
  }

  it('builds the customer dashboard AI Studio link from DIFY_WORKSPACE_URL_TEMPLATE', async () => {
    await withEnv({ DIFY_WORKSPACE_URL_TEMPLATE: 'https://studio.example.com/console?tenant={tenantId}&org={organizationId}' }, async () => {
      await boot();

      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Studio Owner', email: `studio-${Date.now()}@example.com`, companyName: 'Studio URL Co', preferredLanguage: 'ar', planId: 'growth' })
        .expect(201);

      const paymentProof = await request(app.getHttpServer())
        .post('/payments/manual-proof')
        .send({ organizationId: signup.body.organization.id, method: 'bank_transfer', amountEgp: 3500, reference: 'STUDIO-URL-1' })
        .expect(201);

      const approval = await request(app.getHttpServer())
        .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
        .set('Authorization', adminToken)
        .send({ notes: 'Payment verified' })
        .expect(201);

      await request(app.getHttpServer()).post(`/provisioning/jobs/${approval.body.provisioningJob.id}/run`).set('Authorization', adminToken).expect(201);

      const dashboard = await request(app.getHttpServer())
        .get(`/organizations/${signup.body.organization.id}/dashboard`)
        .expect(200);

      expect(dashboard.body.organization.status).toBe('active');
      expect(dashboard.body.aiStudioUrl).toBe(
        `https://studio.example.com/console?tenant=${dashboard.body.organization.difyTenantId}&org=${signup.body.organization.id}`
      );
    });
  });
});
