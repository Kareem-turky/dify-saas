import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 1 SaaS foundation', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('exposes commercial plans for the pricing page', async () => {
    const res = await request(app.getHttpServer()).get('/plans').expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({ id: 'starter', channelLimit: 1 });
  });

  it('runs signup -> manual payment proof -> admin approval -> queued Dify provisioning job', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ name: 'Kareem', email: 'kareem@example.com', phone: '+201000000000', companyName: 'Kareem Co', industry: 'ecommerce', preferredLanguage: 'ar', planId: 'starter' })
      .expect(201);

    expect(signup.body.organization.status).toBe('pending_payment');
    expect(signup.body.subscription.status).toBe('pending_payment');

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'IP-123', proofUrl: 's3://proofs/ip-123.jpg' })
      .expect(201);

    expect(paymentProof.body.payment.status).toBe('needs_review');
    expect(paymentProof.body.organization.status).toBe('pending_approval');

    const approvals = await request(app.getHttpServer()).get('/admin/approvals').expect(200);
    expect(approvals.body).toHaveLength(1);
    expect(approvals.body[0].approval.status).toBe('open');

    const approval = await request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .send({ notes: 'Payment verified manually' })
      .expect(201);

    expect(approval.body.payment.status).toBe('paid');
    expect(approval.body.subscription.status).toBe('active');
    expect(approval.body.organization.status).toBe('provisioning');
    expect(approval.body.provisioningJob).toMatchObject({ type: 'create_dify_workspace', status: 'queued', attempts: 0 });

    const jobs = await request(app.getHttpServer()).get('/provisioning/jobs').expect(200);
    expect(jobs.body).toHaveLength(1);
    expect(jobs.body[0].payload.organizationName).toBe('Kareem Co');
  });
});
