import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Dify provisioning worker', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => { await app.close(); });

  async function approveCustomer() {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Provision Owner', email: `provision-${Date.now()}@example.com`, companyName: 'Provision Co', preferredLanguage: 'ar', planId: 'starter' })
      .expect(201);

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'PROV-1' })
      .expect(201);

    return request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .send({ notes: 'Payment verified' })
      .expect(201);
  }

  it('runs a queued Dify provisioning job and stores Dify tenant/account ids on the organization', async () => {
    const approval = await approveCustomer();
    const jobId = approval.body.provisioningJob.id;

    const run = await request(app.getHttpServer())
      .post(`/provisioning/jobs/${jobId}/run`)
      .expect(201);

    expect(run.body.job).toMatchObject({ id: jobId, status: 'completed', attempts: 1 });
    expect(run.body.organization.status).toBe('active');
    expect(run.body.organization.difyTenantId).toMatch(/^dry_tenant_/);
    expect(run.body.organization.difyAccountId).toMatch(/^dry_account_/);

    const jobs = await request(app.getHttpServer()).get('/provisioning/jobs').expect(200);
    expect(jobs.body[0]).toMatchObject({ id: jobId, status: 'completed', attempts: 1 });
  });
});
