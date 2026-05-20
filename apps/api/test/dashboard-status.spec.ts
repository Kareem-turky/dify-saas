import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('customer dashboard organization status', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    adminToken = await seedAndLoginAdmin(app, moduleRef);
  });

  afterEach(async () => { await app.close(); });

  it('returns dashboard summary with status, subscription, payment, provisioning and AI Studio URL', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Dashboard Owner', email: `dashboard-${Date.now()}@example.com`, companyName: 'Dashboard Co', preferredLanguage: 'ar', planId: 'growth' })
      .expect(201);

    const initial = await request(app.getHttpServer())
      .get(`/organizations/${signup.body.organization.id}/dashboard`)
      .expect(200);

    expect(initial.body.organization).toMatchObject({ id: signup.body.organization.id, status: 'pending_payment', name: 'Dashboard Co' });
    expect(initial.body.subscription).toMatchObject({ status: 'pending_payment' });
    expect(initial.body.plan).toMatchObject({ id: 'growth', name: 'Growth' });
    expect(initial.body.currentStep).toBe('submit_payment');
    expect(initial.body.aiStudioUrl).toBeNull();

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 3500, reference: 'DASH-1' })
      .expect(201);

    const approval = await request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .set('Authorization', adminToken)
      .send({ notes: 'Payment verified' })
      .expect(201);

    await request(app.getHttpServer()).post(`/provisioning/jobs/${approval.body.provisioningJob.id}/run`).set('Authorization', adminToken).expect(201);

    const active = await request(app.getHttpServer())
      .get(`/organizations/${signup.body.organization.id}/dashboard`)
      .expect(200);

    expect(active.body.organization.status).toBe('active');
    expect(active.body.currentStep).toBe('open_ai_studio');
    expect(active.body.provisioningJob).toMatchObject({ status: 'completed' });
    expect(active.body.aiStudioUrl).toBe(`https://studio.local/tenants/${active.body.organization.difyTenantId}`);
  });
});
