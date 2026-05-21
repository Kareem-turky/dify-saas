import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

async function createActiveStarterCustomer(app: INestApplication, adminToken: string) {
  const email = `upgrade-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: 'Upgrade Owner', email, password, companyName: 'Upgrade Co', preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  const payment = await request(app.getHttpServer())
    .post('/payments/manual-proof')
    .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'STARTER-PAID', proofUrl: 's3://proofs/starter.jpg' })
    .expect(201);
  const approval = await request(app.getHttpServer())
    .post(`/admin/approvals/${payment.body.payment.id}/approve`)
    .set('Authorization', adminToken)
    .send({ notes: 'Initial payment verified' })
    .expect(201);
  await request(app.getHttpServer()).post(`/provisioning/jobs/${approval.body.provisioningJob.id}/run`).set('Authorization', adminToken).expect(201);
  return { token: login.body.token as string, organizationId: signup.body.organization.id as string };
}

describe('Plan upgrade requests', () => {
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

  it('creates a manual upgrade payment review for a higher plan without disabling the active workspace', async () => {
    const customer = await createActiveStarterCustomer(app, adminToken);

    const upgrade = await request(app.getHttpServer())
      .post('/subscriptions/upgrade')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ planId: 'growth', method: 'instapay', amountEgp: 3500, reference: 'UP-GROWTH-1', proofUrl: 's3://proofs/upgrade-growth.jpg' })
      .expect(201);

    expect(upgrade.body.subscription).toMatchObject({ planId: 'growth', status: 'needs_review' });
    expect(upgrade.body.payment).toMatchObject({ amountEgp: 3500, status: 'needs_review', reference: 'UP-GROWTH-1' });
    expect(upgrade.body.approval).toMatchObject({ status: 'open' });
    expect(upgrade.body.organization).toMatchObject({ id: customer.organizationId, status: 'active' });

    const approved = await request(app.getHttpServer())
      .post(`/admin/approvals/${upgrade.body.payment.id}/approve`)
      .set('Authorization', adminToken)
      .send({ notes: 'Upgrade payment verified' })
      .expect(201);

    expect(approved.body.subscription).toMatchObject({ planId: 'growth', status: 'active' });
    expect(approved.body.organization).toMatchObject({ id: customer.organizationId, status: 'active' });
    expect(approved.body.provisioningJob).toBeNull();

    const dashboard = await request(app.getHttpServer()).get(`/organizations/${customer.organizationId}/dashboard`).expect(200);
    expect(dashboard.body.plan).toMatchObject({ id: 'growth' });
    expect(dashboard.body.currentStep).toBe('open_ai_studio');
  });

  it('rejects downgrade or same-plan upgrade requests', async () => {
    const customer = await createActiveStarterCustomer(app, adminToken);

    await request(app.getHttpServer())
      .post('/subscriptions/upgrade')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ planId: 'starter', method: 'instapay', amountEgp: 1500, reference: 'NO-DOWNGRADE' })
      .expect(400);
  });

  it('prevents duplicate pending upgrade requests for the same target plan', async () => {
    const customer = await createActiveStarterCustomer(app, adminToken);

    const firstUpgrade = await request(app.getHttpServer())
      .post('/subscriptions/upgrade')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ planId: 'growth', method: 'instapay', amountEgp: 3500, reference: 'UP-GROWTH-FIRST', proofUrl: 's3://proofs/upgrade-growth-first.jpg' })
      .expect(201);

    const duplicateUpgrade = await request(app.getHttpServer())
      .post('/subscriptions/upgrade')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ planId: 'growth', method: 'instapay', amountEgp: 3500, reference: 'UP-GROWTH-DUPLICATE', proofUrl: 's3://proofs/upgrade-growth-duplicate.jpg' })
      .expect(409);

    expect(duplicateUpgrade.body.message).toContain('already pending');

    const pendingGrowthSubscriptions = await moduleRef.get(PrismaService).subscription.findMany({
      where: { organizationId: customer.organizationId, planId: 'growth', status: 'needs_review' }
    });
    expect(pendingGrowthSubscriptions).toHaveLength(1);
    expect(pendingGrowthSubscriptions[0].id).toBe(firstUpgrade.body.subscription.id);
  });

});
