import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const db = new PrismaClient();

function hashPassword(password: string) {
  return `sha256:${createHash('sha256').update(password).digest('hex')}`;
}

async function main() {
  // Admin user (no organization)
  await db.user.upsert({
    where: { email: 'admin@fulfly.ai' },
    update: {},
    create: {
      id: 'usr_admin_001',
      name: 'Admin',
      email: 'admin@fulfly.ai',
      passwordHash: hashPassword('Admin@123'),
      role: 'admin',
      status: 'active',
      preferredLanguage: 'ar',
    },
  });

  // Plans
  const plans = [
    { id: 'starter', name: 'Starter', monthlyPriceEgp: 1500, messageLimit: 5000, channelLimit: 1, seatLimit: 2, requiresManualApproval: true },
    { id: 'growth', name: 'Growth', monthlyPriceEgp: 3500, messageLimit: 20000, channelLimit: 3, seatLimit: 5, requiresManualApproval: true },
    { id: 'business', name: 'Business', monthlyPriceEgp: 7500, messageLimit: 50000, channelLimit: 10, seatLimit: 15, requiresManualApproval: true },
  ];
  for (const plan of plans) {
    await db.plan.upsert({ where: { id: plan.id }, update: {}, create: plan });
  }

  // Test customer
  await db.organization.upsert({
    where: { id: 'org_test_001' },
    update: {},
    create: { id: 'org_test_001', name: 'Test Company', ownerUserId: 'usr_test_001', status: 'pending_payment' },
  });
  await db.user.upsert({
    where: { email: 'test@test.com' },
    update: {},
    create: {
      id: 'usr_test_001', name: 'Test User', email: 'test@test.com',
      passwordHash: hashPassword('Test@123'), role: 'customer', status: 'active',
      preferredLanguage: 'ar', organizationId: 'org_test_001',
    },
  });
  await db.subscription.upsert({
    where: { id: 'sub_test_001' },
    update: {},
    create: { id: 'sub_test_001', organizationId: 'org_test_001', planId: 'starter', status: 'pending_payment' },
  });

  console.log('🔑 Admin:    admin@fulfly.ai / Admin@123');
  console.log('👤 Customer: test@test.com / Test@123');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
