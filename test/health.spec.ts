import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { HealthModule } from '../src/health/health.module.js';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(HealthModule, {
      logger: new ConsoleLogger({ json: true }),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a stable JSON response', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
