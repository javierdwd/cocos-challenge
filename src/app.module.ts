import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { InstrumentsModule } from './instruments/instruments.module.js';

@Module({ imports: [DatabaseModule, HealthModule, InstrumentsModule] })
export class AppModule {}
