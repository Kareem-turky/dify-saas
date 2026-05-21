import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('Billing invoices and receipts', () => {
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

  afterEach(async () => {
    await app.close();
  });

  async function createApprovedPayment() {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Invoice Owner',
        email: `invoice-${Date.now()}@example.com`,
        password: 'CustomerPass123!',
        companyName: 'Invoice Co',
        preferredLanguage: 'ar',
        planId: 'starter'
      })
      .expect(201);

    const paymentProof = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'INV-REF-001' })
      .expect(201);

    const approval = await request(app.getHttpServer())
      .post(`/admin/approvals/${paymentProof.body.payment.id}/approve`)
      .set('Authorization', adminToken)
      .send({ notes: 'Paid and ready for invoice' })
      .expect(201);

    return { signup, paymentProof, approval };
  }

  it('issues a paid invoice receipt when an admin approves a manual payment', async () => {
    const { signup, paymentProof, approval } = await createApprovedPayment();

    expect(approval.body.invoice).toMatchObject({
      organizationId: signup.body.organization.id,
      paymentId: paymentProof.body.payment.id,
      subscriptionId: signup.body.subscription.id,
      amountEgp: 1500,
      currency: 'EGP',
      status: 'paid'
    });
    expect(approval.body.invoice.invoiceNumber).toMatch(/^INV-\d{8}-/);
    expect(approval.body.invoice.receiptUrl).toContain(`/billing/invoices/${approval.body.invoice.id}/receipt`);

    const dashboard = await request(app.getHttpServer())
      .get(`/organizations/${signup.body.organization.id}/dashboard`)
      .expect(200);

    expect(dashboard.body.latestInvoice).toMatchObject({
      id: approval.body.invoice.id,
      invoiceNumber: approval.body.invoice.invoiceNumber,
      amountEgp: 1500,
      status: 'paid'
    });

    const receipt = await request(app.getHttpServer())
      .get(`/billing/invoices/${approval.body.invoice.id}/receipt`)
      .expect(200);

    expect(receipt.body).toMatchObject({
      invoiceNumber: approval.body.invoice.invoiceNumber,
      organizationName: 'Invoice Co',
      amountEgp: 1500,
      currency: 'EGP',
      paymentReference: 'INV-REF-001'
    });
  });
});
