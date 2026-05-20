import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await this.seedPlans();
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

  async resetForTests() {
    await this.provisioningJob.deleteMany();
    await this.approvalRequest.deleteMany();
    await this.paymentProof.deleteMany();
    await this.payment.deleteMany();
    await this.subscription.deleteMany();
    await this.user.deleteMany();
    await this.organization.deleteMany();
    await this.seedPlans();
  }
}
