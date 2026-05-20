import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('admin provisioning controls', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => { await app.close(); });

  it('lists provisioning jobs with organization context so the admin UI can run queued jobs', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Admin Provision Owner', email: `admin-provision-${Date.now()}@example.com`, companyName: 'Admin Provision Co', preferredLanguage: 'ar', planId: 'starter' })
      .expect(201);

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'ADMIN-PROV-1' })
      .expect(201);

    const approval = await request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .send({ notes: 'Payment verified' })
      .expect(201);

    const jobs = await request(app.getHttpServer()).get('/provisioning/jobs').expect(200);

    expect(jobs.body).toHaveLength(1);
    expect(jobs.body[0]).toMatchObject({
      id: approval.body.provisioningJob.id,
      status: 'queued',
      type: 'create_dify_workspace',
      attempts: 0,
      organization: { id: signup.body.organization.id, name: 'Admin Provision Co', status: 'provisioning' }
    });
  });
});
