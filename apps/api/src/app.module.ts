import { Module } from '@nestjs/common';
import { DifyProvisioningGateway, DifyProvisioningService } from './dify-provisioning.service';
import { PrismaService } from './prisma.service';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';
import { ProvisioningWorkerService } from './provisioning-worker.service';

@Module({ controllers: [SaasController], providers: [PrismaService, SaasService, DifyProvisioningGateway, DifyProvisioningService, ProvisioningWorkerService] })
export class AppModule {}
