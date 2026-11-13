import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('seeded portfolio against PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname !== '/cocos_test') {
      throw new Error('Functional tests require a dedicated cocos_test database');
    }

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('returns a populated account and retains the cash-only sample after two seed runs', async () => {
    expect(await prisma.order.count({ where: { userId: 1 } })).toBe(8);
    expect(await prisma.cashMovement.count({ where: { userId: 1 } })).toBe(2);
    expect(await prisma.order.findUnique({ where: { id: 6 }, select: {
      userId: true, instrumentId: true, side: true, type: true, status: true,
    } })).toEqual({ userId: 1, instrumentId: 31, side: 'BUY', type: 'LIMIT', status: 'NEW' });
    expect(await prisma.order.count({ where: {
      userId: 1, instrumentId: 31, side: 'SELL', size: 30, status: 'FILLED',
    } })).toBe(0);

    const populated = await request(app.getHttpServer()).get('/users/1/portfolio');
    expect(populated.status).toBe(200);
    expect(populated.body).toEqual({
      userId: 1,
      totalValueARS: '888940.00',
      availableCashARS: '707100.00',
      positions: [
        { instrumentId: 31, ticker: 'BMA', name: 'Banco Macro S.A.', size: 20,
          marketValueARS: '30056.00', totalReturnPct: '-2.42' },
        { instrumentId: 54, ticker: 'METR', name: 'MetroGAS S.A.', size: 500,
          marketValueARS: '114750.00', totalReturnPct: '-8.20' },
        { instrumentId: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.', size: 40,
          marketValueARS: '37034.00', totalReturnPct: '-0.45' },
      ],
    });

    const cashOnly = await request(app.getHttpServer()).get('/users/2/portfolio');
    expect(cashOnly.status).toBe(200);
    expect(cashOnly.body).toEqual({
      userId: 2,
      totalValueARS: '1000000.00',
      availableCashARS: '1000000.00',
      positions: [],
    });
  });
});
