import { Injectable } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
}

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
