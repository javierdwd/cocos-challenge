import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { InstrumentsModule } from './instruments/instruments.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';

@Module({ imports: [DatabaseModule, HealthModule, InstrumentsModule, PortfolioModule] })
export class AppModule {}
