import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await this.seedPlans();
    await this.seedAdminFromEnv();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async seedPlans() {
    const plans = [
      { id: 'starter', name: 'Starter', monthlyPriceEgp: 1500, messageLimit: 3000, channelLimit: 1, seatLimit: 2, requiresManualApproval: false },
      { id: 'growth', name: 'Growth', monthlyPriceEgp: 3500, messageLimit: 12000, channelLimit: 3, seatLimit: 5, requiresManualApproval: false },
      { id: 'business', name: 'Business', monthlyPriceEgp: 7500, messageLimit: 40000, channelLimit: 8, seatLimit: 15, requiresManualApproval: true }
    ];

    for (const plan of plans) {
      await this.plan.upsert({ where: { id: plan.id }, update: plan, create: plan });
    }
  }

  hashPasswordForSeed(password: string) {
    return `sha256:${createHash('sha256').update(password).digest('hex')}`;
  }

  async seedAdminFromEnv() {
    const email = process.env.ADMIN_EMAIL?.toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    await this.user.upsert({
      where: { email },
      update: { role: 'admin', passwordHash: this.hashPasswordForSeed(password), preferredLanguage: 'ar' },
      create: { id: 'usr_admin', name: 'Platform Admin', email, role: 'admin', passwordHash: this.hashPasswordForSeed(password), preferredLanguage: 'ar' }
    });
  }

  async seedAdminForTests() {
    await this.seedAdminFromEnv();
  }

  async resetForTests() {
    await this.contentBlock.deleteMany();
    await this.auditLog.deleteMany();
    await this.messageEvent.deleteMany();
    await this.channel.deleteMany();
    await this.provisioningJob.deleteMany();
    await this.approvalRequest.deleteMany();
    await this.paymentProof.deleteMany();
    await this.invoice.deleteMany();
    await this.payment.deleteMany();
    await this.subscription.deleteMany();
    await this.user.deleteMany();
    await this.organization.deleteMany();
    await this.seedPlans();
  }
}
