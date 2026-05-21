import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

async function createActiveStarterCustomer(app: INestApplication, adminToken: string) {
  const email = `team-${Date.now()}@example.com`;
  const password = 'CustomerPass123!';
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: 'Team Owner', email, password, companyName: 'Team Co', preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
  const payment = await request(app.getHttpServer())
    .post('/payments/manual-proof')
    .send({ organizationId: signup.body.organization.id, method: 'instapay', amountEgp: 1500, reference: 'TEAM-PAID' })
    .expect(201);
  const approval = await request(app.getHttpServer())
    .post(`/admin/approvals/${payment.body.payment.id}/approve`)
    .set('Authorization', adminToken)
    .send({ notes: 'Initial payment verified' })
    .expect(201);
  await request(app.getHttpServer()).post(`/provisioning/jobs/${approval.body.provisioningJob.id}/run`).set('Authorization', adminToken).expect(201);
  return { token: login.body.token as string, organizationId: signup.body.organization.id as string };
}

describe('Team members and seat limits', () => {
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

  it('lists members with plan seat usage and blocks adding beyond the active plan seat limit', async () => {
    const customer = await createActiveStarterCustomer(app, adminToken);

    const initial = await request(app.getHttpServer())
      .get('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);

    expect(initial.body.seatLimit).toBe(2);
    expect(initial.body.seatsUsed).toBe(1);
    expect(initial.body.members).toHaveLength(1);
    expect(initial.body.members[0]).toMatchObject({ role: 'customer' });
    expect(initial.body.members[0].passwordHash).toBeUndefined();

    const invited = await request(app.getHttpServer())
      .post('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'Agent One', email: `agent-one-${Date.now()}@example.com`, role: 'member' })
      .expect(201);

    expect(invited.body.member).toMatchObject({ name: 'Agent One', role: 'member', organizationId: customer.organizationId });
    expect(invited.body.member.passwordHash).toBeUndefined();
    expect(invited.body.seatsUsed).toBe(2);
    expect(invited.body.seatLimit).toBe(2);

    const blocked = await request(app.getHttpServer())
      .post('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'Agent Two', email: `agent-two-${Date.now()}@example.com`, role: 'member' })
      .expect(409);

    expect(blocked.body.message).toContain('Seat limit reached');

    const finalList = await request(app.getHttpServer())
      .get('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(200);

    expect(finalList.body.seatsUsed).toBe(2);
    expect(finalList.body.members).toHaveLength(2);
  });

  it('requires an authenticated organization user and rejects duplicate member emails', async () => {
    const customer = await createActiveStarterCustomer(app, adminToken);
    const email = `duplicate-agent-${Date.now()}@example.com`;

    await request(app.getHttpServer())
      .get('/team/members')
      .expect(401);

    await request(app.getHttpServer())
      .post('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'Duplicate Agent', email, role: 'member' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/team/members')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'Duplicate Agent Again', email, role: 'member' })
      .expect(409);
  });
});
