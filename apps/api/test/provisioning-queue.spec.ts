import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

const previousDifyEnv = {
  DIFY_WORKSPACE_MODE: process.env.DIFY_WORKSPACE_MODE,
  DIFY_BASE_URL: process.env.DIFY_BASE_URL,
  DIFY_ADMIN_TOKEN: process.env.DIFY_ADMIN_TOKEN
};

function restoreDifyEnv() {
  for (const [key, value] of Object.entries(previousDifyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('provisioning queue runner', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let adminToken: string;

  async function bootApp() {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    adminToken = await seedAndLoginAdmin(app, moduleRef);
  }

  beforeEach(async () => { await bootApp(); });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    restoreDifyEnv();
  });

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

  it('backs off failed jobs and marks them dead after max attempts', async () => {
    await app.close();
    process.env.DIFY_WORKSPACE_MODE = 'live';
    process.env.DIFY_BASE_URL = 'https://dify.example.com';
    process.env.DIFY_ADMIN_TOKEN = 'inner-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'temporary Dify outage' })
    }));
    await bootApp();

    const approval = await approveCustomer(3);
    const jobId = approval.body.provisioningJob.id;

    const firstRun = await request(app.getHttpServer())
      .post('/provisioning/jobs/run-due')
      .set('Authorization', adminToken)
      .expect(201);

    expect(firstRun.body).toMatchObject({ processed: 1, completed: 0, failed: 1 });
    expect(firstRun.body.results[0]).toMatchObject({ jobId, status: 'failed', error: 'temporary Dify outage' });

    const afterFirstFailure = await moduleRef.get(PrismaService).provisioningJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(afterFirstFailure).toMatchObject({ status: 'failed', attempts: 1, maxAttempts: 3, lastError: 'temporary Dify outage' });
    expect(afterFirstFailure.nextRunAt?.getTime()).toBeGreaterThan(Date.now());

    const skippedRun = await request(app.getHttpServer())
      .post('/provisioning/jobs/run-due')
      .set('Authorization', adminToken)
      .expect(201);
    expect(skippedRun.body).toMatchObject({ processed: 0, completed: 0, failed: 0 });

    await moduleRef.get(PrismaService).provisioningJob.update({
      where: { id: jobId },
      data: { attempts: 2, nextRunAt: new Date(Date.now() - 1000) }
    });

    const finalRun = await request(app.getHttpServer())
      .post('/provisioning/jobs/run-due')
      .set('Authorization', adminToken)
      .expect(201);

    expect(finalRun.body).toMatchObject({ processed: 1, completed: 0, failed: 1 });
    const deadJob = await moduleRef.get(PrismaService).provisioningJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(deadJob).toMatchObject({ status: 'dead', attempts: 3, lastError: 'temporary Dify outage', nextRunAt: null });
  });
});
