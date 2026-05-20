import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';

@Module({ controllers: [SaasController], providers: [PrismaService, SaasService] })
export class AppModule {}
