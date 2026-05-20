import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('provisioning queue runner', () => {
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

  async function approveCustomer(index: number) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: `Queue Owner ${index}`,
        email: `queue-${index}-${Date.now()}@example.com`,
        password: 'CustomerPass123!',
        companyName: `Queue Co ${index}`,
        preferredLanguage: 'ar',
        planId: 'starter'
      })
      .expect(201);

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: `QUEUE-${index}` })
      .expect(201);

    return request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .set('Authorization', adminToken)
      .send({ notes: 'Payment verified' })
      .expect(201);
  }

  it('requires admin auth before running due provisioning jobs', async () => {
    await request(app.getHttpServer())
      .post('/provisioning/jobs/run-due')
      .expect(401);
  });

  it('runs queued provisioning jobs in FIFO order and returns a queue summary', async () => {
    const firstApproval = await approveCustomer(1);
    const secondApproval = await approveCustomer(2);

    const runDue = await request(app.getHttpServer())
      .post('/provisioning/jobs/run-due')
      .set('Authorization', adminToken)
      .expect(201);

    expect(runDue.body).toMatchObject({ processed: 2, completed: 2, failed: 0 });
    expect(runDue.body.results.map((result: { jobId: string }) => result.jobId)).toEqual([
      firstApproval.body.provisioningJob.id,
      secondApproval.body.provisioningJob.id
    ]);
    expect(runDue.body.results.every((result: { status: string }) => result.status === 'completed')).toBe(true);

    const jobs = await request(app.getHttpServer())
      .get('/provisioning/jobs')
      .set('Authorization', adminToken)
      .expect(200);

    expect(jobs.body.map((job: { status: string; attempts: number }) => ({ status: job.status, attempts: job.attempts }))).toEqual([
      { status: 'completed', attempts: 1 },
      { status: 'completed', attempts: 1 }
    ]);
  });
});
