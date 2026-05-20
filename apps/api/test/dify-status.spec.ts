import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = {
    DIFY_WORKSPACE_MODE: process.env.DIFY_WORKSPACE_MODE,
    DIFY_BASE_URL: process.env.DIFY_BASE_URL,
    DIFY_ADMIN_TOKEN: process.env.DIFY_ADMIN_TOKEN
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('Dify provisioning admin status', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function boot() {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.resetForTests();
  }

  it('returns Dify provisioning mode and endpoint status without exposing credentials', async () => {
    await withEnv({ DIFY_WORKSPACE_MODE: 'live', DIFY_BASE_URL: 'https://dify.example.com', DIFY_ADMIN_TOKEN: 'inner-secret' }, async () => {
      await boot();

      const response = await request(app.getHttpServer())
        .get('/provisioning/dify/status')
        .expect(200);

      expect(response.body).toEqual({
        mode: 'live',
        ready: true,
        baseUrl: 'https://dify.example.com',
        workspaceEndpoint: 'https://dify.example.com/inner/api/enterprise/workspace',
        tokenConfigured: true,
        requiresExistingDifyOwnerAccount: true
      });
      expect(JSON.stringify(response.body)).not.toContain('inner-secret');
    });
  });
});
