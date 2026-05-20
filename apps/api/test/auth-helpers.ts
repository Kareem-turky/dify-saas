import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';

export async function seedAndLoginAdmin(app: INestApplication, moduleRef: TestingModule) {
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminPass123!';
  process.env.AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'test-secret';
  await moduleRef.get(PrismaService).seedAdminForTests();
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
    .expect(201);
  return `Bearer ${login.body.token}`;
}
