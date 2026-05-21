import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedAndLoginAdmin } from './auth-helpers';

describe('Production health and readiness checks', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    process.env.AUTH_TOKEN_SECRET = 'super-secret-health-test';
    process.env.RATE_LIMIT_STORE = 'memory';
    process.env.DIFY_WORKSPACE_MODE = 'live';
    process.env.DIFY_BASE_URL = 'https://dify.example.test';
    process.env.DIFY_ADMIN_TOKEN = 'dify-secret-token';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PrismaService).resetForTests();
  });

  afterEach(async () => {
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.DIFY_WORKSPACE_MODE;
    delete process.env.DIFY_BASE_URL;
    delete process.env.DIFY_ADMIN_TOKEN;
    await app.close();
  });

  it('exposes a public liveness endpoint with no secrets or dependency details', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({ ok: true, service: 'dify-saas-api' });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('super-secret-health-test');
    expect(serialized).not.toContain('dify-secret-token');
  });

  it('requires admin auth for readiness details and reports sanitized dependency status', async () => {
    await request(app.getHttpServer()).get('/admin/readiness').expect(401);

    const adminToken = await seedAndLoginAdmin(app, moduleRef);
    const response = await request(app.getHttpServer())
      .get('/admin/readiness')
      .set('Authorization', adminToken)
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      service: 'dify-saas-api',
      checks: {
        database: { ok: true },
        adminUser: { ok: true },
        authTokenSecret: { ok: true, configured: true },
        paymentProofStorage: { ok: true },
        difyGateway: { ok: expect.any(Boolean), mode: expect.any(String), tokenConfigured: true },
        provisioningWorker: { enabled: expect.any(Boolean), running: expect.any(Boolean) }
      }
    });
    expect(response.body.checks.database.latencyMs).toEqual(expect.any(Number));
    expect(response.body.checks.paymentProofStorage.pathConfigured).toEqual(expect.any(Boolean));
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('super-secret-health-test');
    expect(serialized).not.toContain('dify-secret-token');
  });
});
