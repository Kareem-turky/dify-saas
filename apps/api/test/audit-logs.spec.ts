import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('audit logs', () => {
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

  async function signupAndSubmitPayment() {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Audit Customer',
        email: `audit-${Date.now()}@example.com`,
        password: 'CustomerPass123!',
        companyName: 'Audit Co',
        preferredLanguage: 'ar',
        planId: 'starter'
      })
      .expect(201);

    const payment = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'AUDIT-1' })
      .expect(201);

    return { signup, payment };
  }

  it('requires admin auth to list audit logs', async () => {
    await request(app.getHttpServer()).get('/admin/audit-logs').expect(401);
  });

  it('records successful admin login without leaking passwords', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
      .expect(201);

    const logs = await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', adminToken)
      .expect(200);

    const adminLogin = logs.body.find((log: { action: string }) => log.action === 'admin_login');
    expect(adminLogin).toMatchObject({ actorUserId: 'usr_admin', action: 'admin_login' });
    expect(JSON.stringify(adminLogin)).not.toContain(process.env.ADMIN_PASSWORD);
  });

  it('records payment approval and provisioning run events with organization context', async () => {
    const { signup, payment } = await signupAndSubmitPayment();

    const approval = await request(app.getHttpServer())
      .post(`/admin/approvals/${payment.body.payment.id}/approve`)
      .set('Authorization', adminToken)
      .send({ notes: 'Audit approval' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/provisioning/jobs/${approval.body.provisioningJob.id}/run`)
      .set('Authorization', adminToken)
      .expect(201);

    const logs = await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .set('Authorization', adminToken)
      .expect(200);

    expect(logs.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: 'usr_admin',
        organizationId: signup.body.organization.id,
        action: 'payment_approved',
        targetType: 'payment',
        targetId: payment.body.payment.id
      }),
      expect.objectContaining({
        actorUserId: 'usr_admin',
        organizationId: signup.body.organization.id,
        action: 'provisioning_job_completed',
        targetType: 'provisioning_job',
        targetId: approval.body.provisioningJob.id
      })
    ]));
  });
});
