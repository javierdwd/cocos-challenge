import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { HealthResponse } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
