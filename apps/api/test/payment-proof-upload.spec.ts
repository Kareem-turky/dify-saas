import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

async function createOrganization(app: INestApplication) {
  const signup = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ name: 'Upload User', email: `upload-${Date.now()}@example.com`, companyName: 'Upload Co', preferredLanguage: 'ar', planId: 'starter' })
    .expect(201);
  return signup.body.organization.id as string;
}

describe('Payment proof upload foundation', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: PrismaService;
  const previousUploadDir = process.env.PAYMENT_PROOF_UPLOAD_DIR;

  beforeEach(async () => {
    process.env.PAYMENT_PROOF_UPLOAD_DIR = './tmp/test-payment-proofs';
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(PrismaService);
    await db.resetForTests();
  });

  afterEach(async () => {
    await app.close();
    if (previousUploadDir === undefined) delete process.env.PAYMENT_PROOF_UPLOAD_DIR;
    else process.env.PAYMENT_PROOF_UPLOAD_DIR = previousUploadDir;
  });

  it('stores an allowed payment proof file and lets manual payment reference it', async () => {
    const organizationId = await createOrganization(app);

    const upload = await request(app.getHttpServer())
      .post('/payments/proofs')
      .field('organizationId', organizationId)
      .attach('file', Buffer.from('fake jpeg bytes'), { filename: 'receipt.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(upload.body).toMatchObject({
      organizationId,
      originalName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 'fake jpeg bytes'.length
    });
    expect(upload.body.id).toMatch(/^prf_/);
    expect(upload.body.proofUrl).toContain(`/payment-proofs/${organizationId}/`);
    expect(upload.body.sha256).toHaveLength(64);

    const payment = await request(app.getHttpServer())
      .post('/payments/manual-proof')
      .send({ organizationId, method: 'instapay', amountEgp: 1500, reference: 'IP-UPLOAD-1', proofUploadId: upload.body.id })
      .expect(201);

    expect(payment.body.payment.proofUrl).toBe(upload.body.proofUrl);
    const persistedProof = await db.paymentProof.findUnique({ where: { id: upload.body.id } });
    expect(persistedProof?.paymentId).toBe(payment.body.payment.id);
  });

  it('rejects unsupported proof file types before storing metadata', async () => {
    const organizationId = await createOrganization(app);

    await request(app.getHttpServer())
      .post('/payments/proofs')
      .field('organizationId', organizationId)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'receipt.html', contentType: 'text/html' })
      .expect(400);

    await expect(db.paymentProof.findMany({ where: { organizationId } })).resolves.toHaveLength(0);
  });
});
