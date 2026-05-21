import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function signupCustomer(app: INestApplication) {
  return request(app.getHttpServer())
    .post('/auth/signup')
    .send({
      name: 'Auth Customer',
      email: `auth-${Date.now()}@example.com`,
      password: 'CustomerPass123!',
      companyName: 'Auth Co',
      preferredLanguage: 'ar',
      planId: 'starter'
    })
    .expect(201);
}

describe('Authentication and RBAC foundation', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const previousAdminEmail = process.env.ADMIN_EMAIL;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const previousAuthSecret = process.env.AUTH_TOKEN_SECRET;

  beforeEach(async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'AdminPass123!';
    process.env.AUTH_TOKEN_SECRET = 'test-secret';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
    await moduleRef.get(PrismaService).seedAdminForTests();
  });

  afterEach(async () => {
    await app.close();
    if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousAdminEmail;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousAuthSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
    else process.env.AUTH_TOKEN_SECRET = previousAuthSecret;
  });

  it('signs up a customer with a bearer token so the browser can continue without manual token copy', async () => {
    const signup = await signupCustomer(app);

    expect(signup.body.token).toMatch(/^hst_/);
    expect(signup.body.user.passwordHash).toBeUndefined();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .expect(200);

    expect(me.body.user).toMatchObject({ email: signup.body.user.email, role: 'customer', organizationId: signup.body.organization.id });
  });

  it('logs in a customer and returns the current user from a bearer token', async () => {
    const signup = await signupCustomer(app);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signup.body.user.email, password: 'CustomerPass123!' })
      .expect(201);

    expect(login.body.token).toMatch(/^hst_/);
    expect(login.body.user).toMatchObject({ email: signup.body.user.email, role: 'customer', organizationId: signup.body.organization.id });

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(me.body.user).toMatchObject({ email: signup.body.user.email, role: 'customer' });
  });

  it('protects admin endpoints from anonymous and customer users while allowing admins', async () => {
    await request(app.getHttpServer()).get('/admin/approvals').expect(401);

    const signup = await signupCustomer(app);
    const customerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: signup.body.user.email, password: 'CustomerPass123!' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/admin/approvals')
      .set('Authorization', `Bearer ${customerLogin.body.token}`)
      .expect(403);

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPass123!' })
      .expect(201);

    expect(adminLogin.body.user.role).toBe('admin');

    await request(app.getHttpServer())
      .get('/admin/approvals')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .expect(200);
  });
});
