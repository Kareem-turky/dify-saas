import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('Admin CMS: Plans, Users, Content management', () => {
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

  // ─── Plan Management ────────────────────────────────────────
  describe('Admin plan management', () => {
    it('admin can create a new plan', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/plans')
        .set('Authorization', adminToken)
        .send({
          name: 'Enterprise',
          monthlyPriceEgp: 15000,
          messageLimit: 100000,
          channelLimit: 20,
          seatLimit: 50,
          requiresManualApproval: true,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Enterprise',
        monthlyPriceEgp: 15000,
        messageLimit: 100000,
        channelLimit: 20,
        seatLimit: 50,
      });
      expect(res.body.id).toBeTruthy();
    });

    it('admin can update an existing plan', async () => {
      const plans = await request(app.getHttpServer()).get('/plans').expect(200);
      const starter = plans.body.find((p: any) => p.id === 'starter');
      const res = await request(app.getHttpServer())
        .put(`/admin/plans/${starter.id}`)
        .set('Authorization', adminToken)
        .send({ monthlyPriceEgp: 1800, messageLimit: 5000 })
        .expect(200);
      expect(res.body.monthlyPriceEgp).toBe(1800);
      expect(res.body.messageLimit).toBe(5000);
    });

    it('admin can delete a plan that has no subscriptions', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/plans')
        .set('Authorization', adminToken)
        .send({
          name: 'Temporary Plan',
          monthlyPriceEgp: 999,
          messageLimit: 500,
          channelLimit: 1,
          seatLimit: 1,
          requiresManualApproval: false,
        })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/admin/plans/${res.body.id}`)
        .set('Authorization', adminToken)
        .expect(200);
      const plans = await request(app.getHttpServer()).get('/plans').expect(200);
      expect(plans.body.find((p: any) => p.id === res.body.id)).toBeUndefined();
    });

    it('admin cannot delete a plan with active subscriptions', async () => {
      // Signup creates a subscription linked to 'starter' plan
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Sub User', email: `sub-${Date.now()}@example.com`, password: 'Pass123!', companyName: 'Sub Co', planId: 'starter' })
        .expect(201);
      await request(app.getHttpServer())
        .delete('/admin/plans/starter')
        .set('Authorization', adminToken)
        .expect(400);
    });

    it('non-admin cannot access plan management', async () => {
      await request(app.getHttpServer())
        .post('/admin/plans')
        .send({ name: 'Hack', monthlyPriceEgp: 1, messageLimit: 1, channelLimit: 1, seatLimit: 1 })
        .expect(401);
    });
  });

  // ─── User Management ────────────────────────────────────────
  describe('Admin user management', () => {
    it('admin can list all users with organization info', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Test User', email: `user-${Date.now()}@example.com`, password: 'Pass123!', companyName: 'Test Co', planId: 'starter' });

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', adminToken)
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      const customer = res.body.find((u: any) => u.role === 'customer');
      expect(customer).toBeTruthy();
      expect(customer.organization).toBeTruthy();
    });

    it('admin can suspend a user', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Suspend Me', email: `suspend-${Date.now()}@example.com`, password: 'Pass123!', companyName: 'Suspend Co', planId: 'starter' });

      const userId = signup.body.user.id;
      const res = await request(app.getHttpServer())
        .put(`/admin/users/${userId}`)
        .set('Authorization', adminToken)
        .send({ status: 'suspended' })
        .expect(200);
      expect(res.body.user.status).toBe('suspended');
    });

    it('admin can change user role', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ name: 'Role Guy', email: `role-${Date.now()}@example.com`, password: 'Pass123!', companyName: 'Role Co', planId: 'starter' });

      const userId = signup.body.user.id;
      const res = await request(app.getHttpServer())
        .put(`/admin/users/${userId}`)
        .set('Authorization', adminToken)
        .send({ role: 'support' })
        .expect(200);
      expect(res.body.user.role).toBe('support');
    });

    it('non-admin cannot access user management', async () => {
      await request(app.getHttpServer())
        .get('/admin/users')
        .expect(401);
    });
  });

  // ─── Content Management ─────────────────────────────────────
  describe('Admin content management', () => {
    it('admin can set a content block', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/content/hero_title')
        .set('Authorization', adminToken)
        .send({ value: 'منصة الذكاء الاصطناعي الأولى في مصر' })
        .expect(200);
      expect(res.body).toMatchObject({ key: 'hero_title', value: 'منصة الذكاء الاصطناعي الأولى في مصر' });
    });

    it('admin can list all content blocks', async () => {
      await request(app.getHttpServer())
        .put('/admin/content/hero_subtitle')
        .set('Authorization', adminToken)
        .send({ value: 'أتمتة المحادثات بذكاء' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/admin/content')
        .set('Authorization', adminToken)
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const sub = res.body.find((c: any) => c.key === 'hero_subtitle');
      expect(sub.value).toBe('أتمتة المحادثات بذكاء');
    });

    it('public can read content blocks without auth', async () => {
      await request(app.getHttpServer())
        .put('/admin/content/footer_text')
        .set('Authorization', adminToken)
        .send({ value: '© 2026 Fulfly AI' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/content')
        .expect(200);
      const footer = res.body.find((c: any) => c.key === 'footer_text');
      expect(footer.value).toBe('© 2026 Fulfly AI');
    });

    it('admin can delete a content block', async () => {
      await request(app.getHttpServer())
        .put('/admin/content/temp_block')
        .set('Authorization', adminToken)
        .send({ value: 'temporary' })
        .expect(200);

      await request(app.getHttpServer())
        .delete('/admin/content/temp_block')
        .set('Authorization', adminToken)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/content')
        .expect(200);
      expect(res.body.find((c: any) => c.key === 'temp_block')).toBeUndefined();
    });

    it('non-admin cannot set content', async () => {
      await request(app.getHttpServer())
        .put('/admin/content/hero_title')
        .send({ value: 'hacked' })
        .expect(401);
    });
  });
});
