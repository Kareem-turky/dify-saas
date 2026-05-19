import { Module } from '@nestjs/common';
import { InMemoryStore } from './in-memory.store';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';

@Module({ controllers: [SaasController], providers: [InMemoryStore, SaasService] })
export class AppModule {}
