import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PortfolioModule } from '../src/portfolio/portfolio.module.js';

const findUser = vi.fn();
const readMovements = vi.fn();
const findInstruments = vi.fn();

@Global()
@Module({
  providers: [{
    provide: PrismaService,
    useValue: {
      user: { findUnique: findUser },
      instrument: { findMany: findInstruments },
      $queryRaw: readMovements,
    },
  }],
  exports: [PrismaService],
})
class TestDatabaseModule {}

@Module({ imports: [TestDatabaseModule, PortfolioModule] })
class TestAppModule {}

function movement(
  sourceId: number,
  instrumentId: number | null,
  shareDelta: number,
  cashDelta: string,
) {
  return {
    source_type: instrumentId === null ? 'CASH_MOVEMENT' : 'ORDER',
    source_id: sourceId,
    instrument_id: instrumentId,
    share_delta: shareDelta,
    cash_delta_ars: cashDelta,
  };
}

function instrument(id: number, ticker: string, close: string) {
  return { id, ticker, name: `${ticker} shares`, marketdata: [{ close }] };
}

describe('GET /users/:userId/portfolio', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(TestAppModule, { logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    findUser.mockReset().mockResolvedValue({ id: 7 });
    readMovements.mockReset().mockResolvedValue([]);
    findInstruments.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reconciles transfers, trades, a partial sale and latest prices', async () => {
    readMovements.mockResolvedValue([
      movement(1, null, 0, '1000.00'),
      movement(2, 10, 3, '-30.03'),
      movement(3, 10, 2, '-20.04'),
      movement(4, 10, -2, '24.00'),
      movement(5, null, 0, '-2.00'),
      movement(6, 11, 1, '-8.00'),
    ]);
    findInstruments.mockResolvedValue([
      instrument(10, 'AAA', '11.00'),
      instrument(11, 'BBB', '8.01'),
    ]);

    const response = await request(app.getHttpServer()).get('/users/7/portfolio');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 7,
      totalValueARS: '1004.94',
      availableCashARS: '963.93',
      positions: [
        { instrumentId: 10, ticker: 'AAA', name: 'AAA shares', size: 3, marketValueARS: '33.00', totalReturnPct: '9.85' },
        { instrumentId: 11, ticker: 'BBB', name: 'BBB shares', size: 1, marketValueARS: '8.01', totalReturnPct: '0.13' },
      ],
    });
    expect(readMovements).toHaveBeenCalledOnce();
    expect(readMovements.mock.calls[0][0].join('')).toContain('FROM portfolio_movements');
    expect(findInstruments.mock.calls[0][0]).toMatchObject({
      where: { id: { in: [10, 11] } },
      select: { marketdata: { orderBy: [{ datetime: 'desc' }, { id: 'desc' }], take: 1 } },
    });
  });

  it('omits a sold-out position and returns an empty portfolio', async () => {
    readMovements.mockResolvedValue([
      movement(1, null, 0, '20.00'),
      movement(2, 10, 1, '-10.00'),
      movement(3, 10, -1, '12.00'),
    ]);

    const soldOut = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(soldOut.body).toEqual({ userId: 7, totalValueARS: '22.00', availableCashARS: '22.00', positions: [] });
    expect(findInstruments).not.toHaveBeenCalled();

    readMovements.mockResolvedValue([]);
    const empty = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(empty.body).toEqual({ userId: 7, totalValueARS: '0.00', availableCashARS: '0.00', positions: [] });
  });

  it('returns null for a positive position with zero cost', async () => {
    readMovements.mockResolvedValue([movement(1, 10, 1, '0.00')]);
    findInstruments.mockResolvedValue([instrument(10, 'AAA', '5.00')]);

    const response = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(response.body.positions[0]).toMatchObject({ marketValueARS: '5.00', totalReturnPct: null });
  });

  it('rounds a negative half-cent percentage away from zero', async () => {
    readMovements.mockResolvedValue([movement(1, 10, 1, '-8.00')]);
    findInstruments.mockResolvedValue([instrument(10, 'AAA', '7.99')]);

    const response = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(response.body.positions[0].totalReturnPct).toBe('-0.13');
  });

  it.each(['/users/0/portfolio', '/users/-1/portfolio', '/users/1.5/portfolio', '/users/1e2/portfolio'])
    ('rejects an invalid user ID: %s', async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(findUser).not.toHaveBeenCalled();
    });

  it('returns 404 for an unknown user', async () => {
    findUser.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    expect(readMovements).not.toHaveBeenCalled();
  });

  it('returns 503 when a held instrument has no market price', async () => {
    readMovements.mockResolvedValue([movement(1, 10, 1, '-8.00')]);
    findInstruments.mockResolvedValue([{ id: 10, ticker: 'AAA', name: 'AAA shares', marketdata: [] }]);
    const response = await request(app.getHttpServer()).get('/users/7/portfolio');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('MARKET_PRICE_UNAVAILABLE');
  });
});
